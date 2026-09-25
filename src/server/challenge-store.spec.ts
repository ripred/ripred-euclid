import { describe, expect, it } from "vitest";
import {
  DEFAULT_CHALLENGE_OPTIONS,
  placeChallengePoint,
  type ChallengeSnapshot,
  type ChallengeCommand,
} from "../shared/challenge";
import {
  ChallengeStore,
  CHALLENGE_RETENTION_MS,
  challengeSessionKey,
} from "./challenge-store";
import { MemoryRedis } from "./testing/memory-redis";

let sequence = 0;
const command = (state: ChallengeSnapshot | null): ChallengeCommand => ({
  commandId: `command-${++sequence}`,
  expectedRevision: state?.revision ?? 0,
  puzzleId: state?.puzzleId ?? null,
  attemptId: state?.attemptId ?? null,
});
function fixture() {
  let now = 0;
  const redis = new MemoryRedis(() => now);
  return {
    redis,
    store: new ChallengeStore(
      redis,
      () => now,
      () => `id-${++sequence}`,
    ),
    advance: (ms = CHALLENGE_RETENTION_MS + 1) => {
      now += ms;
    },
  };
}
const options = {
  ...DEFAULT_CHALLENGE_OPTIONS,
  minimumMoves: 4,
  targetSquares: 1,
  geometry: "aligned" as const,
  seed: "test",
};

