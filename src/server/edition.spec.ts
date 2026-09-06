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
import type { EditionSnapshot, EditionState } from "../shared/edition-contract";

const storage = vi.hoisted(() => ({
  userId: "player-one" as string | undefined,
  values: new Map<string, string>(),
  failure: null as Error | null,
  reads: vi.fn(),
  commits: vi.fn(),
}));
vi.mock("@devvit/web/server", () => ({
  context: {
    get userId() {
      return storage.userId;
    },
  },
  redis: {
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
        if (action !== "place")
          throw new EditionRuleError("Choose an empty point.");
        return {
          ...state,
          revision: state.revision + 1,
          turn: state.turn === 1 ? 2 : 1,
        };
      },
      chooseMove: () => "place",
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
  storage.values.clear();
  storage.failure = null;
  storage.reads.mockClear();
  storage.commits.mockClear();
});

describe("edition HTTP boundary", () => {
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
