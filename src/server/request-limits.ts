import { Buffer } from "node:buffer";
import {
  redisCas,
  setRedisCasWrite,
  type RedisCasClient,
  type RedisCasSnapshot,
  type RedisCasWrite,
} from "./redis-cas";

export class RequestLimitError extends Error {
  constructor(
    message: string,
    readonly retryAfterMs: number,
  ) {
    super(message);
    this.name = "RequestLimitError";
  }
}

export const SOLO_RECEIPT_LIMITS = {
  retentionMs: 24 * 60 * 60 * 1_000,
  count: 4_096,
  bytes: 32 * 1_024 * 1_024,
} as const;

export const soloReceiptBudgetKey = (userId: string): string =>
  `euclid:solo:v1:receipt-budget:${userId}`;

interface ReceiptBudget {
  resetAt: number;
  count: number;
  bytes: number;
}

/** Call only for a new receipt, inside the transaction watching its user's budget. */
export function writeSoloReceipt(
  snapshot: RedisCasSnapshot,
  writes: Map<string, RedisCasWrite>,
  userId: string,
  receiptKey: string,
  value: string,
  now: number,
): void {
  const key = soloReceiptBudgetKey(userId);
  const raw = snapshot.get(key);
  let budget: ReceiptBudget = {
    resetAt: now + SOLO_RECEIPT_LIMITS.retentionMs,
    count: 0,
    bytes: 0,
  };
  if (raw !== undefined) {
    const stored = JSON.parse(raw) as Partial<ReceiptBudget> | null;
    if (
      !stored ||
      typeof stored.resetAt !== "number" ||
      typeof stored.count !== "number" ||
      typeof stored.bytes !== "number" ||
      !Number.isSafeInteger(stored.resetAt) ||
      !Number.isSafeInteger(stored.count) ||
      !Number.isSafeInteger(stored.bytes) ||
      stored.count < 0 ||
      stored.bytes < 0
    ) {
      throw new Error("Invalid solo receipt budget.");
    }
    if (stored.resetAt > now) {
      budget = {
        resetAt: stored.resetAt,
        count: stored.count,
        bytes: stored.bytes,
      };
    }
  }
  const bytes = Buffer.byteLength(value, "utf8");
  if (
    budget.count >= SOLO_RECEIPT_LIMITS.count ||
    budget.bytes + bytes > SOLO_RECEIPT_LIMITS.bytes
  ) {
    throw new RequestLimitError(
      "Too many new solo requests. Please try again later.",
      budget.resetAt - now,
    );
  }
  // Charge and allocate together: concurrent commands cannot overspend. Replays
  // never reach this helper. Adjacent windows retain at most two budgets of data.
  setRedisCasWrite(
    writes,
    key,
    JSON.stringify({
      resetAt: budget.resetAt,
      count: budget.count + 1,
      bytes: budget.bytes + bytes,
    }),
    new Date(budget.resetAt),
  );
  setRedisCasWrite(
    writes,
    receiptKey,
    value,
    new Date(now + SOLO_RECEIPT_LIMITS.retentionMs),
  );
}

/** Reserve before posting, using the existing timestamp format and key. */
export async function reserveShareCooldown(
  redis: RedisCasClient,
  key: string,
  cooldownMs: number,
  now = Date.now(),
): Promise<void> {
  await redisCas(redis, key, (raw) => {
    const last = raw === undefined ? undefined : Number(raw);
    if (last !== undefined && !Number.isSafeInteger(last)) {
      throw new Error("Invalid share cooldown.");
    }
    if (last !== undefined && now - last < cooldownMs) {
      throw new RequestLimitError(
        "Please wait a few seconds before sharing again.",
        cooldownMs - (now - last),
      );
    }
    return {
      action: "set",
      value: String(now),
      expiration: new Date(now + Math.max(60_000, cooldownMs)),
      result: undefined,
    };
  });
}
