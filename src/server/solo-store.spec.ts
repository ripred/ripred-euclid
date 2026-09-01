import { describe, expect, it } from "vitest";

import type {
  SoloMoveRequest,
  SoloMoveResponse,
  SoloSessionSnapshot,
  SoloStartResponse,
} from "../shared/types/api";
import type { PracticeRulesInput } from "../shared/game/rules";
import { Board } from "../shared/game/engine";
import {
  SOLO_RANKED_START_RATING,
  SOLO_STORE_KEYS,
  SoloStore,
  hashSoloCommandId,
  settleSoloRankedRating,
  type SoloRankedRatingRecord,
  type SoloStoreOptions,
} from "./solo-store";
import type {
  RedisCasClient,
  RedisCasTransaction,
  RedisCasWrite,
} from "./redis-cas";

class MemoryRedis implements RedisCasClient {
  readonly commits: RedisCasWrite[][] = [];
  readonly reads: string[] = [];
  readonly watches: string[][] = [];
  beforeExec: (() => void | Promise<void>) | undefined;

  private readonly values = new Map<string, string>();
  private readonly versions = new Map<string, number>();

  seed(key: string, value: string): void {
    this.values.set(key, value);
    this.bump(key);
  }

  externalSet(key: string, value: string): void {
    this.seed(key, value);
  }

  externalDelete(key: string): void {
    this.values.delete(key);
    this.bump(key);
  }

  value(key: string): string | undefined {
    return this.values.get(key);
  }

  json<T>(key: string): T | undefined {
    const raw = this.value(key);
    return raw === undefined ? undefined : (JSON.parse(raw) as T);
  }

  keys(): string[] {
    return [...this.values.keys()];
  }

  clearAccessLog(): void {
    this.reads.length = 0;
    this.watches.length = 0;
  }

  version(key: string): number {
    return this.versions.get(key) ?? 0;
  }

  async get(key: string): Promise<string | undefined> {
    this.reads.push(key);
    return this.value(key);
  }

  async watch(...keys: string[]): Promise<RedisCasTransaction> {
    this.watches.push([...keys]);
    return new MemoryTransaction(this, keys);
  }

  hasConflict(watched: ReadonlyMap<string, number>): boolean {
    return [...watched].some(([key, version]) => this.version(key) !== version);
  }

  commit(writes: readonly RedisCasWrite[]): void {
    for (const write of writes) {
      if (write.action === "set") this.values.set(write.key, write.value);
      else this.values.delete(write.key);
    }
    for (const write of writes) this.bump(write.key);
    this.commits.push(writes.map((write) => ({ ...write })));
  }

  private bump(key: string): void {
    this.versions.set(key, this.version(key) + 1);
  }
}

class MemoryTransaction implements RedisCasTransaction {
  private readonly watched: ReadonlyMap<string, number>;
  private readonly writes: RedisCasWrite[] = [];
  private inMulti = false;
  private closed = false;

  constructor(
    private readonly redis: MemoryRedis,
    keys: readonly string[],
  ) {
    this.watched = new Map(keys.map((key) => [key, redis.version(key)]));
  }

  async multi(): Promise<void> {
    this.assertOpen();
    this.inMulti = true;
  }

  async set(key: string, value: string): Promise<unknown> {
    this.assertQueueing();
    this.writes.push({ action: "set", key, value });
    return this;
  }

  async del(...keys: string[]): Promise<unknown> {
    this.assertQueueing();
    this.writes.push(
      ...keys.map((key) => ({ action: "delete" as const, key })),
    );
    return this;
  }

  async exec(): Promise<readonly unknown[] | null> {
    this.assertQueueing();
    await this.redis.beforeExec?.();
    if (this.redis.hasConflict(this.watched)) {
      this.closed = true;
      return null;
    }
    this.redis.commit(this.writes);
    this.closed = true;
    return this.writes.map(() => "OK");
  }

  async discard(): Promise<void> {
    this.closed = true;
  }

  async unwatch(): Promise<unknown> {
    this.closed = true;
    return this;
  }

  private assertOpen(): void {
    if (this.closed) throw new Error("Transaction is closed.");
  }

  private assertQueueing(): void {
    this.assertOpen();
    if (!this.inMulti) throw new Error("MULTI has not started.");
  }
}

function createFixture(options: SoloStoreOptions = {}): {
  redis: MemoryRedis;
  store: SoloStore;
  setNow: (value: number) => void;
} {
  const redis = new MemoryRedis();
  let timestamp = Date.UTC(2026, 8, 1, 12);
  let gameSequence = 0;
  let seedSequence = 0;
  let shareSequence = 0;
  const store = new SoloStore(redis, {
    now: () => timestamp,
    createGameId: () => `solo-game-${++gameSequence}`,
    createSeed: () => `private-seed-${++seedSequence}`,
    createShareId: () => `solo-share-${++shareSequence}`,
    cas: { maxAttempts: 12 },
    ...options,
  });
  return {
    redis,
    store,
    setNow: (value) => {
      timestamp = value;
    },
  };
}

