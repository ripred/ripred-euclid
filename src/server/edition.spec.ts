import express from "express";
import { createServer, type Server } from "node:http";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import type { RedisCasDecision } from "./redis-cas";
import type {
  EditionSnapshot,
  EditionState,
  EditionWatchSnapshot,
  LiveEditionGame,
} from "../shared/edition-contract";

const storage = vi.hoisted(() => ({
  userId: "player-one" as string | undefined,
  username: "ripred3",
  values: new Map<string, string>(),
  index: new Map<string, Map<string, number>>(),
  indexFailure: false,
  failure: null as Error | null,
  reads: vi.fn(),
  commits: vi.fn(),
  decisions: vi.fn(),
}));
vi.mock("@devvit/web/server", () => ({
  context: {
    get userId() {
      return storage.userId;
    },
    get username() {
      return storage.username;
    },
  },
  redis: {
    zRem: async (key: string, members: string[]) => {
      if (storage.indexFailure) throw new Error("private index failure");
      members.forEach((member) => storage.index.get(key)?.delete(member));
    },
    set: async (key: string, value: string) => {
      if (storage.indexFailure) throw new Error("private index failure");
      storage.values.set(key, value);
    },
    zAdd: async (
      key: string,
      ...members: { member: string; score: number }[]
    ) => {
      if (storage.indexFailure) throw new Error("private index failure");
      const entries = storage.index.get(key) ?? new Map<string, number>();
      members.forEach(({ member, score }) => entries.set(member, score));
      storage.index.set(key, entries);
    },
    zRange: async (key: string, start: number, stop: number) => {
      if (storage.failure) throw storage.failure;
      return [...(storage.index.get(key) ?? [])]
        .map(([member, score]) => ({ member, score }))
        .sort((a, b) => b.score - a.score)
        .slice(start, stop + 1);
    },
    zRemRangeByScore: async (key: string, min: number, max: number) => {
      if (storage.indexFailure) throw new Error("private index failure");
      const entries = storage.index.get(key);
      for (const [member, score] of entries ?? [])
        if (score >= min && score <= max) entries?.delete(member);
    },
    get: async (key: string) => {
      storage.reads(key);
      if (storage.failure) throw storage.failure;
      return storage.values.get(key);
    },
  },
}));
// These tests exercise the actual HTTP router. Redis transaction races have a
// separate independent suite; this adapter preserves its atomic decision boundary.
vi.mock("./redis-cas", () => ({
  redisCas: async (
    _client: unknown,
    key: string,
    decide: (raw: string | undefined) => RedisCasDecision<unknown>,
  ) => {
    if (storage.failure) throw storage.failure;
    const decision = decide(storage.values.get(key));
    storage.decisions(decision.action);
    if (decision.action === "set") storage.values.set(key, decision.value);
    if (decision.action === "delete") storage.values.delete(key);
    storage.commits(key);
    return decision.result;
  },
}));
vi.mock("../shared/edition-game", async () => {
  const { EditionRuleError } = await import("../shared/edition-contract");
  return {
    edition: {
      id: "http-test",
      create: () => ({ revision: 0, turn: 1, winner: null }),
      move: (
        state: { revision: number; turn: number; winner: null },
        action: unknown,
      ) => {
        if (action !== "place" && action !== "win")
          throw new EditionRuleError("Choose an empty point.");
        return {
          ...state,
          revision: state.revision + 1,
          turn: state.turn === 1 ? 2 : 1,
          winner: action === "win" ? state.turn : null,
        };
      },
      chooseMove: () => "place",
      spectatorState: (
        state: EditionState & { hint?: unknown; canFinish?: boolean },
      ) => {
        const visible = { ...state };
        delete visible.hint;
        delete visible.canFinish;
        return visible;
      },
      reconcile: (state: EditionState & { legacyResult?: boolean }) =>
        state.legacyResult
          ? { ...state, winner: 1 as const, legacyResult: false }
          : state,
    },
  };
});
import { editionRouter } from "./edition";

