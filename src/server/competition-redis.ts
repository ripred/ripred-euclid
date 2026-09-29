import {
  redisWatchedTransaction,
  queueRedisStringWrite,
  type RedisCasClient,
  type RedisCasSnapshot,
  type RedisCasTransaction,
  type RedisCasWrite,
  type RedisTransactionDecision,
} from "./redis-cas";

export interface CompetitionRedisTransaction extends RedisCasTransaction {
  zAdd(
    key: string,
    ...members: { member: string; score: number }[]
  ): Promise<unknown>;
  zRem(key: string, members: string[]): Promise<unknown>;
  expire(key: string, seconds: number): Promise<unknown>;
}

export interface CompetitionRedisClient extends RedisCasClient {
  watch(...keys: string[]): Promise<CompetitionRedisTransaction>;
  zRange(
    key: string,
    start: number,
    stop: number,
  ): Promise<{ member: string; score: number }[]>;
  zRank(key: string, member: string): Promise<number | undefined>;
}

export type CompetitionWrite =
  | RedisCasWrite
  | { action: "z-add"; key: string; member: string; score: number }
  | { action: "z-remove"; key: string; member: string }
  | { action: "expire"; key: string; seconds: number };

export type CompetitionDecision<T> = RedisTransactionDecision<
  T,
  CompetitionWrite
>;

/** Watch sorted sets without issuing GET against them. Decisions rerun on conflicts. */
export async function competitionRedisCas<T>(
  redis: CompetitionRedisClient,
  stringKeys: readonly string[],
  sortedKeys: readonly string[],
  decide: (values: RedisCasSnapshot) => CompetitionDecision<T>,
  maxAttempts = 6,
): Promise<T> {
  const strings = new Set(stringKeys),
    sets = new Set(sortedKeys);
  if (sortedKeys.some((key) => strings.has(key)))
    throw new TypeError(
      "Competition transactions need distinct string and sorted-set keys.",
    );
  return redisWatchedTransaction(
    redis,
    stringKeys,
    sortedKeys,
    decide,
    {
      validateWrites(writes, watchKeys) {
        if (!Array.isArray(writes) || !writes.length)
          throw new TypeError("A commit requires writes.");
        const watched = new Set(watchKeys);
        for (const write of writes) {
          if (!write || !watched.has(write.key))
            throw new TypeError("Cannot write an unwatched key.");
          if (
            (write.action === "set" && !strings.has(write.key)) ||
            ((write.action === "z-add" || write.action === "z-remove") &&
              !sets.has(write.key))
          )
            throw new TypeError(
              "Competition transaction write has the wrong key type.",
            );
          if (
            (write.action === "set" && typeof write.value !== "string") ||
            (write.action === "z-add" &&
              (!Number.isFinite(write.score) ||
                typeof write.member !== "string")) ||
            (write.action === "z-remove" && typeof write.member !== "string") ||
            (write.action === "expire" &&
              (!Number.isSafeInteger(write.seconds) || write.seconds < 1))
          )
            throw new TypeError("Invalid competition transaction value.");
          if (
            !["set", "delete", "z-add", "z-remove", "expire"].includes(
              write.action,
            )
          )
            throw new TypeError("Unknown competition transaction write.");
        }
      },
      queueWrite(tx, write) {
        switch (write.action) {
          case "set":
          case "delete":
            return queueRedisStringWrite(tx, write);
          case "z-add":
            return tx.zAdd(write.key, {
              member: write.member,
              score: write.score,
            });
          case "z-remove":
            return tx.zRem(write.key, [write.member]);
          case "expire":
            return tx.expire(write.key, write.seconds);
        }
      },
    },
    { maxAttempts },
  );
}
