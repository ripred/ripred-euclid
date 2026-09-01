import { describe, expect, it } from "vitest";

import type { H2HLeaveRequest, H2HMoveRequest } from "../shared/types/api";
import {
  H2H_RULES,
  H2HDomainError,
  applyH2HMove,
  createInitialH2HBoard,
  endH2HByDeparture,
  type H2HBoardSnapshot,
} from "./h2h";
import {
  H2H_CHAT_RATE_LIMIT_MS,
  H2HStore,
  H2HStoreError,
  H2H_STORE_KEYS,
  parseH2HSettlementEvents,
  type H2HStoreOptions,
} from "./h2h-store";
import type {
  RedisCasClient,
  RedisCasTransaction,
  RedisCasWrite,
} from "./redis-cas";

class MemoryRedis implements RedisCasClient {
  readonly commits: RedisCasWrite[][] = [];
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

  version(key: string): number {
    return this.versions.get(key) ?? 0;
  }

  async get(key: string): Promise<string | undefined> {
    return this.value(key);
  }

  async watch(...keys: string[]): Promise<RedisCasTransaction> {
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

function createFixture(options: H2HStoreOptions = {}): {
  redis: MemoryRedis;
  store: H2HStore;
  setNow: (value: number) => void;
} {
  const redis = new MemoryRedis();
  let timestamp = 1_000;
  let sequence = 0;
  const store = new H2HStore(redis, {
    now: () => timestamp,
    createGameId: () => `game-${++sequence}`,
    maxIdleMs: 100,
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

async function pair(
  store: H2HStore,
  first = "p1",
  second = "p2",
): Promise<string> {
  await expect(store.queueOrResume(first)).resolves.toMatchObject({
    status: "queued",
  });
  const result = await store.queueOrResume(second);
  expect(result.status).toBe("paired");
  if (result.status !== "paired") throw new Error("Pairing failed.");
  return result.gameId;
}

function move(gameId: string, x: number, y: number, revision: number) {
  return { gameId, x, y, expectedRevision: revision } satisfies H2HMoveRequest;
}

function leaveRequest(gameId: string, expectedRevision = 0): H2HLeaveRequest {
  return { gameId, expectedRevision };
}

function terminalMoveFixture(gameId: string): {
  board: H2HBoardSnapshot;
  request: H2HMoveRequest;
  userId: string;
} {
  let board = createInitialH2HBoard("p1", "p2", { now: 100 });
  const firstPlayerIndexes = [
    0, 7, 56, 63, 1, 6, 49, 54, 8, 15, 48, 55, 2, 5, 42, 45,
  ];
  const reserved = new Set(firstPlayerIndexes);
  const secondPlayerIndexes = [...Array(H2H_RULES.W * H2H_RULES.H).keys()]
    .filter((index) => !reserved.has(index))
    .reverse();
  let firstOffset = 0;
  let secondOffset = 0;

  for (let moveNumber = 0; moveNumber < 64; moveNumber++) {
    const index =
      board.m_turn === 0
        ? firstPlayerIndexes[firstOffset++]
        : secondPlayerIndexes[secondOffset++];
    if (index === undefined) break;
    const userId = board.m_players[board.m_turn].userId;
    const request = move(
      gameId,
      index % H2H_RULES.W,
      Math.floor(index / H2H_RULES.W),
      board.revision,
    );
    const result = applyH2HMove(board, userId, request, 101 + moveNumber);
    if (result.ended) return { board, request, userId };
    board = result.board;
  }
  throw new Error("Terminal move fixture did not reach a legal outcome.");
}

describe("H2H queue and mappings", () => {
  it("pairs atomically, resumes live mappings, and never duplicates a caller", async () => {
    const { redis, store } = createFixture();
    await Promise.all([store.queueOrResume("p1"), store.queueOrResume("p1")]);
    expect(redis.json(H2H_STORE_KEYS.queue)).toEqual(["p1"]);

    const paired = await store.queueOrResume("p2");
    expect(paired).toMatchObject({
      status: "paired",
      gameId: expect.any(String),
    });
    if (paired.status !== "paired") throw new Error("Pairing failed.");

    expect(redis.value(H2H_STORE_KEYS.userGame("p1"))).toBe(paired.gameId);
    expect(redis.value(H2H_STORE_KEYS.userGame("p2"))).toBe(paired.gameId);
    expect(redis.json(H2H_STORE_KEYS.queue)).toEqual([]);
    expect(redis.json(H2H_STORE_KEYS.activeGames)).toEqual([paired.gameId]);

    const pairingCommit = redis.commits.find((writes) =>
      writes.some(
        (write) =>
          write.action === "set" &&
          write.key === H2H_STORE_KEYS.game(paired.gameId),
      ),
    );
    expect(new Set(pairingCommit?.map((write) => write.key))).toEqual(
      new Set([
        H2H_STORE_KEYS.queue,
        H2H_STORE_KEYS.activeGames,
        H2H_STORE_KEYS.game(paired.gameId),
        H2H_STORE_KEYS.userGame("p1"),
        H2H_STORE_KEYS.userGame("p2"),
      ]),
    );

    await expect(store.queueOrResume("p1")).resolves.toMatchObject({
      status: "resumed",
      gameId: paired.gameId,
    });
    expect(redis.value(H2H_STORE_KEYS.userGame("p1"))).toBe(paired.gameId);
  });

  it("pairs concurrent callers into disjoint games", async () => {
    const { redis, store } = createFixture();
    await Promise.all(
      ["a", "b", "c", "d"].map((userId) => store.queueOrResume(userId)),
    );

    const mappings = ["a", "b", "c", "d"].map((userId) =>
      redis.value(H2H_STORE_KEYS.userGame(userId)),
    );
    expect(mappings.every(Boolean)).toBe(true);
    expect(new Set(mappings).size).toBe(2);
    for (const gameId of new Set(mappings)) {
      const players = ["a", "b", "c", "d"].filter(
        (userId) => redis.value(H2H_STORE_KEYS.userGame(userId)) === gameId,
      );
      expect(players).toHaveLength(2);
    }
  });

  it("cancel removes queue membership only, including during pairing races", async () => {
    const { redis, store } = createFixture();
    await store.queueOrResume("p1");
    await Promise.allSettled([
      store.queueOrResume("p2"),
      store.cancelQueue("p1"),
    ]);

    const firstMapping = redis.value(H2H_STORE_KEYS.userGame("p1"));
    const secondMapping = redis.value(H2H_STORE_KEYS.userGame("p2"));
    if (firstMapping) {
      expect(secondMapping).toBe(firstMapping);
      await expect(store.cancelQueue("p1")).resolves.toEqual({
        removed: false,
      });
      expect(redis.value(H2H_STORE_KEYS.userGame("p1"))).toBe(firstMapping);
    } else {
      expect(secondMapping).toBeUndefined();
    }
  });

  it("deletes a mapping only while it still equals the expected game", async () => {
    const { redis, store } = createFixture();
    redis.seed(H2H_STORE_KEYS.userGame("p1"), "old-game");
    let changed = false;
    redis.beforeExec = () => {
      if (changed) return;
      changed = true;
      redis.externalSet(H2H_STORE_KEYS.userGame("p1"), "new-game");
    };

    await expect(store.deleteMappingIfEqual("p1", "old-game")).resolves.toBe(
      false,
    );
    expect(redis.value(H2H_STORE_KEYS.userGame("p1"))).toBe("new-game");
  });

  it("reads state without treating a missing opponent mapping as a leave", async () => {
    const { redis, store } = createFixture();
    const gameId = await pair(store);
    const before = redis.value(H2H_STORE_KEYS.game(gameId));
    redis.externalDelete(H2H_STORE_KEYS.userGame("p2"));

    await expect(store.getState(gameId)).resolves.toMatchObject({
      ended: false,
      victorSide: null,
    });
    expect(redis.value(H2H_STORE_KEYS.game(gameId))).toBe(before);
  });

  it("reads canonical mappings without mutating live or dangling state", async () => {
    const { redis, store } = createFixture();
    const gameId = await pair(store);
    const commitCount = redis.commits.length;

    await expect(store.getMapping("p2")).resolves.toMatchObject({
      gameId,
      isPlayer1: false,
      state: { gameId, revision: 0, ended: false },
    });
    redis.externalSet(H2H_STORE_KEYS.userGame("orphan"), "missing-game");
    await expect(store.getMapping("orphan")).resolves.toEqual({
      gameId: "missing-game",
      isPlayer1: null,
      state: null,
    });
    expect(redis.commits).toHaveLength(commitCount);
  });
});

describe("H2H canonical mutations", () => {
  it("serializes simultaneous moves and preserves one canonical revision", async () => {
    const { redis, store } = createFixture();
    const gameId = await pair(store);
    const results = await Promise.allSettled([
      store.applyMove("p1", move(gameId, 0, 0, 0)),
      store.applyMove("p1", move(gameId, 1, 0, 0)),
    ]);

    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    const rejected = results.find((result) => result.status === "rejected");
    expect(rejected).toMatchObject({
      status: "rejected",
      reason: expect.any(H2HDomainError),
    });
    const state = await store.getState(gameId);
    expect(state).toMatchObject({ revision: 1, ended: false });
    expect(
      state?.board.m_board.filter((cell: number) => cell !== 0),
    ).toHaveLength(1);
    expect(redis.value(H2H_STORE_KEYS.pendingSettlements)).toBeUndefined();
  });

  it("commits a terminal move and its unique settlement event together", async () => {
    const { redis, store } = createFixture();
    const gameId = "terminal-move";
    const fixture = terminalMoveFixture(gameId);
    redis.seed(H2H_STORE_KEYS.game(gameId), JSON.stringify(fixture.board));
    redis.seed(H2H_STORE_KEYS.userGame("p1"), gameId);
    redis.seed(H2H_STORE_KEYS.userGame("p2"), gameId);
    redis.seed(H2H_STORE_KEYS.activeGames, JSON.stringify([gameId]));

    const commit = await store.applyMove(fixture.userId, fixture.request);

    expect(commit).toMatchObject({
      response: { ended: true, gameId },
      settlementEvent: {
        eventId: `${gameId}:${fixture.board.revision + 1}`,
        gameId,
        revision: fixture.board.revision + 1,
      },
    });
    const outbox = parseH2HSettlementEvents(
      redis.value(H2H_STORE_KEYS.pendingSettlements),
    );
    expect(outbox).toEqual([commit.settlementEvent]);
    const terminalCommit = redis.commits.find((writes) =>
      writes.some(
        (write) =>
          write.action === "set" &&
          write.key === H2H_STORE_KEYS.game(gameId) &&
          JSON.parse(write.value).ended === true,
      ),
    );
    expect(terminalCommit?.map((write) => write.key)).toContain(
      H2H_STORE_KEYS.pendingSettlements,
    );
  });

  it("returns exactly one forfeit transition and keeps the opponent mapping", async () => {
    const { redis, store } = createFixture();
    const gameId = await pair(store);
    const results = await Promise.all([
      store.leave("p1", leaveRequest(gameId)),
      store.leave("p1", leaveRequest(gameId)),
    ]);

    expect(
      results.filter((result) => result.causedForfeitTransition),
    ).toHaveLength(1);
    const transition = results.find((result) => result.causedForfeitTransition);
    expect(transition?.settlementEvent).toMatchObject({
      eventId: `${gameId}:1`,
      gameId,
      revision: 1,
      endedReason: "player_left",
      endedBy: "p1",
      resultForFirst: 0,
    });
    expect(
      parseH2HSettlementEvents(redis.value(H2H_STORE_KEYS.pendingSettlements)),
    ).toEqual([transition?.settlementEvent]);
    expect(redis.value(H2H_STORE_KEYS.userGame("p1"))).toBeUndefined();
    expect(redis.value(H2H_STORE_KEYS.userGame("p2"))).toBe(gameId);
    await expect(store.getState(gameId)).resolves.toMatchObject({
      revision: 1,
      ended: true,
      endedReason: "player_left",
      victorSide: 2,
    });
  });

  it("never follows a concurrently changed mapping into a newer game", async () => {
    const { redis, store } = createFixture();
    const oldGameId = await pair(store);
    const newGameId = "new-game";
    const newBoard = createInitialH2HBoard("p1", "p3", { now: 1_000 });
    redis.seed(H2H_STORE_KEYS.game(newGameId), JSON.stringify(newBoard));
    redis.seed(H2H_STORE_KEYS.userGame("p3"), newGameId);
    redis.seed(
      H2H_STORE_KEYS.activeGames,
      JSON.stringify([newGameId, oldGameId]),
    );

    let changed = false;
    redis.beforeExec = () => {
      if (changed) return;
      changed = true;
      redis.externalSet(H2H_STORE_KEYS.userGame("p1"), newGameId);
    };

    await expect(
      store.leave("p1", leaveRequest(oldGameId)),
    ).rejects.toMatchObject({
      name: "H2HStoreError",
      code: "mapping_conflict",
    } satisfies Partial<H2HStoreError>);
    expect(redis.value(H2H_STORE_KEYS.userGame("p1"))).toBe(newGameId);
    await expect(store.getState(oldGameId)).resolves.toMatchObject({
      revision: 0,
      ended: false,
    });
    await expect(store.getState(newGameId)).resolves.toMatchObject({
      revision: 0,
      ended: false,
    });
  });

  it("rematches atomically with a monotonic revision and restored mappings", async () => {
    const { redis, store } = createFixture();
    const gameId = await pair(store);
    await store.leave("p1", leaveRequest(gameId));
    const ended = await store.getState(gameId);

    const rematch = await store.rematch("p2", gameId);

    expect(rematch).toMatchObject({
      gameId,
      revision: (ended?.revision ?? 0) + 1,
      ended: false,
    });
    expect(rematch.board.m_history).toEqual([]);
    expect(redis.value(H2H_STORE_KEYS.userGame("p1"))).toBe(gameId);
    expect(redis.value(H2H_STORE_KEYS.userGame("p2"))).toBe(gameId);
    expect(redis.json(H2H_STORE_KEYS.activeGames)).toContain(gameId);
    expect(
      parseH2HSettlementEvents(redis.value(H2H_STORE_KEYS.pendingSettlements)),
    ).toEqual([
      expect.objectContaining({ eventId: `${gameId}:1`, revision: 1 }),
    ]);
  });

  it("does not manufacture settlement events while reading legacy ended games", async () => {
    const { redis, store } = createFixture();
    const gameId = "legacy-ended";
    const initial = createInitialH2HBoard("p1", "p2", { now: 100 });
    const ended = endH2HByDeparture(initial, "p1", gameId, 101);
    redis.seed(H2H_STORE_KEYS.game(gameId), JSON.stringify(ended.board));

    await expect(store.getState(gameId)).resolves.toMatchObject({
      ended: true,
      revision: 1,
    });
    expect(redis.value(H2H_STORE_KEYS.pendingSettlements)).toBeUndefined();
  });

  it("rejects a delayed leave after a same-id rematch", async () => {
    const { redis, store } = createFixture();
    const gameId = await pair(store);
    await store.leave("p1", leaveRequest(gameId));
    const rematch = await store.rematch("p2", gameId);

    await expect(
      store.leave("p1", leaveRequest(gameId, 0)),
    ).rejects.toMatchObject({
      name: "H2HDomainError",
      code: "stale_revision",
      state: { gameId, revision: rematch.revision, ended: false },
    });
    expect(redis.value(H2H_STORE_KEYS.userGame("p1"))).toBe(gameId);
    await expect(store.getState(gameId)).resolves.toMatchObject({
      revision: rematch.revision,
      ended: false,
    });
  });

  it("does not overwrite a concurrent move while appending chat", async () => {
    const { store } = createFixture();
    const gameId = await pair(store);
    const [moveResult, chatResult] = await Promise.allSettled([
      store.applyMove("p1", move(gameId, 0, 0, 0)),
      store.appendChat("p1", gameId, "hello"),
    ]);

    expect(chatResult.status).toBe("fulfilled");
    if (chatResult.status !== "fulfilled") throw chatResult.reason;
    if (moveResult.status === "rejected") {
      const afterChat = await store.getState(gameId);
      await store.applyMove(
        "p1",
        move(gameId, 0, 0, afterChat?.revision ?? -1),
      );
    }

    expect(chatResult.value.item.text).toBe("hello");
    const state = await store.getState(gameId);
    expect(state?.revision).toBe(2);
    expect(state?.board.m_board[0]).toBe(1);
    expect(state?.board.chat?.items).toContainEqual(chatResult.value.item);
  });

  it("uses the persisted timestamp when a chat retry follows a newer mutation", async () => {
    const { redis, store, setNow } = createFixture();
    const gameId = await pair(store);

    setNow(1_500);
    redis.beforeExec = async () => {
      redis.beforeExec = undefined;
      setNow(2_000);
      await store.applyMove("p1", move(gameId, 0, 0, 0));
    };

    const chat = await store.appendChat("p2", gameId, "after move");

    expect(chat.item).toMatchObject({
      ts: 2_000,
      sender: "p2",
      text: "after move",
    });
    expect(chat.state).toMatchObject({
      revision: 2,
      board: { lastSaved: 2_000 },
    });
    expect(chat.state.board.m_board[0]).toBe(1);
    expect(redis.value(H2H_STORE_KEYS.chatLast("p2"))).toBe("2000");
  });

  it("still rejects an invalid captured chat timestamp", async () => {
    const { store, setNow } = createFixture();
    const gameId = await pair(store);
    setNow(-1);

    await expect(
      store.appendChat("p1", gameId, "invalid time"),
    ).rejects.toMatchObject({
      name: "H2HDomainError",
      code: "invalid_request",
      message: "now must be a non-negative safe integer timestamp.",
    } satisfies Partial<H2HDomainError>);
  });

  it("rate-limits chat inside the same canonical transaction", async () => {
    const { redis, store, setNow } = createFixture();
    const gameId = await pair(store);
    const first = await store.appendChat("p1", gameId, "first");

    setNow(1_500);
    await expect(store.appendChat("p1", gameId, "too soon")).rejects.toEqual(
      expect.objectContaining({
        name: "H2HStoreError",
        code: "chat_rate_limited",
        retryAfterMs: 500,
      }),
    );
    expect(redis.value(H2H_STORE_KEYS.chatLast("p1"))).toBe("1000");
    await expect(store.getState(gameId)).resolves.toMatchObject({
      revision: first.state.revision,
      board: { chat: { seq: 1 } },
    });

    setNow(1_000 + H2H_CHAT_RATE_LIMIT_MS);
    const second = await store.appendChat("p1", gameId, "second");
    expect(second.state).toMatchObject({
      revision: first.state.revision + 1,
      board: { chat: { seq: 2 } },
    });
  });

  it("allows only one of two simultaneous chat messages", async () => {
    const { store } = createFixture();
    const gameId = await pair(store);

    const results = await Promise.allSettled([
      store.appendChat("p1", gameId, "one"),
      store.appendChat("p1", gameId, "two"),
    ]);

    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    const rejected = results.find((result) => result.status === "rejected");
    expect(rejected).toMatchObject({
      status: "rejected",
      reason: expect.objectContaining({
        name: "H2HStoreError",
        code: "chat_rate_limited",
        retryAfterMs: H2H_CHAT_RATE_LIMIT_MS,
      }),
    });
    await expect(store.getState(gameId)).resolves.toMatchObject({
      revision: 1,
      board: { chat: { seq: 1, items: [expect.any(Object)] } },
    });
  });

  it("does not append chat after the caller mapping changes during commit", async () => {
    const { redis, store } = createFixture();
    const gameId = await pair(store);
    let changed = false;
    redis.beforeExec = () => {
      if (changed) return;
      changed = true;
      redis.externalSet(H2H_STORE_KEYS.userGame("p1"), "new-game");
    };

    await expect(store.appendChat("p1", gameId, "stale")).rejects.toMatchObject(
      {
        name: "H2HStoreError",
        code: "mapping_conflict",
      } satisfies Partial<H2HStoreError>,
    );
    expect(redis.value(H2H_STORE_KEYS.userGame("p1"))).toBe("new-game");
    expect(redis.value(H2H_STORE_KEYS.chatLast("p1"))).toBeUndefined();
    await expect(store.getState(gameId)).resolves.toMatchObject({
      revision: 0,
      board: { chat: { seq: 0, items: [] } },
    });
  });

  it("prevents rematch from overwriting another live mapping", async () => {
    const { redis, store } = createFixture();
    const gameId = await pair(store);
    await store.leave("p1", leaveRequest(gameId));
    redis.externalSet(H2H_STORE_KEYS.userGame("p1"), "other-game");

    await expect(store.rematch("p2", gameId)).rejects.toMatchObject({
      name: "H2HStoreError",
      code: "mapping_conflict",
    } satisfies Partial<H2HStoreError>);
    expect(redis.value(H2H_STORE_KEYS.userGame("p1"))).toBe("other-game");
  });
});

describe("H2H live listing and stale cleanup", () => {
  it("cleans stale games and deletes only mappings that still match", async () => {
    const { redis, store, setNow } = createFixture();
    const gameId = await pair(store);
    redis.externalSet(H2H_STORE_KEYS.userGame("p1"), "other-game");
    setNow(1_101);

    const cleanup = await store.cleanupStaleGame(gameId);

    expect(cleanup).toEqual({
      gameId,
      deletedGame: true,
      removedFromActive: true,
      deletedMappings: ["p2"],
    });
    expect(redis.value(H2H_STORE_KEYS.game(gameId))).toBeUndefined();
    expect(redis.value(H2H_STORE_KEYS.userGame("p1"))).toBe("other-game");
    expect(redis.value(H2H_STORE_KEYS.userGame("p2"))).toBeUndefined();
  });

  it("lists fresh games and race-safely removes stale active entries", async () => {
    const { redis, store, setNow } = createFixture();
    const staleId = await pair(store, "old-1", "old-2");
    setNow(1_050);
    const freshId = await pair(store, "new-1", "new-2");
    setNow(1_101);

    await expect(store.listLiveGames()).resolves.toEqual([
      expect.objectContaining({ gameId: freshId, revision: 0 }),
    ]);
    expect(redis.value(H2H_STORE_KEYS.game(staleId))).toBeUndefined();
    expect(redis.json(H2H_STORE_KEYS.activeGames)).toEqual([freshId]);
  });

  it("queueing cleans a caller's stale game before re-enqueueing", async () => {
    const { redis, store, setNow } = createFixture();
    const gameId = await pair(store);
    setNow(1_101);

    await expect(store.queueOrResume("p1")).resolves.toMatchObject({
      status: "queued",
    });
    expect(redis.value(H2H_STORE_KEYS.game(gameId))).toBeUndefined();
    expect(redis.value(H2H_STORE_KEYS.userGame("p1"))).toBeUndefined();
    expect(redis.value(H2H_STORE_KEYS.userGame("p2"))).toBeUndefined();
    expect(redis.json(H2H_STORE_KEYS.queue)).toEqual(["p1"]);
  });
});
