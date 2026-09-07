export interface RedisCasTransaction {
  multi(): Promise<void>;
  set(
    key: string,
    value: string,
    options?: { expiration: Date },
  ): Promise<unknown>;
  del(...keys: string[]): Promise<unknown>;
  exec(): Promise<readonly unknown[] | null | undefined>;
  discard(): Promise<void>;
  unwatch(): Promise<unknown>;
}

/** The narrow part of Devvit Redis used by this helper. */
export interface RedisCasClient {
  watch(...keys: string[]): Promise<RedisCasTransaction>;
  get(key: string): Promise<string | null | undefined>;
}

export interface RedisCasOptions {
  /** Total attempts, including the initial attempt. Defaults to 4. */
  maxAttempts?: number;
}

export type RedisCasDecision<TResult> =
  | { action: "set"; value: string; expiration?: Date; result: TResult }
  | { action: "delete"; result: TResult }
  | { action: "no-change"; result: TResult };

export type RedisCasWrite =
  | { action: "set"; key: string; value: string; expiration?: Date }
  | { action: "delete"; key: string };

export type RedisMultiCasDecision<TResult> =
  | {
      action: "commit";
      writes: readonly RedisCasWrite[];
      result: TResult;
    }
  | { action: "no-change"; result: TResult };

/** Adds or replaces a string write in a Redis multi-key CAS write map. */
export function setRedisCasWrite(
  writes: Map<string, RedisCasWrite>,
  key: string,
  value: string,
  expiration?: Date,
): void {
  writes.set(key, {
    action: "set",
    key,
    value,
    ...(expiration ? { expiration } : {}),
  });
}

/** Adds or replaces a deletion in a Redis multi-key CAS write map. */
export function deleteRedisCasWrite(
  writes: Map<string, RedisCasWrite>,
  key: string,
): void {
  writes.set(key, { action: "delete", key });
}

/** Commits a populated write map, or avoids an empty Redis transaction. */
export function commitRedisCasWrites<TResult>(
  writes: ReadonlyMap<string, RedisCasWrite>,
  result: TResult,
): RedisMultiCasDecision<TResult> {
  return writes.size === 0
    ? { action: "no-change", result }
    : { action: "commit", writes: [...writes.values()], result };
}

export type RedisCasSnapshot = ReadonlyMap<string, string | undefined>;

export class RedisCasConflictExhaustedError extends Error {
  override readonly name = "RedisCasConflictExhaustedError";
  readonly watchKeys: readonly string[];
  readonly attempts: number;

  constructor(watchKeys: readonly string[], attempts: number) {
    const keyList = watchKeys.map((key) => JSON.stringify(key)).join(", ");
    super(
      `Redis transaction conflict for ${keyList} persisted after ${attempts} attempts.`,
    );
    this.watchKeys = [...watchKeys];
    this.attempts = attempts;
  }
}

const DEFAULT_MAX_ATTEMPTS = 4;

/**
 * Atomically sets, deletes, or leaves one Redis string unchanged after reading
 * its watched value. The decision is rerun only after an EXEC watch conflict.
 */
export async function redisCas<TResult>(
  redis: RedisCasClient,
  key: string,
  decide: (current: string | undefined) => RedisCasDecision<TResult>,
  options: RedisCasOptions = {},
): Promise<TResult> {
  return redisMultiCas(
    redis,
    [key],
    (snapshot): RedisMultiCasDecision<TResult> => {
      const decision = decide(snapshot.get(key));
      if (isPromiseLike(decision)) {
        throw new TypeError(
          "Redis CAS decisions must be synchronous and pure.",
        );
      }
      switch (decision.action) {
        case "set":
          return {
            action: "commit",
            writes: [
              {
                action: "set",
                key,
                value: decision.value,
                ...(decision.expiration
                  ? { expiration: decision.expiration }
                  : {}),
              },
            ],
            result: decision.result,
          };
        case "delete":
          return {
            action: "commit",
            writes: [{ action: "delete", key }],
            result: decision.result,
          };
        case "no-change":
          return decision;
      }
    },
    options,
  );
}

/**
 * Atomically commits writes derived from a snapshot of multiple watched Redis
 * strings. Every written key must be present in `watchKeys`.
 */
export async function redisMultiCas<TResult>(
  redis: RedisCasClient,
  watchKeys: readonly string[],
  decide: (snapshot: RedisCasSnapshot) => RedisMultiCasDecision<TResult>,
  options: RedisCasOptions = {},
): Promise<TResult> {
  const keys = normalizeWatchKeys(watchKeys);
  const maxAttempts = normalizeMaxAttempts(options.maxAttempts);

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const result = await runAttempt(redis, keys, decide);
    if (result.status === "committed") return result.result;
  }

  throw new RedisCasConflictExhaustedError(keys, maxAttempts);
}

type AttemptResult<TResult> =
  | { status: "committed"; result: TResult }
  | { status: "conflict" };

type TransactionPhase = "watched" | "multi" | "closed";