describe("private playground sessions", () => {
  it("allows extra placements, completes once, and preserves best across retries", async () => {
    const { redis, store } = fixture();
    let state = (await store.mutate("owner", "generate", {
      ...command(null),
      options,
    }))!;
    for (const point of [63, 0, 1, 8, 9])
      state = (await store.mutate("owner", "move", {
        ...command(state),
        point,
      }))!;
    expect(state.complete).toBe(true);
    expect(state.bestMoves).toBe(5);
    await expect(
      store.mutate("owner", "move", { ...command(state), point: 3 }),
    ).rejects.toThrow(/complete/);
    state = (await store.mutate("owner", "restart", command(state)))!;
    expect(state.placements).toEqual([]);
    expect(state.bestMoves).toBe(5);
    for (const point of [0, 1, 8, 9])
      state = (await store.mutate("owner", "move", {
        ...command(state),
        point,
      }))!;
    expect(state.bestMoves).toBe(4);
    expect(await store.state("other")).toBeNull();
    const raw = redis.json<{ certification: { solutions: number[][] } }>(
      challengeSessionKey("owner"),
    );
    expect(raw?.certification.solutions.length).toBeGreaterThan(0);
    expect(JSON.stringify(await store.state("owner"))).not.toMatch(
      /solutions|seed|certification/,
    );
    expect(
      redis.keys().every((k) => k.startsWith("euclid:challenge-lab:")),
    ).toBe(true);
  });
  it("uses server time, keeps time across refreshes, and breaks move ties by speed", async () => {
    const { store, advance } = fixture();
    let state = (await store.mutate("owner", "generate", {
      ...command(null),
      options,
    }))!;
    advance(4000);
    expect((await store.state("owner"))?.elapsedMs).toBe(4000);
    expect((await store.state("owner"))?.startedAt).toBe(0);
    async function finish(points: number[], duration: number) {
      advance(duration);
      for (const point of points)
        state = (await store.mutate("owner", "move", {
          ...command(state),
          point,
          elapsedMs: 0,
          startedAt: 999999,
        }))!;
    }
    await finish([0, 1, 8, 9], 6000);
    expect(state.bestMoves).toBe(4);
    expect(state.bestElapsedMs).toBe(10000);
    const finished = state;
    advance(1000);
    expect(await store.state("owner")).toEqual(finished);
    state = (await store.mutate("owner", "restart", command(state)))!;
    expect(state.elapsedMs).toBe(0);
    expect(state.startedAt).toBe(11000);
    await finish([0, 1, 8, 9], 5000);
    expect(state.bestElapsedMs).toBe(5000);
    state = (await store.mutate("owner", "restart", command(state)))!;
    await finish([0, 1, 8, 9], 7000);
    expect(state.bestElapsedMs).toBe(5000);
    state = (await store.mutate("owner", "restart", command(state)))!;
    await finish([63, 0, 1, 8, 9], 1000);
    expect(state.bestMoves).toBe(4);
    expect(state.bestElapsedMs).toBe(5000);
    expect(state.elapsedMs).toBe(1000);
  });
  it("rejects stale tabs and changed command payloads, and replays a lost reply once", async () => {
    const { store } = fixture();
    const generation = { ...command(null), options };
    const state = (await store.mutate("owner", "generate", generation))!;
    expect(await store.mutate("owner", "generate", generation)).toEqual(state);
    const request = { ...command(state), point: 63 };
    const moved = await store.mutate("owner", "move", request);
    expect(await store.mutate("owner", "move", request)).toEqual(moved);
    await expect(
      store.mutate("owner", "move", { ...request, point: 62 }),
    ).rejects.toThrow(/already used/);
    await expect(
      store.mutate("owner", "restart", command(state)),
    ).rejects.toThrow(/changed/);
  });
  it("accepts only one mutation from concurrent tabs", async () => {
    const { store } = fixture();
    const state = (await store.mutate("owner", "generate", {
      ...command(null),
      options,
    }))!;
    const results = await Promise.allSettled([
      store.mutate("owner", "move", { ...command(state), point: 0 }),
      store.mutate("owner", "move", { ...command(state), point: 1 }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect((await store.state("owner"))?.placements).toHaveLength(1);
  });
  it("preserves the previous attempt on invalid generation and expires temporary state", async () => {
    const { store, advance } = fixture();
    const state = (await store.mutate("owner", "generate", {
      ...command(null),
      options,
    }))!;
    await expect(
      store.mutate("owner", "generate", {
        ...command(state),
        options: { ...options, minimumMoves: 99 },
      }),
    ).rejects.toThrow();
    expect(await store.state("owner")).toEqual(state);
    advance();
    expect(await store.state("owner")).toBeNull();
    await expect(
      store.mutate("owner", "move", { ...command(state), point: 0 }),
    ).rejects.toThrow(/ended/);
  });
  it("deletes abandoned placements and protects another owner's session", async () => {
    const { store, redis } = fixture();
    let state = (await store.mutate("owner", "generate", {
      ...command(null),
      options,
    }))!;
    state = (await store.mutate("owner", "move", {
      ...command(state),
      point: 63,
    }))!;
    await expect(
      store.mutate("other", "restart", command(state)),
    ).rejects.toThrow();
    await store.mutate("owner", "abandon", command(state));
    expect(redis.value(challengeSessionKey("owner"))).toBeUndefined();
    expect(await store.state("owner")).toBeNull();
  });
  it("never accepts a blocked, occupied, or out-of-range point", () => {
    const base: ChallengeSnapshot = {
      puzzleId: "p",
      attemptId: "a",
      revision: 1,
      puzzle: {
        version: 1,
        size: 8,
        initial: [0, 1, 8],
        blocked: [63],
        minimumMoves: 1,
        targetSquares: 1,
      },
      placements: [],
      completedSquares: [],
      complete: false,
      bestMoves: null,
      startedAt: 0,
      finishedAt: null,
      elapsedMs: 0,
      bestElapsedMs: null,
    };
    for (const point of [63, 0, -1, 64, NaN, 0.5])
      expect(() => placeChallengePoint(base, point)).toThrow();
    expect(placeChallengePoint(base, 9).complete).toBe(true);
    expect(base.placements).toEqual([]);
  });
  it("counts two squares sharing a newly placed corner only once each", () => {
    const base: ChallengeSnapshot = {
      puzzleId: "p",
      attemptId: "a",
      revision: 1,
      puzzle: {
        version: 1,
        size: 8,
        initial: [0, 1, 8, 10, 17, 18],
        blocked: [],
        minimumMoves: 1,
        targetSquares: 2,
      },
      placements: [],
      completedSquares: [],
      complete: false,
      bestMoves: null,
      startedAt: 0,
      finishedAt: null,
      elapsedMs: 0,
      bestElapsedMs: null,
    };
    const result = placeChallengePoint(base, 9);
    expect(result.completedSquares.length).toBeGreaterThanOrEqual(2);
    expect(new Set(result.completedSquares).size).toBe(
      result.completedSquares.length,
    );
    expect(result.complete).toBe(true);
  });
});