const PRACTICE_RULES: PracticeRulesInput = {
  W: 4,
  H: 4,
  scoring: "bbox",
  winScore: 1,
  difficulty: "doofus",
  humanPlayer: 0,
  firstPlayer: 0,
};

async function startRanked(
  store: SoloStore,
  commandId = "ranked-start",
): Promise<SoloStartResponse> {
  return store.start("owner", { mode: "ranked", commandId });
}

async function startPractice(
  store: SoloStore,
  commandId = "practice-start",
  rules: PracticeRulesInput = PRACTICE_RULES,
): Promise<SoloStartResponse> {
  return store.start("owner", { mode: "practice", commandId, rules });
}

function firstEmpty(snapshot: SoloSessionSnapshot): { x: number; y: number } {
  const index = snapshot.board.m_board.findIndex((cell) => cell === 0);
  if (index < 0) throw new Error("Board has no empty cell.");
  return {
    x: index % snapshot.board.W,
    y: Math.floor(index / snapshot.board.W),
  };
}

function moveRequest(
  snapshot: SoloSessionSnapshot,
  commandId: string,
  point = firstEmpty(snapshot),
): SoloMoveRequest {
  return {
    gameId: snapshot.gameId,
    expectedRevision: snapshot.revision,
    commandId,
    ...point,
  };
}

function strongestAvailableMove(snapshot: SoloSessionSnapshot): {
  x: number;
  y: number;
} {
  let best = firstEmpty(snapshot);
  let bestPoints = -1;
  for (let index = 0; index < snapshot.board.m_board.length; index++) {
    if (snapshot.board.m_board[index] !== 0) continue;
    const engine = Board.fromJSON(snapshot.board, () => 0);
    const x = index % snapshot.board.W;
    const y = Math.floor(index / snapshot.board.W);
    const points = engine.placePiece(engine.pointAt(x, y));
    if (points > bestPoints) {
      best = { x, y };
      bestPoints = points;
    }
  }
  return best;
}

async function findPracticeHumanWin(store: SoloStore): Promise<{
  start: SoloStartResponse;
  finalRequest: SoloMoveRequest;
  finalSnapshot: SoloSessionSnapshot;
}> {
  const rules: PracticeRulesInput = {
    ...PRACTICE_RULES,
    humanPlayer: 1,
    firstPlayer: 1,
  };
  for (let game = 0; game < 24; game++) {
    const start = await startPractice(store, `winning-start-${game}`, rules);
    let snapshot = start.snapshot;
    let finalRequest: SoloMoveRequest | null = null;
    while (snapshot.status === "active") {
      finalRequest = moveRequest(
        snapshot,
        `winning-move-${game}-${snapshot.revision}`,
        strongestAvailableMove(snapshot),
      );
      const response = await store.move("owner", finalRequest);
      if (!response.accepted) throw new Error("Winning fixture move failed.");
      snapshot = response.snapshot;
    }
    if (snapshot.outcome.status === "player2_win" && finalRequest) {
      return { start, finalRequest, finalSnapshot: snapshot };
    }
  }
  throw new Error("Could not produce a deterministic Practice human win.");
}

