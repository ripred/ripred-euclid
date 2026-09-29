import { describe, expect, it } from "vitest";
import {
  competitionRedisCas,
  type CompetitionRedisClient,
} from "./competition-redis";
import { RedisCasConflictExhaustedError } from "./redis-cas";
import { CompetitionMemoryRedis } from "./testing/competition-memory-redis";

describe("competition Redis transactions", () => {
  it("watches sorted sets without treating them as strings and commits mixed writes", async () => {
    const redis = new CompetitionMemoryRedis();
    redis.seed("best", "old");
    await competitionRedisCas(redis, ["best"], ["scores"], (values) => ({
      action: "commit",
      result: values.get("best"),
      writes: [
        { action: "set", key: "best", value: "new" },
        { action: "z-add", key: "scores", member: "new", score: 0 },
        { action: "expire", key: "scores", seconds: 600 },
      ],
    }));
    await competitionRedisCas(redis, ["best"], ["scores"], () => ({
      action: "commit",
      result: true,
      writes: [
        { action: "z-remove", key: "scores", member: "new" },
        { action: "z-add", key: "scores", member: "better", score: 0 },
      ],
    }));
    expect(redis.reads).toEqual(["best", "best"]);
    expect(redis.watches).toEqual([
      ["best", "scores"],
      ["best", "scores"],
    ]);
    expect(await redis.zRange("scores", 0, -1)).toEqual([
      { member: "better", score: 0 },
    ]);
  });

  it("recomputes string decisions after an intervening sorted-set conflict", async () => {
    const redis = new CompetitionMemoryRedis();
    redis.seed("counter", "0");
    redis.beforeExec = () => {
      redis.beforeExec = undefined;
      redis.externalSet("counter", "10");
    };
    await competitionRedisCas(redis, ["counter"], ["scores"], (values) => ({
      action: "commit",
      result: null,
      writes: [
        {
          action: "set",
          key: "counter",
          value: String(Number(values.get("counter")) + 1),
        },
        { action: "z-add", key: "scores", member: "entry", score: 0 },
      ],
    }));
    expect(redis.value("counter")).toBe("11");
    expect(redis.commits).toHaveLength(1);
  });

  it("rejects writes to an unwatched key and wrong Redis types", async () => {
    const redis = new CompetitionMemoryRedis();
    await expect(
      competitionRedisCas(redis, ["counter"], ["scores"], () => ({
        action: "commit",
        result: null,
        writes: [{ action: "set", key: "unwatched", value: "no" }],
      })),
    ).rejects.toThrow("unwatched");
    await expect(
      competitionRedisCas(redis, ["counter"], ["scores"], () => ({
        action: "commit",
        result: null,
        writes: [{ action: "set", key: "scores", value: "no" }],
      })),
    ).rejects.toThrow("wrong key type");
    expect(redis.commits).toHaveLength(0);
  });

  it("bounds retries for repeated conflicts", async () => {
    const redis = new CompetitionMemoryRedis();
    redis.beforeExec = () => redis.externalSet("counter", "changed");
    await expect(
      competitionRedisCas(
        redis,
        ["counter"],
        [],
        () => ({
          action: "commit",
          result: null,
          writes: [{ action: "set", key: "counter", value: "new" }],
        }),
        2,
      ),
    ).rejects.toBeInstanceOf(RedisCasConflictExhaustedError);
    expect(redis.watches).toHaveLength(2);
  });

  it("recognizes Devvit's thrown watch conflicts using the shared helper", async () => {
    const redis = new CompetitionMemoryRedis();
    redis.beforeExec = () => {
      redis.beforeExec = undefined;
      throw { code: 10, message: "Transaction aborted" };
    };
    await competitionRedisCas(redis, ["counter"], [], () => ({
      action: "commit",
      result: true,
      writes: [{ action: "set", key: "counter", value: "new" }],
    }));
    expect(redis.watches).toHaveLength(2);
    expect(redis.value("counter")).toBe("new");
  });

  it("does not replay an indeterminate transaction response", async () => {
    const backing = new CompetitionMemoryRedis();
    const redis: CompetitionRedisClient = {
      get: backing.get.bind(backing),
      zRank: backing.zRank.bind(backing),
      zRange: backing.zRange.bind(backing),
      watch: async (...keys) => {
        const tx = await backing.watch(...keys);
        return {
          ...tx,
          exec: async () => {
            await tx.exec();
            return ["OK", "extra"];
          },
        };
      },
    };
    await expect(
      competitionRedisCas(redis, ["counter"], [], () => ({
        action: "commit",
        result: true,
        writes: [{ action: "set", key: "counter", value: "new" }],
      })),
    ).rejects.toThrow("indeterminate");
    expect(backing.watches).toHaveLength(1);
  });
});