async function runAttempt<TResult>(
  redis: RedisCasClient,
  watchKeys: readonly string[],
  decide: (snapshot: RedisCasSnapshot) => RedisMultiCasDecision<TResult>,
): Promise<AttemptResult<TResult>> {
  const transaction = await redis.watch(...watchKeys);
  let phase: TransactionPhase = "watched";

  try {
    const values = await Promise.all(
      watchKeys.map(
        async (key) => [key, (await redis.get(key)) ?? undefined] as const,
      ),
    );
    const snapshot: RedisCasSnapshot = new Map(values);
    const decision = decide(snapshot);
    assertSynchronousDecision(decision);

    if (decision.action === "no-change") {
      await transaction.unwatch();
      phase = "closed";
      return { status: "committed", result: decision.result };
    }

    assertValidWrites(decision.writes, watchKeys);
    await transaction.multi();
    phase = "multi";
    for (const write of decision.writes) {
      if (write.action === "set") {
        // Expiration belongs to SET itself, so a committed value cannot lose its TTL.
        if (write.expiration) {
          await transaction.set(write.key, write.value, {
            expiration: write.expiration,
          });
        } else {
          await transaction.set(write.key, write.value);
        }
      } else {
        await transaction.del(write.key);
      }
    }

    const responses = await transaction.exec();
    phase = "closed";
    if (responses == null || responses.length === 0) {
      return { status: "conflict" };
    }
    if (responses.length !== decision.writes.length) {
      throw new Error(
        `Redis EXEC returned ${responses.length} replies for ${decision.writes.length} queued CAS writes; commit status is indeterminate.`,
      );
    }
    return { status: "committed", result: decision.result };
  } catch (error) {
    const conflict = phase === "multi" && isRedisWatchConflict(error);
    await releaseAfterError(transaction, phase);
    if (conflict) return { status: "conflict" };
    throw error;
  }
}

function normalizeWatchKeys(watchKeys: readonly string[]): string[] {
  const keys = [...new Set(watchKeys)];
  if (keys.length === 0) {
    throw new TypeError("Redis CAS requires at least one watched key.");
  }
  if (keys.some((key) => typeof key !== "string" || key.length === 0)) {
    throw new TypeError("Redis CAS watch keys must be non-empty strings.");
  }
  return keys;
}

function normalizeMaxAttempts(value: number | undefined): number {
  const attempts = value ?? DEFAULT_MAX_ATTEMPTS;
  if (!Number.isSafeInteger(attempts) || attempts < 1) {
    throw new RangeError("maxAttempts must be a positive safe integer.");
  }
  return attempts;
}

function assertSynchronousDecision<TResult>(
  decision: RedisMultiCasDecision<TResult>,
): asserts decision is RedisMultiCasDecision<TResult> {
  if (isPromiseLike(decision)) {
    throw new TypeError("Redis CAS decisions must be synchronous and pure.");
  }
  if (
    !decision ||
    typeof decision !== "object" ||
    (decision.action !== "commit" && decision.action !== "no-change")
  ) {
    throw new TypeError("Redis CAS decision has an unsupported action.");
  }
}

function assertValidWrites(
  writes: readonly RedisCasWrite[],
  watchKeys: readonly string[],
): void {
  if (!Array.isArray(writes) || writes.length === 0) {
    throw new TypeError(
      "A Redis CAS commit must contain at least one set or delete.",
    );
  }

  const watched = new Set(watchKeys);
  const written = new Set<string>();
  for (const write of writes) {
    if (!write || typeof write !== "object") {
      throw new TypeError("Redis CAS writes must be objects.");
    }
    if (!watched.has(write.key)) {
      throw new Error(
        `Redis CAS cannot write unwatched key ${JSON.stringify(write.key)}.`,
      );
    }
    if (written.has(write.key)) {
      throw new Error(
        `Redis CAS contains duplicate write for ${JSON.stringify(write.key)}.`,
      );
    }
    written.add(write.key);

    if (write.action === "set") {
      if (typeof write.value !== "string") {
        throw new TypeError("Redis CAS set values must be strings.");
      }
    } else if (write.action !== "delete") {
      throw new TypeError("Redis CAS write has an unsupported action.");
    }
  }
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return (
    !!value &&
    (typeof value === "object" || typeof value === "function") &&
    "then" in value &&
    typeof value.then === "function"
  );
}

async function releaseAfterError(
  transaction: RedisCasTransaction,
  phase: TransactionPhase,
): Promise<void> {
  if (phase === "closed") return;
  try {
    if (phase === "multi") {
      await transaction.discard();
    } else {
      await transaction.unwatch();
    }
  } catch {
    // Preserve the decision, Redis, or conflict error that required cleanup.
  }
}

function isRedisWatchConflict(error: unknown): boolean {
  let candidate: unknown = error;
  for (let depth = 0; depth < 4 && candidate; depth++) {
    if (typeof candidate !== "object" && typeof candidate !== "function") {
      return false;
    }
    const record = candidate as Record<string, unknown>;
    const name = stringField(record.name).toLowerCase();
    const code = record.code;
    const codeText = stringField(code).toLowerCase();
    const message = [record.message, record.details, record.status]
      .map(stringField)
      .join(" ")
      .toLowerCase();

    if (
      name === "watcherror" ||
      name === "transactionconflicterror" ||
      code === 10 ||
      codeText === "aborted" ||
      codeText === "watch_conflict" ||
      codeText === "transaction_conflict" ||
      /watch(?:ed)? keys?.*(?:changed|modified)/i.test(message) ||
      /(?:changed|modified).*(?:watch(?:ed)? keys?)/i.test(message) ||
      /transaction.*(?:watch|concurrent|conflict).*(?:abort|discard)/i.test(
        message,
      )
    ) {
      return true;
    }
    candidate = record.cause;
  }
  return false;
}

function stringField(value: unknown): string {
  return typeof value === "string" ? value : "";
}