describe("SoloStore start and ownership", () => {
  it("creates one active Ranked game under concurrent starts and resumes it", async () => {
    const { redis, store } = createFixture();
    const [first, second] = await Promise.all([
      store.start("owner", { mode: "ranked", commandId: "start-a" }),
      store.start("owner", { mode: "ranked", commandId: "start-b" }),
    ]);

    expect(first.snapshot.gameId).toBe(second.snapshot.gameId);
    expect([first.resumed, second.resumed].sort()).toEqual([false, true]);
    expect(redis.value(SOLO_STORE_KEYS.activeRanked("owner"))).toBe(
      first.snapshot.gameId,
    );
    expect(
      redis.keys().filter((key) => key.startsWith("euclid:solo:v1:game:")),
    ).toHaveLength(1);

    await expect(store.getActiveRanked("owner")).resolves.toMatchObject({
      gameId: first.snapshot.gameId,
      mode: "ranked",
      status: "active",
    });
  });

  it("replays a start command exactly and hashes command IDs in Redis keys", async () => {
    const { redis, store } = createFixture();
    const first = await startRanked(store, "sensitive command value");
    const retry = await startRanked(store, "sensitive command value");

    expect(retry).toEqual({ ...first, replayed: true });
    expect(redis.keys().some((key) => key.includes("sensitive command"))).toBe(
      false,
    );
    expect(
      redis.value(
        SOLO_STORE_KEYS.start(
          "owner",
          hashSoloCommandId("sensitive command value"),
        ),
      ),
    ).toBeDefined();
  });

  it("rejects Ranked customization, command reuse with different rules, and cross-owner reads", async () => {
    const { store } = createFixture();
    await expect(
      store.start("owner", {
        mode: "ranked",
        commandId: "ranked-custom",
        rules: PRACTICE_RULES,
      }),
    ).rejects.toThrow("unknown field");

    await startPractice(store, "same-start");
    await expect(
      startPractice(store, "same-start", { ...PRACTICE_RULES, winScore: 2 }),
    ).rejects.toMatchObject({ code: "command_conflict" });

    const ranked = await startRanked(store, "owned-game");
    await expect(
      store.getState("attacker", ranked.snapshot.gameId),
    ).rejects.toMatchObject({ code: "not_owner" });
  });

  it("will not overwrite a terminal Ranked mapping whose canonical result is missing", async () => {
    const { redis, store } = createFixture();
    const started = await startRanked(store);
    await store.abandon("owner", {
      gameId: started.snapshot.gameId,
      expectedRevision: started.snapshot.revision,
      commandId: "terminal-cancel",
    });
    redis.externalSet(
      SOLO_STORE_KEYS.activeRanked("owner"),
      started.snapshot.gameId,
    );
    redis.externalDelete(SOLO_STORE_KEYS.result(started.snapshot.gameId));

    await expect(
      store.start("owner", { mode: "ranked", commandId: "replacement" }),
    ).rejects.toMatchObject({ code: "mapping_corrupt" });
    expect(redis.value(SOLO_STORE_KEYS.activeRanked("owner"))).toBe(
      started.snapshot.gameId,
    );
  });

  it("keeps Practice entirely outside every Ranked and legacy HVA key", async () => {
    const { redis, store } = createFixture();
    redis.seed("euclid:elo:hva:owner", JSON.stringify({ rating: 9_999 }));
    redis.seed("euclid:players:hva", JSON.stringify(["legacy-player"]));
    redis.clearAccessLog();

    const started = await startPractice(store);
    const moved = await store.move(
      "owner",
      moveRequest(started.snapshot, "practice-move"),
    );
    const snapshot = moved.snapshot;
    await store.abandon("owner", {
      gameId: snapshot.gameId,
      expectedRevision: snapshot.revision,
      commandId: "practice-abandon",
    });

    const accessed = [...redis.reads, ...redis.watches.flat()];
    expect(accessed.some((key) => key.includes(":ranked:"))).toBe(false);
    expect(accessed.some((key) => key.includes("elo:hva"))).toBe(false);
    expect(accessed.some((key) => key.includes("players:hva"))).toBe(false);
    await expect(store.getRankedRows()).resolves.toEqual([]);
  });
});

