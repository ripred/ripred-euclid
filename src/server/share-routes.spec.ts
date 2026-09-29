import type { Express } from "express";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type MockInstance,
} from "vitest";
import { createInitialH2HBoard, type H2HCanonicalStateSnapshot } from "./h2h";
import { H2HStore } from "./h2h-store";
import { SoloStore, type SoloPrepareShareResult } from "./solo-store";
import { ShareCommentPendingError } from "./share-comments";
import type { ResultSharePayload } from "../shared/types/api";

const mocks = vi.hoisted(() => ({
  app: undefined as Express | undefined,
  context: {
    userId: "winner" as string | undefined,
    subredditName: "EuclidTheGame",
  },
  values: new Map<string, string>(),
  redis: { get: vi.fn(), set: vi.fn(), del: vi.fn() },
  reddit: {
    submitComment: vi.fn(),
    getCurrentUsername: vi.fn(),
    getSnoovatarUrl: vi.fn(),
  },
  resultHub: vi.fn(),
  cooldown: vi.fn(),
}));
vi.mock("@devvit/web/server", () => ({
  ...mocks,
  media: {},
  getServerPort: () => 0,
  createServer: (app: Express) => {
    mocks.app = app;
    return { on: vi.fn(), listen: vi.fn() };
  },
}));
vi.mock("./community-posts", () => ({
  resultHub: mocks.resultHub,
  setupCommunityPosts: vi.fn(),
}));
vi.mock("./request-limits", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./request-limits")>()),
  reserveShareCooldown: mocks.cooldown,
}));