let server: Server;
let base: string;
const start = { kind: "start", mode: "solo", commandId: "start-0001" };
const command = (body: unknown) =>
  fetch(`${base}/command`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
beforeAll(async () => {
  const app = express();
  app.use("/api/edition", editionRouter);
  app.use(express.json({ limit: "15mb" }));
  server = createServer(app);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Expected a TCP listener.");
  base = `http://127.0.0.1:${address.port}/api/edition`;
});
afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
});
beforeEach(() => {
  storage.userId = "player-one";
  storage.username = "ripred3";
  storage.values.clear();
  storage.index.clear();
  storage.indexFailure = false;
  storage.failure = null;
  storage.reads.mockClear();
  storage.commits.mockClear();
  storage.decisions.mockClear();
});

describe("edition spectator HTTP boundary", () => {
  const ownerKey = "euclid:edition:http-test:v1:player-one";
  async function newGame(mode = "solo") {
    return (await (
      await command({ ...start, mode })
    ).json()) as EditionSnapshot<EditionState>;
  }
  async function visibility(
    game: EditionSnapshot<EditionState>,
    enabled = true,
    commandId = "allow-0001",
  ) {
    return command({
      kind: "spectators",
      enabled,
      commandId,
      expectedId: game.id,
      expectedRevision: game.state.revision,
    });
  }
  async function published() {
    const game = await newGame();
    expect((await visibility(game)).status).toBe(200);
    return game;
  }
  const watch = (id: string) => fetch(`${base}/watch/${id}`);

  it("keeps games private until the owner opts in and returns safe discovery", async () => {
    const game = await newGame();
    expect((await watch(game.id)).status).toBe(404);
    expect(await (await fetch(`${base}/live`)).json()).toEqual({ games: [] });
    expect((await visibility(game)).status).toBe(200);
    const list = await fetch(`${base}/live`);
    expect(list.headers.get("Cache-Control")).toBe("no-store");
    const body = (await list.json()) as { games: LiveEditionGame[] };
    expect(body.games).toHaveLength(1);
    expect(body.games[0]).toEqual({
      id: game.id,
      mode: "solo",
      hostName: "ripred3",
      revision: 0,
      updatedAt: expect.any(Number),
    });
    expect(JSON.stringify(body)).not.toContain("player-one");
  });

  it("allows anonymous watching without allocating or modifying an owner session", async () => {
    const game = await published();
    storage.userId = undefined;
    const before = [...storage.values];
    storage.commits.mockClear();
    const response = await watch(game.id);
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toEqual({
      id: game.id,
      mode: "solo",
      state: game.state,
      hostName: "ripred3",
      updatedAt: expect.any(Number),
    });
    expect([...storage.values]).toEqual(before);
    expect(storage.commits).not.toHaveBeenCalled();
    expect((await command({ kind: "move" })).status).toBe(401);
  });

  it("does not let another account change or unpublish a watched match", async () => {
    const game = await published();
    const saved = storage.values.get(ownerKey);
    storage.userId = "player-two";
    expect((await watch(game.id)).status).toBe(200);
    expect((await visibility(game, false)).status).toBe(409);
    expect(
      (
        await command({
          kind: "move",
          commandId: "forge-0001",
          expectedId: game.id,
          expectedRevision: 0,
          action: "win",
          owner: "player-one",
        })
      ).status,
    ).toBe(409);
    expect(storage.values.get(ownerKey)).toBe(saved);
    expect(await (await fetch(`${base}/state`)).json()).toBeNull();
  });

  it("uses authoritative names and activity instead of submitted identity metadata", async () => {
    const game = await newGame();
    const response = await command({
      kind: "spectators",
      commandId: "allow-0001",
      expectedId: game.id,
      expectedRevision: 0,
      enabled: true,
      updatedAt: 9999999999999,
      hostName: "forged",
      owner: "victim",
      id: "forged",
    });
    expect(response.status).toBe(200);
    const snapshot = (await (
      await watch(game.id)
    ).json()) as EditionWatchSnapshot<EditionState>;
    expect(snapshot.hostName).toBe("ripred3");
    expect(snapshot.updatedAt).toBeLessThan(9999999999999);
    expect(snapshot.id).toBe(game.id);
  });

  it("redacts receipts and private coaching while retaining the renderable board", async () => {
    const game = await published();
    const stored = JSON.parse(storage.values.get(ownerKey)!);
    stored.state.hint = { point: 17, message: "secret", squares: ["route"] };
    stored.state.canFinish = false;
    storage.values.set(ownerKey, JSON.stringify(stored));
    const snapshot = (await (
      await watch(game.id)
    ).json()) as EditionWatchSnapshot<EditionState>;
    expect(snapshot).not.toHaveProperty("lastCommand");
    expect(snapshot).not.toHaveProperty("activity");
    expect(snapshot.state).not.toHaveProperty("hint");
    expect(snapshot.state).not.toHaveProperty("canFinish");
    expect(snapshot.state).toEqual(game.state);
    expect(JSON.parse(storage.values.get(ownerKey)!).state.hint.message).toBe(
      "secret",
    );
  });

  it("revokes immediately even when stale index entries remain", async () => {
    const game = await published();
    const revision = game.state.revision;
    expect((await visibility(game, false, "revoke-0001")).status).toBe(200);
    expect(storage.index.size).toBe(1);
    // Simulate a delayed old publication racing after the owner's revocation.
    storage.index
      .get("euclid:edition:http-test:spectators:v1:live")
      ?.set(game.id, Date.now());
    expect((await watch(game.id)).status).toBe(404);
    expect(await (await fetch(`${base}/live`)).json()).toEqual({ games: [] });
    expect(JSON.parse(storage.values.get(ownerKey)!).state.revision).toBe(
      revision,
    );
  });

  it("never follows restarted matches or transfers previous visibility", async () => {
    const game = await published();
    const next = (await (
      await command({
        ...start,
        commandId: "start-0002",
        expectedId: game.id,
        expectedRevision: 0,
      })
    ).json()) as EditionSnapshot<EditionState>;
    expect(next.id).not.toBe(game.id);
    expect(next.spectatorsEnabled).toBe(false);
    expect((await watch(game.id)).status).toBe(404);
    expect((await watch(next.id)).status).toBe(404);
    expect(await (await fetch(`${base}/live`)).json()).toEqual({ games: [] });
  });

  it("makes accepted moves and terminal results visible without listing finished games", async () => {
    const game = await published();
    const moved = (await (
      await command({
        kind: "move",
        commandId: "move-0001",
        expectedId: game.id,
        expectedRevision: 0,
        action: "place",
      })
    ).json()) as EditionSnapshot<EditionState>;
    expect(
      (
        (await (
          await watch(game.id)
        ).json()) as EditionWatchSnapshot<EditionState>
      ).state.revision,
    ).toBe(2);
    const ended = (await (
      await command({
        kind: "move",
        commandId: "win-00001",
        expectedId: game.id,
        expectedRevision: moved.state.revision,
        action: "win",
      })
    ).json()) as EditionSnapshot<EditionState>;
    expect(ended.state.winner).toBe(1);
    expect(ended.state.revision).toBe(3);
    expect(
      (
        (await (
          await watch(game.id)
        ).json()) as EditionWatchSnapshot<EditionState>
      ).state,
    ).toEqual(ended.state);
    expect(await (await fetch(`${base}/live`)).json()).toEqual({ games: [] });
    expect((await visibility(ended, false, "revoke-0001")).status).toBe(200);
    expect((await watch(game.id)).status).toBe(404);
  });

  it("does not renew inactivity with watcher reads; direct access expires after a day", async () => {
    const game = await published();
    const stored = JSON.parse(storage.values.get(ownerKey)!);
    stored.activity.updatedAt = Date.now() - 10 * 60 * 1000;
    storage.values.set(ownerKey, JSON.stringify(stored));
    expect(await (await fetch(`${base}/live`)).json()).toEqual({ games: [] });
    expect((await watch(game.id)).status).toBe(200);
    expect(JSON.parse(storage.values.get(ownerKey)!).activity.updatedAt).toBe(
      stored.activity.updatedAt,
    );
    stored.activity.updatedAt = Date.now() - 24 * 60 * 60 * 1000;
    storage.values.set(ownerKey, JSON.stringify(stored));
    expect((await watch(game.id)).status).toBe(404);
  });

  it("does not expose invalid IDs, missing games, or internal failure details", async () => {
    storage.reads.mockClear();
    expect((await watch("not-a-game")).status).toBe(404);
    expect(storage.reads).not.toHaveBeenCalled();
    expect((await watch("12d566fb-97af-4c7f-a1e6-b07c6d440111")).status).toBe(
      404,
    );
    storage.failure = new Error("private store identity");
    const response = await fetch(`${base}/live`);
    expect(response.status).toBe(503);
    expect(JSON.stringify(await response.json())).not.toContain("identity");
  });

  it("keeps accepted moves authoritative if discovery fails and retries publication safely", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const game = await published();
      storage.indexFailure = true;
      expect((await visibility(game, false, "revoke-0001")).status).toBe(200);
      expect((await watch(game.id)).status).toBe(404);
      storage.indexFailure = false;
      expect((await visibility(game, true, "allow-0002")).status).toBe(200);
      expect((await watch(game.id)).status).toBe(200);
    } finally {
      warn.mockRestore();
    }
  });

  it("orders and caps discovery while excluding missing canonical records", async () => {
    const now = Date.now();
    const index = new Map<string, number>();
    storage.index.set("euclid:edition:http-test:spectators:v1:live", index);
    for (let i = 0; i < 60; i++) {
      const id = `12d566fb-97af-4c7f-a1e6-${String(i).padStart(12, "0")}`;
      index.set(id, now - i);
      storage.values.set(
        `euclid:edition:http-test:spectators:v1:owner:${id}`,
        `owner-${i}`,
      );
      if (i === 0) continue;
      storage.values.set(
        `euclid:edition:http-test:v1:owner-${i}`,
        JSON.stringify({
          id,
          mode: "duel",
          state: { revision: i, turn: 1, winner: null },
          spectatorsEnabled: true,
          activity: { hostName: `player_${i}`, updatedAt: now - i },
          lastCommand: { id: "hidden", signature: "hidden" },
        }),
      );
    }
    const { games } = (await (await fetch(`${base}/live`)).json()) as {
      games: LiveEditionGame[];
    };
    expect(games).toHaveLength(50);
    expect(games[0]?.hostName).toBe("player_1");
    expect(games[49]?.hostName).toBe("player_50");
  });

  it("pages past hundreds of stale entries to find a still-active game", async () => {
    const game = await published();
    const index = storage.index.get(
      "euclid:edition:http-test:spectators:v1:live",
    )!;
    const score = Date.now();
    for (let i = 0; i < 405; i++)
      index.set(
        `12d566fb-97af-4c7f-a1e6-${String(i).padStart(12, "0")}`,
        score + 1,
      );
    const { games } = (await (await fetch(`${base}/live`)).json()) as {
      games: LiveEditionGame[];
    };
    expect(games.map(({ id }) => id)).toEqual([game.id]);
  });
});