describe("SoloStore move commands", () => {
  it("applies one human and one AI move once and records first-move analytics atomically", async () => {
    const { redis, store } = createFixture();
    const started = await startRanked(store);
    const request = moveRequest(started.snapshot, "move-once");
    const first = await store.move("owner", request);
    const retry = await store.move("owner", request);

    expect(first).toMatchObject({ ok: true, accepted: true, replayed: false });
    expect(retry).toEqual({ ...first, replayed: true });
    expect(first.events.filter((event) => event.type === "move")).toHaveLength(
      2,
    );
    expect(
      (await store.getState("owner", started.snapshot.gameId)).humanMoveCount,
    ).toBe(1);
    expect(redis.value(SOLO_STORE_KEYS.aiFirstCount)).toBe("1");
    expect(redis.json(SOLO_STORE_KEYS.aiFirstUsers)).toEqual(["owner"]);
  });

  it("rejects a reused command ID with different intent without changing the game", async () => {
    const { store } = createFixture();
    const started = await startRanked(store);
    const firstPoint = firstEmpty(started.snapshot);
    const first = await store.move(
      "owner",
      moveRequest(started.snapshot, "reused", firstPoint),
    );
    const alternativeIndex = started.snapshot.board.m_board.findIndex(
      (cell, index) =>
        cell === 0 &&
        index !== firstPoint.y * started.snapshot.board.W + firstPoint.x,
    );
    const conflict = await store.move("owner", {
      gameId: started.snapshot.gameId,
      expectedRevision: started.snapshot.revision,
      commandId: "reused",
      x: alternativeIndex % started.snapshot.board.W,
      y: Math.floor(alternativeIndex / started.snapshot.board.W),
    });

    expect(conflict).toMatchObject({
      ok: false,
      accepted: false,
      reason: "command_conflict",
    });
    expect(
      (await store.getState("owner", started.snapshot.gameId)).revision,
    ).toBe(first.snapshot.revision);
  });

  it("accepts only one of two simultaneous commands at the same revision", async () => {
    const { redis, store } = createFixture();
    const started = await startRanked(store);
    const empty = started.snapshot.board.m_board
      .map((cell, index) => ({ cell, index }))
      .filter(({ cell }) => cell === 0)
      .slice(0, 2);
    const responses = await Promise.all(
      empty.map(({ index }, offset) =>
        store.move("owner", {
          gameId: started.snapshot.gameId,
          expectedRevision: started.snapshot.revision,
          commandId: `race-${offset}`,
          x: index % started.snapshot.board.W,
          y: Math.floor(index / started.snapshot.board.W),
        }),
      ),
    );

    expect(responses.filter((response) => response.accepted)).toHaveLength(1);
    expect(responses.find((response) => !response.accepted)).toMatchObject({
      reason: "stale_revision",
    });
    expect(redis.value(SOLO_STORE_KEYS.aiFirstCount)).toBe("1");
  });

  it("returns stale_revision when a retry observes a newer-timestamp move", async () => {
    const { redis, store, setNow } = createFixture();
    const started = await startRanked(store);
    const startedAt = Date.parse(started.snapshot.updatedAt);
    const point = firstEmpty(started.snapshot);
    let committed: SoloMoveResponse | undefined;

    setNow(startedAt + 100);
    redis.beforeExec = async () => {
      redis.beforeExec = undefined;
      setNow(startedAt + 200);
      committed = await store.move("owner", {
        ...moveRequest(started.snapshot, "newer-move", point),
      });
    };

    const delayed = await store.move("owner", {
      ...moveRequest(started.snapshot, "delayed-move", point),
    });
    if (!committed) throw new Error("Expected the concurrent move to commit.");

    expect(committed).toMatchObject({ accepted: true });
    expect(delayed).toMatchObject({
      accepted: false,
      reason: "stale_revision",
      snapshot: {
        revision: committed.snapshot.revision,
        updatedAt: committed.snapshot.updatedAt,
      },
    });
  });

  it("chooses the same Practice AI move after a forced Redis retry", async () => {
    const control = createFixture({
      createGameId: () => "same-game",
      createSeed: () => "same-private-seed",
    });
    const conflicted = createFixture({
      createGameId: () => "same-game",
      createSeed: () => "same-private-seed",
    });
    const controlStart = await startPractice(control.store);
    const conflictStart = await startPractice(conflicted.store);
    const request = moveRequest(controlStart.snapshot, "stable-ai");
    const expected = await control.store.move("owner", request);

    let injected = false;
    conflicted.redis.beforeExec = () => {
      if (injected) return;
      injected = true;
      conflicted.redis.externalSet(SOLO_STORE_KEYS.aiFirstCount, "0");
    };
    const actual = await conflicted.store.move("owner", {
      ...request,
      gameId: conflictStart.snapshot.gameId,
    });

    expect(injected).toBe(true);
    expect(actual.events).toEqual(expected.events);
    expect(actual.snapshot.board.m_history).toEqual(
      expected.snapshot.board.m_history,
    );
  });

  it("caches stale decisions so the same command cannot become valid later", async () => {
    const { store } = createFixture();
    const started = await startRanked(store);
    const staleRequest = {
      ...moveRequest(started.snapshot, "stale-cache"),
      expectedRevision: started.snapshot.revision + 1,
    };
    const first = await store.move("owner", staleRequest);
    expect(first).toMatchObject({ accepted: false, reason: "stale_revision" });

    await store.move(
      "owner",
      moveRequest(started.snapshot, "valid-after-stale"),
    );
    const retry = await store.move("owner", staleRequest);
    expect(retry).toEqual({ ...first, replayed: true });
    expect(retry.snapshot.revision).toBe(started.snapshot.revision);
  });
});