let server: ReturnType<Express["listen"]>;
let origin: string;
let state: H2HCanonicalStateSnapshot;
let terminal: MockInstance<H2HStore["getTerminalState"]>;
beforeAll(async () => {
  await import("./index");
  server = mocks.app!.listen(0, "127.0.0.1");
  await once(server, "listening");
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});
beforeEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
  mocks.values.clear();
  mocks.context.userId = "winner";
  mocks.redis.get.mockImplementation(async (key: string) =>
    mocks.values.get(key),
  );
  mocks.redis.set.mockImplementation(
    async (key: string, value: string, options?: { nx?: boolean }) => {
      if (options?.nx && mocks.values.has(key)) return undefined;
      mocks.values.set(key, value);
      return "OK";
    },
  );
  mocks.redis.del.mockImplementation(async (key: string) => {
    mocks.values.delete(key);
  });
  mocks.reddit.getCurrentUsername.mockResolvedValue("Winner");
  mocks.reddit.getSnoovatarUrl.mockResolvedValue(undefined);
  mocks.reddit.submitComment.mockResolvedValue({
    id: "t1_result",
    permalink: "/r/EuclidTheGame/comments/hub/comment/result/",
  });
  mocks.resultHub.mockResolvedValue({
    postId: "t3_hub",
    gamePermalink: "/r/EuclidTheGame/comments/game/",
  });
  mocks.cooldown.mockResolvedValue(undefined);
  const board = createInitialH2HBoard("loser", "winner", {
    now: 1,
    names: { loser: "Loser", winner: "Winner" },
  });
  board.m_players[0].m_score = 132;
  board.m_players[1].m_score = 156;
  state = {
    gameId: "game",
    board,
    revision: 42,
    rulesVersion: 1,
    ended: true,
    endedReason: "game_over",
    endedBy: null,
    victorSide: 2,
  };
  terminal = vi
    .spyOn(H2HStore.prototype, "getTerminalState")
    .mockResolvedValue(state);
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});
const request = (kind: string, body: unknown) =>
  fetch(`${origin}/api/share/${kind}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
const h2h = (extra = {}) =>
  request("h2h-result", { gameId: "game", terminalRevision: 42, ...extra });

describe("shared-result routes", () => {
  it("shares one ranking snapshot as a comment without storing unused legacy post payloads", async () => {
    vi.spyOn(SoloStore.prototype, "getRankedRows").mockResolvedValue([
      {
        userId: "winner",
        name: "Winner",
        rating: 1200,
        games: 1,
        wins: 1,
        losses: 0,
        draws: 0,
      },
    ]);
    const first = await request("rankings", { bucket: "hva" });
    expect(first.status).toBe(200);
    const destination = await first.json();
    expect(destination).toMatchObject({
      postId: "t3_hub",
      commentId: "t1_result",
    });
    expect(await (await request("rankings", { bucket: "hva" })).json()).toEqual(
      destination,
    );
    expect(mocks.reddit.submitComment).toHaveBeenCalledTimes(1);
    expect(
      [...mocks.values.keys()].some((key) =>
        key.startsWith("euclid:share:post:"),
      ),
    ).toBe(false);
  });
  it.each([undefined, "stranger", "loser"])(
    "rejects unauthorized caller %s before comment or hub access",
    async (userId) => {
      mocks.context.userId = userId;
      expect((await h2h()).status).toBe(userId === undefined ? 401 : 403);
      expect(mocks.reddit.submitComment).not.toHaveBeenCalled();
      expect(mocks.resultHub).not.toHaveBeenCalled();
      expect(mocks.cooldown).not.toHaveBeenCalled();
    },
  );

  it("uses the authorized terminal round and canonical winner-first score, ignoring submitted text and scores", async () => {
    const response = await h2h({
      title: "Fake victory",
      score: 99999,
      winner: "loser",
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      status: "posted",
      postId: "t3_hub",
      commentId: "t1_result",
      sharedAs: "APP",
    });
    expect(terminal).toHaveBeenCalledExactlyOnceWith("game", 42);
    expect(mocks.reddit.submitComment).toHaveBeenCalledWith({
      id: "t3_hub",
      runAs: "APP",
      text: expect.stringContaining("### Winner beat Loser, 156–132"),
    });
    expect(mocks.reddit.submitComment.mock.calls[0]![0].text).not.toContain(
      "Fake victory",
    );
    expect(
      [...mocks.values.keys()].some((key) =>
        key.startsWith("euclid:share:post:"),
      ),
    ).toBe(false);
  });

  it("returns the prior H2H comment before cooldown, profile or hub work on a retry", async () => {
    const original = await (await h2h()).json();
    mocks.redis.get.mockClear();
    mocks.resultHub.mockClear();
    mocks.cooldown.mockClear();
    mocks.cooldown.mockRejectedValue(new Error("must not charge replay"));
    expect(await (await h2h()).json()).toEqual(original);
    expect(mocks.reddit.submitComment).toHaveBeenCalledTimes(1);
    expect(mocks.resultHub).not.toHaveBeenCalled();
    expect(mocks.cooldown).not.toHaveBeenCalled();
    expect(
      mocks.redis.get.mock.calls.some(
        ([key]) =>
          key.startsWith("euclid:name:") || key.startsWith("euclid:avatar:"),
      ),
    ).toBe(false);
  });

  it("keeps an uncertain comment pending without marking it posted or resubmitting", async () => {
    mocks.reddit.submitComment.mockRejectedValue(new Error("response lost"));
    for (let i = 0; i < 2; i++) {
      if (i > 0) {
        mocks.cooldown.mockClear();
        mocks.cooldown.mockRejectedValue(
          new Error("must not charge pending replay"),
        );
      }
      const response = await h2h();
      expect(response.status).toBe(202);
      expect(await response.json()).toMatchObject({
        status: "pending",
        ok: true,
      });
    }
    expect(mocks.reddit.submitComment).toHaveBeenCalledTimes(1);
    expect(mocks.cooldown).not.toHaveBeenCalled();
  });

  it.each(["active", "draw", "missing", "bad revision"])(
    "does not publish an invalid terminal result: %s",
    async (reason) => {
      if (reason === "active") state.ended = false;
      if (reason === "draw") state.victorSide = null;
      if (reason === "missing") terminal.mockResolvedValue(null);
      expect(
        (await h2h(reason === "bad revision" ? { terminalRevision: -1 } : {}))
          .status,
      ).toBeGreaterThanOrEqual(400);
      expect(mocks.reddit.submitComment).not.toHaveBeenCalled();
    },
  );

  it("never makes a solo receipt retryable after an uncertain submission", async () => {
    const payload: ResultSharePayload = {
      kind: "result",
      shareId: "share",
      subredditName: "EuclidTheGame",
      sharedAt: new Date().toISOString(),
      mode: "ai",
      title: "Winner beat Euclid, 156–132",
      subtitle: "Practice",
      headline: "Winner beat Euclid!",
      details: "156–132",
      footer: "",
      board: state.board,
      p1Name: "Euclid",
      p2Name: "Winner",
      winnerSide: 2,
    };
    const prepared = {
      shouldSubmit: true,
      receipt: { status: "prepared", shareId: "share", payload },
    } as SoloPrepareShareResult;
    vi.spyOn(SoloStore.prototype, "prepareShare").mockResolvedValue(prepared);
    const failed = vi.spyOn(SoloStore.prototype, "failShare");
    const finalized = vi.spyOn(SoloStore.prototype, "finalizeShare");
    mocks.reddit.submitComment.mockRejectedValue(
      new ShareCommentPendingError(),
    );
    const response = await request("ai-result", {
      gameId: "solo",
      commandId: "command",
    });
    expect(response.status).toBe(202);
    expect(await response.json()).toMatchObject({
      status: "pending",
      shareId: "share",
    });
    expect(failed).not.toHaveBeenCalled();
    expect(finalized).not.toHaveBeenCalled();
    expect(mocks.reddit.getSnoovatarUrl).not.toHaveBeenCalled();
  });
});
