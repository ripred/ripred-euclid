import { describe, expect, it } from "vitest";

import {
  H2HSettlementService,
  H2H_SETTLEMENT_KEYS,
  type H2HEloRecord,
} from "./h2h-settlement";
import {
  H2HSettlementDataError,
  H2H_STORE_KEYS,
  h2hSettlementFingerprint,
  normalizeH2HSettlementEvent,
  parseH2HSettlementEvents,
  serializeH2HSettlementEvents,
  type H2HSettlementEvent,
} from "./h2h-store";
import {
  RedisCasConflictExhaustedError,
  type RedisCasClient,
  type RedisCasTransaction,
  type RedisCasWrite,
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

const ENDED_AT = Date.UTC(2026, 0, 2, 12);

function event(
  overrides: Partial<H2HSettlementEvent> = {},
): H2HSettlementEvent {
  const gameId = overrides.gameId ?? "game";
  const revision = overrides.revision ?? 1;
  return normalizeH2HSettlementEvent({
    version: 1,
    eventId: `${gameId}:${revision}`,
    gameId,
    revision,
    playerIds: ["p1", "p2"],
    resultForFirst: 1,
    endedReason: "game_over",
    endedBy: null,
    endedAt: ENDED_AT,
    ...overrides,
  });
}

function forfeitEvent(
  gameId: string,
  revision: number,
  firstId = "p1",
  secondId = "p2",
): H2HSettlementEvent {
  return event({
    gameId,
    revision,
    eventId: `${gameId}:${revision}`,
    playerIds: [firstId, secondId],
    resultForFirst: 0,
    endedReason: "player_left",
    endedBy: firstId,
  });
}

function tieEvent(
  gameId: string,
  revision: number,
  firstId = "p1",
  secondId = "p2",
): H2HSettlementEvent {
  return event({
    gameId,
    revision,
    eventId: `${gameId}:${revision}`,
    playerIds: [firstId, secondId],
    resultForFirst: 0.5,
    endedReason: "tie",
    endedBy: null,
  });
}

function seedOutbox(
  redis: MemoryRedis,
  events: readonly H2HSettlementEvent[],
): void {
  redis.seed(
    H2H_STORE_KEYS.pendingSettlements,
    serializeH2HSettlementEvents(events),
  );
}

function elo(
  rating: number,
  games: number,
  wins: number,
  losses: number,
  draws: number,
): H2HEloRecord {
  return { rating, games, wins, losses, draws };
}

describe("H2H durable settlement", () => {
  it("atomically migrates legacy Elo and records rating, metrics, and receipt", async () => {
    const redis = new MemoryRedis();
    const terminal = event();
    seedOutbox(redis, [terminal]);
    redis.seed(
      H2H_SETTLEMENT_KEYS.legacyElo("p1"),
      JSON.stringify(elo(1_300, 2, 1, 1, 0)),
    );
    redis.seed(H2H_SETTLEMENT_KEYS.players, JSON.stringify(["existing"]));
    const service = new H2HSettlementService(redis, {
      now: () => ENDED_AT + 1,
    });

    await expect(service.settle(terminal)).resolves.toMatchObject({
      eventId: "game:1",
      status: "settled",
      receipt: { eventId: "game:1", settledAt: ENDED_AT + 1 },
    });

    expect(
      parseH2HSettlementEvents(redis.value(H2H_STORE_KEYS.pendingSettlements)),
    ).toEqual([]);
    expect(redis.value(H2H_SETTLEMENT_KEYS.legacyElo("p1"))).toBeUndefined();
    expect(
      redis.json<H2HEloRecord>(H2H_SETTLEMENT_KEYS.elo("p1")),
    ).toMatchObject({ games: 3, wins: 2, losses: 1, draws: 0 });
    expect(
      redis.json<H2HEloRecord>(H2H_SETTLEMENT_KEYS.elo("p2")),
    ).toMatchObject({ games: 1, wins: 0, losses: 1, draws: 0 });
    expect(redis.json<string[]>(H2H_SETTLEMENT_KEYS.players)).toEqual([
      "existing",
      "p1",
      "p2",
    ]);
    expect(redis.json<string[]>(H2H_SETTLEMENT_KEYS.completedUsers)).toEqual([
      "p1",
      "p2",
    ]);
    expect(redis.value(H2H_SETTLEMENT_KEYS.gameOverCount)).toBe("1");
    expect(redis.value(H2H_SETTLEMENT_KEYS.dailyCount("2026-01-02"))).toBe("1");

    const receiptKey = H2H_SETTLEMENT_KEYS.receipt(terminal.eventId);
    const settlementCommit = redis.commits.find((writes) =>
      writes.some((write) => write.key === receiptKey),
    );
    expect(new Set(settlementCommit?.map((write) => write.key))).toEqual(
      expect.objectContaining(
        new Set([
          H2H_STORE_KEYS.pendingSettlements,
          receiptKey,
          H2H_SETTLEMENT_KEYS.elo("p1"),
          H2H_SETTLEMENT_KEYS.elo("p2"),
          H2H_SETTLEMENT_KEYS.players,
          H2H_SETTLEMENT_KEYS.completedUsers,
          H2H_SETTLEMENT_KEYS.gameOverCount,
          H2H_SETTLEMENT_KEYS.dailyCount("2026-01-02"),
        ]),
      ),
    );
  });

  it("returns the existing receipt without applying a duplicate result", async () => {
    const redis = new MemoryRedis();
    const terminal = event();
    seedOutbox(redis, [terminal]);
    const service = new H2HSettlementService(redis, {
      now: () => ENDED_AT + 1,
    });
    await service.settle(terminal);
    const firstElo = redis.value(H2H_SETTLEMENT_KEYS.elo("p1"));
    const commitCount = redis.commits.length;

    await expect(service.settle(terminal)).resolves.toMatchObject({
      status: "already_settled",
      receipt: { eventId: terminal.eventId },
    });
    expect(redis.value(H2H_SETTLEMENT_KEYS.elo("p1"))).toBe(firstElo);
    expect(redis.commits).toHaveLength(commitCount);
  });

  it("rejects a receipt whose terminal fingerprint conflicts", async () => {
    const redis = new MemoryRedis();
    const terminal = event();
    const conflicting = event({ playerIds: ["other-1", "other-2"] });
    seedOutbox(redis, [terminal]);
    redis.seed(
      H2H_SETTLEMENT_KEYS.receipt(terminal.eventId),
      JSON.stringify({
        version: 1,
        eventId: terminal.eventId,
        fingerprint: h2hSettlementFingerprint(conflicting),
        settledAt: ENDED_AT,
      }),
    );
    const service = new H2HSettlementService(redis);

    await expect(service.settle(terminal)).rejects.toBeInstanceOf(
      H2HSettlementDataError,
    );
    expect(
      parseH2HSettlementEvents(redis.value(H2H_STORE_KEYS.pendingSettlements)),
    ).toEqual([terminal]);
  });

  it("retries a watched conflict against the newest Elo record", async () => {
    const redis = new MemoryRedis();
    const terminal = event();
    seedOutbox(redis, [terminal]);
    let conflicted = false;
    redis.beforeExec = () => {
      if (conflicted) return;
      conflicted = true;
      redis.externalSet(
        H2H_SETTLEMENT_KEYS.elo("p1"),
        JSON.stringify(elo(1_400, 5, 3, 2, 0)),
      );
    };
    const service = new H2HSettlementService(redis, {
      cas: { maxAttempts: 3 },
    });

    await expect(service.settle(terminal)).resolves.toMatchObject({
      status: "settled",
    });
    expect(
      redis.json<H2HEloRecord>(H2H_SETTLEMENT_KEYS.elo("p1")),
    ).toMatchObject({ games: 6, wins: 4, losses: 2 });
    expect(redis.value(H2H_SETTLEMENT_KEYS.gameOverCount)).toBe("1");
  });

  it("leaves the durable event untouched after exhausted conflicts, then retries", async () => {
    const redis = new MemoryRedis();
    const terminal = event();
    seedOutbox(redis, [terminal]);
    redis.beforeExec = () => {
      const raw = redis.value(H2H_STORE_KEYS.pendingSettlements);
      if (raw !== undefined) {
        redis.externalSet(H2H_STORE_KEYS.pendingSettlements, raw);
      }
    };
    const firstService = new H2HSettlementService(redis, {
      cas: { maxAttempts: 1 },
    });

    await expect(firstService.settle(terminal)).rejects.toBeInstanceOf(
      RedisCasConflictExhaustedError,
    );
    expect(
      parseH2HSettlementEvents(redis.value(H2H_STORE_KEYS.pendingSettlements)),
    ).toEqual([terminal]);
    expect(
      redis.value(H2H_SETTLEMENT_KEYS.receipt(terminal.eventId)),
    ).toBeUndefined();

    redis.beforeExec = undefined;
    const retryService = new H2HSettlementService(redis);
    await expect(retryService.settle(terminal)).resolves.toMatchObject({
      status: "settled",
    });
  });

  it("settles ties and forfeits with their canonical rating outcomes", async () => {
    const redis = new MemoryRedis();
    const tie = tieEvent("tie-game", 8);
    const forfeit = forfeitEvent("forfeit-game", 3, "p3", "p4");
    seedOutbox(redis, [tie, forfeit]);
    const service = new H2HSettlementService(redis);

    await service.settle(tie);
    await service.settle(forfeit);

    expect(redis.json<H2HEloRecord>(H2H_SETTLEMENT_KEYS.elo("p1"))).toEqual(
      elo(1_200, 1, 0, 0, 1),
    );
    expect(redis.json<H2HEloRecord>(H2H_SETTLEMENT_KEYS.elo("p2"))).toEqual(
      elo(1_200, 1, 0, 0, 1),
    );
    expect(redis.json<H2HEloRecord>(H2H_SETTLEMENT_KEYS.elo("p3"))).toEqual(
      elo(1_184, 1, 0, 1, 0),
    );
    expect(redis.json<H2HEloRecord>(H2H_SETTLEMENT_KEYS.elo("p4"))).toEqual(
      elo(1_216, 1, 1, 0, 0),
    );
    expect(redis.value(H2H_SETTLEMENT_KEYS.gameOverCount)).toBe("1");
    expect(redis.value(H2H_SETTLEMENT_KEYS.playerLeftCount)).toBe("1");
    expect(redis.value(H2H_SETTLEMENT_KEYS.dailyCount("2026-01-02"))).toBe("2");
  });

  it("drains a bounded batch and keeps rematch revisions independently idempotent", async () => {
    const redis = new MemoryRedis();
    const firstMatch = forfeitEvent("rematch-game", 1);
    const secondMatch = event({
      gameId: "rematch-game",
      revision: 7,
      eventId: "rematch-game:7",
    });
    const anotherGame = tieEvent("another-game", 4, "p3", "p4");
    seedOutbox(redis, [firstMatch, secondMatch, anotherGame]);
    const service = new H2HSettlementService(redis, {
      defaultDrainLimit: 2,
    });

    await expect(service.drainPending()).resolves.toMatchObject({
      attempted: 2,
      settled: 2,
      remaining: 1,
      failedEventIds: [],
    });
    expect(
      redis.value(H2H_SETTLEMENT_KEYS.receipt("rematch-game:1")),
    ).toBeDefined();
    expect(
      redis.value(H2H_SETTLEMENT_KEYS.receipt("rematch-game:7")),
    ).toBeDefined();
    expect(
      redis.json<H2HEloRecord>(H2H_SETTLEMENT_KEYS.elo("p1")),
    ).toMatchObject({ games: 2, wins: 1, losses: 1 });

    await expect(service.drainPending()).resolves.toMatchObject({
      attempted: 1,
      settled: 1,
      remaining: 0,
    });
    await expect(service.drainPending(101)).rejects.toBeInstanceOf(RangeError);
  });

  it("does not settle a caller-supplied event absent from the durable outbox", async () => {
    const redis = new MemoryRedis();
    const terminal = event();
    const service = new H2HSettlementService(redis);

    await expect(service.settle(terminal)).resolves.toEqual({
      eventId: terminal.eventId,
      status: "not_pending",
      receipt: null,
    });
    expect(redis.value(H2H_SETTLEMENT_KEYS.elo("p1"))).toBeUndefined();
    expect(redis.commits).toHaveLength(0);
  });
});