describe("SoloStore Ranked settlement and abandonment", () => {
  it("cancels before the first Ranked human move without rating or completion metrics", async () => {
    const { redis, store } = createFixture();
    const started = await startRanked(store);
    const response = await store.abandon("owner", {
      gameId: started.snapshot.gameId,
      expectedRevision: started.snapshot.revision,
      commandId: "cancel-ranked",
    });
    const result = await store.getResult("owner", started.snapshot.gameId);

    expect(response).toMatchObject({
      ok: true,
      abandoned: true,
      snapshot: { status: "abandoned", rankedAbandonCountsAsLoss: false },
    });
    expect(result).toMatchObject({ rated: false, resultForHuman: null });
    expect(await store.getRankedRating("owner")).toMatchObject({ games: 0 });
    expect(redis.value(SOLO_STORE_KEYS.activeRanked("owner"))).toBeUndefined();
    expect(redis.value(SOLO_STORE_KEYS.aiCompletedCount)).toBeUndefined();
  });

  it("returns game_ended when an abandon retry observes a newer terminal mutation", async () => {
    const { redis, store, setNow } = createFixture();
    const started = await startRanked(store);
    const startedAt = Date.parse(started.snapshot.updatedAt);

    setNow(startedAt + 100);
    redis.beforeExec = async () => {
      redis.beforeExec = undefined;
      setNow(startedAt + 200);
      await store.abandon("owner", {
        gameId: started.snapshot.gameId,
        expectedRevision: started.snapshot.revision,
        commandId: "newer-abandon",
      });
    };

    const delayed = await store.abandon("owner", {
      gameId: started.snapshot.gameId,
      expectedRevision: started.snapshot.revision,
      commandId: "delayed-abandon",
    });

    expect(delayed).toMatchObject({
      abandoned: false,
      reason: "game_ended",
      snapshot: {
        status: "abandoned",
        updatedAt: new Date(startedAt + 200).toISOString(),
      },
    });
  });

  it("settles one loss for Ranked abandonment after a human move and replays it exactly", async () => {
    const { redis, store } = createFixture();
    const started = await startRanked(store);
    const moved = await store.move(
      "owner",
      moveRequest(started.snapshot, "before-abandon"),
    );
    const request = {
      gameId: started.snapshot.gameId,
      expectedRevision: moved.snapshot.revision,
      commandId: "rated-abandon",
    };
    const first = await store.abandon("owner", request);
    const retry = await store.abandon("owner", request);
    const rating = await store.getRankedRating("owner");
    const result = await store.getResult("owner", started.snapshot.gameId);

    expect(first).toMatchObject({
      ok: true,
      abandoned: true,
      snapshot: {
        status: "abandoned",
        outcome: { status: "player2_win", winner: 2 },
        rating: { before: 1200, after: 1197 },
      },
    });
    expect(retry).toEqual({ ...first, replayed: true });
    expect(rating).toMatchObject({ games: 1, losses: 1, rating: 1197 });
    expect(result).toMatchObject({
      rated: true,
      resultForHuman: 0,
      rating: { before: 1200, after: 1197 },
    });
    expect(redis.value(SOLO_STORE_KEYS.aiCompletedCount)).toBeUndefined();
  });

  it("never deletes a newer active mapping while settling an older game", async () => {
    const { redis, store } = createFixture();
    const started = await startRanked(store);
    const moved = await store.move(
      "owner",
      moveRequest(started.snapshot, "old-game-move"),
    );
    redis.externalSet(SOLO_STORE_KEYS.activeRanked("owner"), "newer-game");

    await store.abandon("owner", {
      gameId: started.snapshot.gameId,
      expectedRevision: moved.snapshot.revision,
      commandId: "old-game-abandon",
    });
    expect(redis.value(SOLO_STORE_KEYS.activeRanked("owner"))).toBe(
      "newer-game",
    );
  });

  it("serializes a move-versus-abandon race into one terminal result and one rating", async () => {
    const deterministicOptions = {
      createGameId: () => "terminal-race-game",
      createSeed: () => "terminal-race-seed",
    } satisfies SoloStoreOptions;
    const control = createFixture(deterministicOptions);
    const controlStart = await startRanked(control.store);
    const terminalSequence: Array<{ x: number; y: number }> = [];
    let controlSnapshot = controlStart.snapshot;
    while (controlSnapshot.status === "active") {
      const point = firstEmpty(controlSnapshot);
      terminalSequence.push(point);
      const response = await control.store.move(
        "owner",
        moveRequest(
          controlSnapshot,
          `terminal-control-${terminalSequence.length}`,
          point,
        ),
      );
      if (!response.accepted) throw new Error("Control move was rejected.");
      controlSnapshot = response.snapshot;
    }
    const terminalPoint = terminalSequence.pop();
    if (!terminalPoint) throw new Error("Terminal sequence is empty.");

    const { store } = createFixture(deterministicOptions);
    const started = await startRanked(store);
    let preterminal = started.snapshot;
    for (const [index, point] of terminalSequence.entries()) {
      const response = await store.move(
        "owner",
        moveRequest(preterminal, `terminal-replay-${index}`, point),
      );
      if (!response.accepted) throw new Error("Replay move was rejected.");
      preterminal = response.snapshot;
    }
    expect(preterminal.status).toBe("active");

    const [abandon, move] = await Promise.all([
      store.abandon("owner", {
        gameId: started.snapshot.gameId,
        expectedRevision: preterminal.revision,
        commandId: "race-abandon",
      }),
      store.move("owner", {
        gameId: started.snapshot.gameId,
        expectedRevision: preterminal.revision,
        commandId: "race-move",
        ...terminalPoint,
      }),
    ]);

    expect(Number(abandon.abandoned) + Number(move.accepted)).toBe(1);
    await expect(
      store.getResult("owner", started.snapshot.gameId),
    ).resolves.toMatchObject({ rated: true });
    await expect(store.getRankedRating("owner")).resolves.toMatchObject({
      games: 1,
    });
  });

  it("calculates win, loss, and draw Elo records against the fixed 1600 baseline", () => {
    const initial: SoloRankedRatingRecord = {
      schemaVersion: 1,
      rating: SOLO_RANKED_START_RATING,
      games: 0,
      wins: 0,
      losses: 0,
      draws: 0,
    };
    expect(settleSoloRankedRating(initial, 1)).toMatchObject({
      rating: 1229,
      games: 1,
      wins: 1,
    });
    expect(settleSoloRankedRating(initial, 0)).toMatchObject({
      rating: 1197,
      games: 1,
      losses: 1,
    });
    expect(settleSoloRankedRating(initial, 0.5)).toMatchObject({
      rating: 1213,
      games: 1,
      draws: 1,
    });
  });

  it("returns only versioned r1 Ranked rows and ignores every legacy HVA namespace", async () => {
    const { redis, store } = createFixture();
    redis.seed("euclid:players:hva", JSON.stringify(["legacy"]));
    redis.seed("euclid:elo:hva:legacy", JSON.stringify({ rating: 9_999 }));
    redis.seed("euclid:solo:v1:ranked:r2:players", JSON.stringify(["future"]));
    redis.seed(
      "euclid:solo:v1:ranked:r2:elo:future",
      JSON.stringify({ schemaVersion: 2, rating: 8_888 }),
    );
    expect(await store.getRankedRows()).toEqual([]);

    const started = await startRanked(store);
    const moved = await store.move(
      "owner",
      moveRequest(started.snapshot, "ranking-move"),
    );
    await store.abandon("owner", {
      gameId: started.snapshot.gameId,
      expectedRevision: moved.snapshot.revision,
      commandId: "ranking-loss",
    });
    redis.seed(SOLO_STORE_KEYS.profileName("owner"), "Owner");
    redis.seed(
      SOLO_STORE_KEYS.profileAvatar("owner"),
      "https://avatar.invalid",
    );

    await expect(store.getRankedRows()).resolves.toEqual([
      expect.objectContaining({
        userId: "owner",
        name: "Owner",
        rating: 1197,
        games: 1,
        losses: 1,
      }),
    ]);
    await expect(store.countRankedPlayers()).resolves.toBe(1);
  });
});

