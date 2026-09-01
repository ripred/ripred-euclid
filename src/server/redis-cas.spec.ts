import type { RedisClient as DevvitRedisClient } from "@devvit/redis";
import { describe, expect, expectTypeOf, it } from "vitest";

import {
  redisCas,
  RedisCasConflictExhaustedError,
  redisMultiCas,
  type RedisCasClient,
  type RedisCasTransaction,
  type RedisCasWrite,
} from "./redis-cas";

type ConflictForm = "null" | "empty" | "watch-error" | "aborted-code";

type CallCounts = {
  watch: number;
  get: number;
  multi: number;
  set: number;
  delete: number;
  exec: number;
  discard: number;
  unwatch: number;
};

class ConflictAwareRedis implements RedisCasClient {
  readonly calls: CallCounts = {
    watch: 0,
    get: 0,
    multi: 0,
    set: 0,
    delete: 0,
    exec: 0,
    discard: 0,
    unwatch: 0,
  };

  conflictForm: ConflictForm = "null";
  alwaysConflict = false;
  beforeExec: (() => void | Promise<void>) | undefined;
  nextExecError: unknown;
  replyLimit: number | undefined;

  private readonly values = new Map<string, string>();
  private readonly versions = new Map<string, number>();

  seed(key: string, value: string): void {
    this.values.set(key, value);
    this.bumpVersion(key);
  }

  externalSet(key: string, value: string): void {
    this.values.set(key, value);
    this.bumpVersion(key);
  }

  value(key: string): string | undefined {
    return this.values.get(key);
  }

  version(key: string): number {
    return this.versions.get(key) ?? 0;
  }

  async watch(...keys: string[]): Promise<RedisCasTransaction> {
    this.calls.watch++;
    return new ConflictAwareTransaction(this, keys);
  }

  async get(key: string): Promise<string | undefined> {
    this.calls.get++;
    return this.values.get(key);
  }

  hasConflict(watchedVersions: ReadonlyMap<string, number>): boolean {
    return (
      this.alwaysConflict ||
      [...watchedVersions].some(
        ([key, version]) => this.version(key) !== version,
      )
    );
  }

  commit(writes: readonly RedisCasWrite[]): void {
    for (const write of writes) {
      if (write.action === "set") {
        this.values.set(write.key, write.value);
      } else {
        this.values.delete(write.key);
      }
    }
    for (const write of writes) this.bumpVersion(write.key);
  }

  conflictResult(): readonly unknown[] | null {
    switch (this.conflictForm) {
      case "null":
        return null;
      case "empty":
        return [];
      case "watch-error": {
        const error = new Error(
          "One (or more) of the watched keys has been changed",
        );
        error.name = "WatchError";
        throw error;
      }
      case "aborted-code": {
        const error = new Error("Redis transaction aborted");
        Object.assign(error, { code: "ABORTED" });
        throw error;
      }
    }
  }

  private bumpVersion(key: string): void {
    this.versions.set(key, this.version(key) + 1);
  }
}

class ConflictAwareTransaction implements RedisCasTransaction {
  private readonly watchedVersions: ReadonlyMap<string, number>;
  private readonly writes: RedisCasWrite[] = [];
  private multiStarted = false;
  private closed = false;

  constructor(
    private readonly redis: ConflictAwareRedis,
    watchKeys: readonly string[],
  ) {
    this.watchedVersions = new Map(
      watchKeys.map((key) => [key, redis.version(key)]),
    );
  }

  async multi(): Promise<void> {
    this.assertOpen();
    this.redis.calls.multi++;
    this.multiStarted = true;
  }

  async set(key: string, value: string): Promise<unknown> {
    this.assertQueueing();
    this.redis.calls.set++;
    this.writes.push({ action: "set", key, value });
    return this;
  }

  async del(...keys: string[]): Promise<unknown> {
    this.assertQueueing();
    this.redis.calls.delete++;
    this.writes.push(
      ...keys.map((key) => ({ action: "delete" as const, key })),
    );
    return this;
  }

  async exec(): Promise<readonly unknown[] | null> {
    this.assertQueueing();
    this.redis.calls.exec++;
    await this.redis.beforeExec?.();

    if (this.redis.nextExecError) {
      const error = this.redis.nextExecError;
      this.redis.nextExecError = undefined;
      throw error;
    }
    if (this.redis.hasConflict(this.watchedVersions)) {
      this.closed = true;
      return this.redis.conflictResult();
    }

    this.redis.commit(this.writes);
    this.closed = true;
    return this.writes
      .map(() => "OK")
      .slice(0, this.redis.replyLimit ?? this.writes.length);
  }

  async discard(): Promise<void> {
    this.redis.calls.discard++;
    this.closed = true;
  }

  async unwatch(): Promise<unknown> {
    this.redis.calls.unwatch++;
    this.closed = true;
    return this;
  }

  private assertOpen(): void {
    if (this.closed) throw new Error("Transaction is closed.");
  }

  private assertQueueing(): void {
    this.assertOpen();
    if (!this.multiStarted) throw new Error("MULTI has not started.");
  }
}