describe("edition HTTP boundary", () => {
  it("persists corrected saved results on GET without changing the move receipt", async () => {
    const storageKey = "euclid:edition:http-test:v1:player-one";
    const legacy = {
      id: "legacy-game",
      mode: "puzzle",
      state: { revision: 2, turn: 1, winner: 0, legacyResult: true },
      lastCommand: { id: "legacy-move", signature: "accepted-intent" },
    };
    storage.values.set(storageKey, JSON.stringify(legacy));

    const response = await fetch(`${base}/state`);
    expect(response.status).toBe(200);
    const snapshot = (await response.json()) as EditionSnapshot<EditionState>;
    expect(snapshot.state).toEqual({
      ...legacy.state,
      winner: 1,
      legacyResult: false,
    });
    expect(snapshot.id).toBe(legacy.id);
    expect(snapshot).not.toHaveProperty("lastCommand");
    const saved = JSON.parse(storage.values.get(storageKey)!);
    expect(saved.lastCommand).toEqual(legacy.lastCommand);
    expect(saved.state).toEqual(snapshot.state);
    expect(storage.decisions).toHaveBeenLastCalledWith("set");

    const reloaded = await fetch(`${base}/state`);
    expect(await reloaded.json()).toEqual(snapshot);
    expect(storage.decisions).toHaveBeenLastCalledWith("no-change");
  });
  it("does not create a stored game while reading an empty account", async () => {
    expect(await (await fetch(`${base}/state`)).json()).toBeNull();
    expect(storage.values.size).toBe(0);
    expect(storage.decisions).toHaveBeenLastCalledWith("no-change");
  });
  it("authenticates before parsing malformed JSON or touching storage", async () => {
    storage.userId = undefined;
    const response = await fetch(`${base}/command`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{",
    });
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      error: "Sign in to Reddit to play.",
    });
    expect(storage.reads).not.toHaveBeenCalled();
    expect(storage.commits).not.toHaveBeenCalled();
  });
  it("returns JSON for malformed JSON instead of an HTML stack trace", async () => {
    const response = await fetch(`${base}/command`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{",
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Invalid JSON command." });
    expect(storage.commits).not.toHaveBeenCalled();
  });
  it("enforces the small byte limit before the legacy parser", async () => {
    const response = await command({ ...start, ignored: "é".repeat(4200) });
    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({ error: "Command is too large." });
    expect(storage.commits).not.toHaveBeenCalled();
  });
  it.each([
    { "Content-Type": "text/plain" },
    { "Content-Type": "application/json", "Content-Encoding": "gzip" },
    { "Content-Type": "application/json; charset=iso-8859-1" },
  ])("rejects unsupported content and encoding: %j", async (headers) => {
    const response = await fetch(`${base}/command`, {
      method: "POST",
      headers,
      body: "{}",
    });
    expect(response.status).toBe(415);
    expect(await response.json()).toHaveProperty("error");
    expect(storage.commits).not.toHaveBeenCalled();
  });
  it("isolates accounts and redacts receipts from a real start/move/reload", async () => {
    const started = await command(start);
    expect(started.status).toBe(200);
    const game = (await started.json()) as EditionSnapshot<EditionState>;
    expect(game).not.toHaveProperty("lastCommand");
    expect(storage.commits).toHaveBeenLastCalledWith(
      "euclid:edition:http-test:v1:player-one",
    );
    const moved = await command({
      kind: "move",
      commandId: "move-00001",
      expectedId: game.id,
      expectedRevision: 0,
      action: "place",
      scores: [9999, 0],
    });
    expect(moved.status).toBe(200);
    const next = (await moved.json()) as EditionSnapshot<EditionState>;
    expect(next.state).toEqual({ revision: 2, turn: 1, winner: null });
    const reloaded = await fetch(`${base}/state`);
    expect(reloaded.headers.get("Cache-Control")).toBe("no-store");
    expect(await reloaded.json()).toEqual(next);
    storage.userId = "player-two";
    expect(await (await fetch(`${base}/state`)).json()).toBeNull();
  });
  it("rejects stale and illegal moves without changing the saved game", async () => {
    const game = (await (
      await command(start)
    ).json()) as EditionSnapshot<EditionState>;
    const saved = [...storage.values];
    const move = {
      kind: "move",
      commandId: "move-00001",
      expectedId: game.id,
      expectedRevision: 9,
      action: "place",
    };
    expect((await command(move)).status).toBe(409);
    const illegal = await command({
      ...move,
      expectedRevision: 0,
      action: "forge",
    });
    expect(illegal.status).toBe(400);
    expect(await illegal.json()).toEqual({ error: "Choose an empty point." });
    expect([...storage.values]).toEqual(saved);
  });
  it("sanitizes storage failures on both read and write paths", async () => {
    storage.failure = new Error(
      "Redis conflict euclid:edition:http-test:v1:private-account",
    );
    for (const response of [
      await command(start),
      await fetch(`${base}/state`),
    ]) {
      expect(response.status).toBe(503);
      const body = await response.text();
      expect(JSON.parse(body)).toHaveProperty("error");
      expect(body).not.toMatch(/Redis|private-account|http-test/);
    }
  });
  it("returns a JSON404 for unsupported edition endpoints", async () => {
    const response = await fetch(`${base}/missing`);
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Unknown game endpoint." });
  });
});