describe("SoloStore canonical result sharing", () => {
  it("rejects sharing a canonical loss", async () => {
    const { store } = createFixture();
    const ranked = await startRanked(store);
    const rankedMove = await store.move(
      "owner",
      moveRequest(ranked.snapshot, "share-loss-move"),
    );
    await store.abandon("owner", {
      gameId: ranked.snapshot.gameId,
      expectedRevision: rankedMove.snapshot.revision,
      commandId: "share-loss-abandon",
    });
    await expect(
      store.prepareShare("owner", {
        gameId: ranked.snapshot.gameId,
        commandId: "unshareable",
        subredditName: "test",
        humanName: "Owner",
      }),
    ).rejects.toMatchObject({ code: "result_not_shareable" });
  });

  it("prepares and posts one player-two Practice victory without exposing private AI state", async () => {
    const { redis, store } = createFixture();
    const win = await findPracticeHumanWin(store);
    expect(win.finalSnapshot.canShare).toBe(true);
    const completionCount = redis.value(SOLO_STORE_KEYS.aiCompletedCount);
    const retriedMove = await store.move("owner", win.finalRequest);
    expect(retriedMove).toMatchObject({ replayed: true, accepted: true });
    expect(redis.value(SOLO_STORE_KEYS.aiCompletedCount)).toBe(completionCount);
    expect(redis.json(SOLO_STORE_KEYS.aiCompletedUsers)).toEqual(["owner"]);
    expect(redis.value(SOLO_STORE_KEYS.aiDifficultyCount("doofus"))).toBe(
      completionCount,
    );
    expect(
      redis.value(SOLO_STORE_KEYS.aiDailyCount("doofus", "2026-09-01")),
    ).toBe(completionCount);

    const terminal = await store.getTerminalResult(
      "owner",
      win.start.snapshot.gameId,
    );
    expect(terminal).toMatchObject({
      mode: "practice",
      humanPlayer: 1,
      resultForHuman: 1,
    });
    expect("rating" in terminal).toBe(false);

    const input = {
      gameId: win.start.snapshot.gameId,
      commandId: "share-win",
      subredditName: "euclid_test",
      humanName: "Owner",
      humanAvatar: "https://avatar.invalid/owner.png",
    };
    const preparations = await Promise.all([
      store.prepareShare("owner", input),
      store.prepareShare("owner", { ...input, commandId: "second-click" }),
    ]);
    expect(
      preparations.filter((preparation) => preparation.shouldSubmit),
    ).toHaveLength(1);
    const prepared = preparations.find(
      (preparation) => preparation.shouldSubmit,
    );
    const repeatedPrepared = preparations.find(
      (preparation) => !preparation.shouldSubmit,
    );
    if (!prepared || !repeatedPrepared) {
      throw new Error("Concurrent share preparation did not resolve.");
    }
    expect(prepared).toMatchObject({
      shouldSubmit: true,
      receipt: {
        status: "prepared",
        payload: {
          winnerSide: 2,
          p1Name: "Euclid",
          p2Name: "Owner",
          subtitle: expect.stringContaining("Practice"),
          solo: { mode: "practice" },
          board: { solo: { rules: { firstPlayer: 1 } } },
        },
      },
    });
    expect(repeatedPrepared).toEqual({
      receipt: prepared.receipt,
      shouldSubmit: false,
    });
    expect("m_targets" in prepared.receipt.payload.board).toBe(false);

    const posted = await store.finalizeShare("owner", {
      gameId: input.gameId,
      shareId: prepared.receipt.shareId,
      postId: "post-1",
      permalink: "/r/euclid_test/comments/post-1/result/",
      runAs: "APP",
    });
    const repeatedPosted = await store.finalizeShare("owner", {
      gameId: input.gameId,
      shareId: prepared.receipt.shareId,
      postId: "post-2",
      permalink: "/r/euclid_test/comments/post-2/result/",
      runAs: "USER",
    });
    const preparedAfterPost = await store.prepareShare("owner", {
      ...input,
      commandId: "third-click",
    });
    expect(posted).toMatchObject({ status: "posted", postId: "post-1" });
    expect(repeatedPosted).toEqual(posted);
    expect(preparedAfterPost).toEqual({
      receipt: posted,
      shouldSubmit: false,
    });
    expect(
      redis.json(SOLO_STORE_KEYS.sharedPost(prepared.receipt.shareId)),
    ).toEqual(prepared.receipt.payload);
    expect(
      [...redis.reads, ...redis.watches.flat()].some((key) =>
        key.includes(":ranked:"),
      ),
    ).toBe(false);
  });

  it("recovers an explicit submission failure without changing the canonical payload or posting twice", async () => {
    const { redis, setNow, store } = createFixture();
    const win = await findPracticeHumanWin(store);
    const input = {
      gameId: win.start.snapshot.gameId,
      commandId: "initial-share-attempt",
      subredditName: "euclid_test",
      humanName: "Owner",
      humanAvatar: "https://avatar.invalid/owner.png",
    };
    const prepared = await store.prepareShare("owner", input);
    expect(prepared).toMatchObject({
      shouldSubmit: true,
      receipt: { status: "prepared" },
    });
    const originalPayload = prepared.receipt.payload;
    const originalShareId = prepared.receipt.shareId;

    setNow(Date.UTC(2026, 8, 1, 12, 1));
    const failed = await store.failShare("owner", {
      gameId: input.gameId,
      shareId: originalShareId,
      failureMessage: "Reddit post submission timed out.",
    });
    expect(failed).toMatchObject({
      status: "failed",
      shareId: originalShareId,
      failureMessage: "Reddit post submission timed out.",
      failedAt: "2026-09-01T12:01:00.000Z",
      payload: originalPayload,
    });
    await expect(
      store.failShare("owner", {
        gameId: input.gameId,
        shareId: originalShareId,
        failureMessage: "A later duplicate failure must not replace the first.",
      }),
    ).resolves.toEqual(failed);
    await expect(
      store.finalizeShare("owner", {
        gameId: input.gameId,
        shareId: originalShareId,
        postId: "post-before-reclaim",
        permalink: "/r/euclid_test/comments/post-before-reclaim/result/",
        runAs: "APP",
      }),
    ).rejects.toMatchObject({ code: "share_conflict" });

    setNow(Date.UTC(2026, 8, 1, 12, 2));
    const retries = await Promise.all([
      store.prepareShare("owner", {
        ...input,
        commandId: "retry-a",
        humanName: "Changed Name",
      }),
      store.prepareShare("owner", {
        ...input,
        commandId: "retry-b",
        subredditName: "changed_subreddit",
      }),
    ]);
    expect(retries.filter((retry) => retry.shouldSubmit)).toHaveLength(1);
    const reclaimed = retries.find((retry) => retry.shouldSubmit);
    const pending = retries.find((retry) => !retry.shouldSubmit);
    if (!reclaimed || !pending) {
      throw new Error("Failed share reclamation did not resolve atomically.");
    }
    expect(pending.receipt).toEqual(reclaimed.receipt);
    expect(reclaimed.receipt).toMatchObject({
      status: "prepared",
      shareId: originalShareId,
      preparedAt: "2026-09-01T12:02:00.000Z",
      payload: originalPayload,
    });
    expect(reclaimed.receipt.commandHash).toBe(
      hashSoloCommandId(reclaimed.receipt.commandId),
    );
    expect("failedAt" in reclaimed.receipt).toBe(false);
    expect("failureMessage" in reclaimed.receipt).toBe(false);
    expect(redis.json(SOLO_STORE_KEYS.sharedPost(originalShareId))).toEqual(
      originalPayload,
    );

    const posted = await store.finalizeShare("owner", {
      gameId: input.gameId,
      shareId: originalShareId,
      postId: "post-after-reclaim",
      permalink: "/r/euclid_test/comments/post-after-reclaim/result/",
      runAs: "APP",
    });
    expect(posted).toMatchObject({
      status: "posted",
      postId: "post-after-reclaim",
    });
    await expect(
      store.failShare("owner", {
        gameId: input.gameId,
        shareId: originalShareId,
        failureMessage: "A stale failure arrived after finalization.",
      }),
    ).resolves.toEqual(posted);
    await expect(
      store.prepareShare("owner", {
        ...input,
        commandId: "retry-after-post",
      }),
    ).resolves.toEqual({ receipt: posted, shouldSubmit: false });
  });

  it("rejects foreign, stale, invalid, or payload-inconsistent failure reports without changing the receipt", async () => {
    const { redis, store } = createFixture();
    const win = await findPracticeHumanWin(store);
    const prepared = await store.prepareShare("owner", {
      gameId: win.start.snapshot.gameId,
      commandId: "protected-share",
      subredditName: "euclid_test",
      humanName: "Owner",
    });
    const shareKey = SOLO_STORE_KEYS.share(win.start.snapshot.gameId);
    const receiptBefore = redis.value(shareKey);
    const failure = {
      gameId: win.start.snapshot.gameId,
      shareId: prepared.receipt.shareId,
      failureMessage: "External submission failed.",
    };

    await expect(store.failShare("attacker", failure)).rejects.toMatchObject({
      code: "not_owner",
    });
    await expect(
      store.failShare("owner", { ...failure, shareId: "stale-share-id" }),
    ).rejects.toMatchObject({ code: "share_conflict" });
    await expect(
      store.failShare("owner", { ...failure, failureMessage: "   " }),
    ).rejects.toMatchObject({ code: "invalid_identifier" });
    expect(redis.value(shareKey)).toBe(receiptBefore);

    const payloadKey = SOLO_STORE_KEYS.sharedPost(prepared.receipt.shareId);
    redis.externalSet(
      payloadKey,
      JSON.stringify({
        ...prepared.receipt.payload,
        headline: "Forged payload",
      }),
    );
    await expect(store.failShare("owner", failure)).rejects.toMatchObject({
      code: "data_corrupt",
    });
    expect(redis.value(shareKey)).toBe(receiptBefore);
  });
});

describe("SoloStore data integrity", () => {
  it("fails closed on a forged canonical board and never creates a command receipt", async () => {
    const { redis, store } = createFixture();
    const started = await startRanked(store);
    const gameKey = SOLO_STORE_KEYS.game(started.snapshot.gameId);
    const forged = redis.json<Record<string, unknown>>(gameKey);
    if (!forged || typeof forged.board !== "object" || forged.board === null) {
      throw new Error("Missing game fixture.");
    }
    const board = forged.board as Record<string, unknown>;
    board.m_board = (board.m_board as number[]).map((cell, index) =>
      index === 1 ? 2 : cell,
    );
    redis.externalSet(gameKey, JSON.stringify(forged));

    const commandId = "forged-move";
    await expect(
      store.move("owner", moveRequest(started.snapshot, commandId)),
    ).rejects.toThrow("canonical");
    expect(
      redis.value(
        SOLO_STORE_KEYS.move(
          started.snapshot.gameId,
          hashSoloCommandId(commandId),
        ),
      ),
    ).toBeUndefined();
  });
});