describe("redisCas", () => {
  it("is structurally compatible with the pinned Devvit Redis client", () => {
    expectTypeOf<DevvitRedisClient>().toMatchTypeOf<RedisCasClient>();
  });

  it("retries a simultaneous stale read and preserves both updates", async () => {
    const redis = new ConflictAwareRedis();
    redis.seed("counter", "0");

    const increment = () =>
      redisCas(redis, "counter", (current) => {
        const next = Number(current ?? "0") + 1;
        return { action: "set", value: String(next), result: next };
      });

    await expect(Promise.all([increment(), increment()])).resolves.toEqual([
      1, 2,
    ]);
    expect(redis.value("counter")).toBe("2");
    expect(redis.calls.exec).toBe(3);
    expect(redis.calls.watch).toBe(3);
  });

  it("cannot conditionally delete a mapping that changed after the read", async () => {
    const redis = new ConflictAwareRedis();
    redis.seed("user:game", "game-a");
    redis.conflictForm = "empty";
    let injectedConflict = false;
    redis.beforeExec = () => {
      if (injectedConflict) return;
      injectedConflict = true;
      redis.externalSet("user:game", "game-b");
    };
    const observed: Array<string | undefined> = [];

    const deleted = await redisCas(redis, "user:game", (current) => {
      observed.push(current);
      return current === "game-a"
        ? { action: "delete", result: true }
        : { action: "no-change", result: false };
    });

    expect(deleted).toBe(false);
    expect(observed).toEqual(["game-a", "game-b"]);
    expect(redis.value("user:game")).toBe("game-b");
    expect(redis.calls.exec).toBe(1);
    expect(redis.calls.unwatch).toBe(1);
  });

  it("returns a no-change result without starting MULTI", async () => {
    const redis = new ConflictAwareRedis();
    redis.seed("mapping", "game-a");

    const result = await redisCas(redis, "mapping", () => ({
      action: "no-change",
      result: { preserved: true },
    }));

    expect(result).toEqual({ preserved: true });
    expect(redis.value("mapping")).toBe("game-a");
    expect(redis.calls.unwatch).toBe(1);
    expect(redis.calls.multi).toBe(0);
    expect(redis.calls.exec).toBe(0);
  });

  it("deletes a watched value", async () => {
    const redis = new ConflictAwareRedis();
    redis.seed("temporary", "value");

    await expect(
      redisCas(redis, "temporary", () => ({
        action: "delete",
        result: "deleted" as const,
      })),
    ).resolves.toBe("deleted");
    expect(redis.value("temporary")).toBeUndefined();
    expect(redis.calls.delete).toBe(1);
    expect(redis.calls.exec).toBe(1);
  });

  it("commits a decision across multiple watched keys", async () => {
    const redis = new ConflictAwareRedis();
    redis.seed("queue", "waiting");
    redis.seed("active", "old-game");

    const result = await redisMultiCas(
      redis,
      ["queue", "user:one", "active"],
      (snapshot) => {
        expect(snapshot.get("queue")).toBe("waiting");
        expect(snapshot.get("user:one")).toBeUndefined();
        return {
          action: "commit",
          writes: [
            { action: "set", key: "queue", value: "paired" },
            { action: "set", key: "user:one", value: "game-1" },
            { action: "delete", key: "active" },
          ],
          result: "paired" as const,
        };
      },
    );

    expect(result).toBe("paired");
    expect(redis.value("queue")).toBe("paired");
    expect(redis.value("user:one")).toBe("game-1");
    expect(redis.value("active")).toBeUndefined();
    expect(redis.calls.watch).toBe(1);
    expect(redis.calls.exec).toBe(1);
  });

  it("does not report success for a partial EXEC response", async () => {
    const redis = new ConflictAwareRedis();
    redis.seed("one", "old");
    redis.seed("two", "old");
    redis.replyLimit = 1;

    const pending = redisMultiCas(redis, ["one", "two"], () => ({
      action: "commit",
      writes: [
        { action: "set", key: "one", value: "new" },
        { action: "set", key: "two", value: "new" },
      ],
      result: true,
    }));

    await expect(pending).rejects.toThrow(
      "Redis EXEC returned 1 replies for 2 queued CAS writes",
    );
    expect(redis.calls.watch).toBe(1);
    expect(redis.calls.exec).toBe(1);
  });

  it("unwatches and never retries a decision error", async () => {
    const redis = new ConflictAwareRedis();
    redis.seed("game", "current");
    const domainError = new Error("game is already complete");
    let caught: unknown;

    try {
      await redisCas(redis, "game", () => {
        throw domainError;
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBe(domainError);
    expect(redis.calls.watch).toBe(1);
    expect(redis.calls.unwatch).toBe(1);
    expect(redis.calls.multi).toBe(0);
    expect(redis.calls.exec).toBe(0);
  });

  it("discards and never retries a non-conflict EXEC error", async () => {
    const redis = new ConflictAwareRedis();
    redis.seed("game", "current");
    const storageError = new Error("storage limit exceeded");
    redis.nextExecError = storageError;
    let caught: unknown;

    try {
      await redisCas(redis, "game", () => ({
        action: "set",
        value: "next",
        result: true,
      }));
    } catch (error) {
      caught = error;
    }

    expect(caught).toBe(storageError);
    expect(redis.calls.watch).toBe(1);
    expect(redis.calls.exec).toBe(1);
    expect(redis.calls.discard).toBe(1);
    expect(redis.value("game")).toBe("current");
  });

  it.each(["watch-error", "aborted-code"] as const)(
    "throws a clear error after %s conflicts exhaust retries",
    async (conflictForm) => {
      const redis = new ConflictAwareRedis();
      redis.seed("contended", "old");
      redis.alwaysConflict = true;
      redis.conflictForm = conflictForm;

      const pending = redisCas(
        redis,
        "contended",
        () => ({ action: "set", value: "new", result: true }),
        { maxAttempts: 2 },
      );

      await expect(pending).rejects.toMatchObject({
        name: "RedisCasConflictExhaustedError",
        watchKeys: ["contended"],
        attempts: 2,
      });
      await expect(pending).rejects.toBeInstanceOf(
        RedisCasConflictExhaustedError,
      );
      expect(redis.calls.exec).toBe(2);
      expect(redis.calls.discard).toBe(2);
      expect(redis.value("contended")).toBe("old");
    },
  );
});
