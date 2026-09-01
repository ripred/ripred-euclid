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
  commitRedisCasWrites as commitOrNoChange,
  deleteRedisCasWrite as deleteWrite,
  redisMultiCas,
  setRedisCasWrite as setWrite,
  type RedisCasClient,
  type RedisCasOptions,
  type RedisCasWrite,
} from "./redis-cas";

const ELO_START = 1_200;
const ELO_K = 32;
const RECEIPT_VERSION = 1;
const DEFAULT_DRAIN_LIMIT = 8;
const DEFAULT_MAX_DRAIN_LIMIT = 100;

export const H2H_SETTLEMENT_KEYS = Object.freeze({
  receipt: (eventId: string) => `euclid:h2h:settlement:done:${eventId}`,
  elo: (userId: string) => `euclid:elo:hvh:${userId}`,
  legacyElo: (userId: string) => `euclid:elo:${userId}`,
  players: "euclid:players:hvh",
  completedUsers: "euclid:metric:set:h2h_completed_users",
  gameOverCount: "euclid:metric:count:h2h_game_over_count",
  playerLeftCount: "euclid:metric:count:h2h_player_left_count",
  dailyCount: (date: string) => `euclid:metric:count:euclid:daily:hvh:${date}`,
});

export type H2HEloRecord = {
  rating: number;
  games: number;
  wins: number;
  losses: number;
  draws: number;
};

export type H2HSettlementReceipt = {
  version: typeof RECEIPT_VERSION;
  eventId: string;
  fingerprint: string;
  settledAt: number;
};

export type H2HSettlementResult = {
  eventId: string;
  status: "settled" | "already_settled" | "not_pending";
  receipt: H2HSettlementReceipt | null;
};

export type H2HSettlementDrainResult = {
  attempted: number;
  settled: number;
  alreadySettled: number;
  noLongerPending: number;
  failedEventIds: string[];
  remaining: number;
};

export type H2HSettlementServiceOptions = {
  now?: () => number;
  cas?: RedisCasOptions;
  defaultDrainLimit?: number;
  maxDrainLimit?: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function safeInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : null;
}

function parseStringSet(raw: string | undefined, field: string): string[] {
  if (raw === undefined) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    throw new H2HSettlementDataError(`${field} is not valid JSON.`);
  }
  if (
    !Array.isArray(parsed) ||
    parsed.some((value) => typeof value !== "string" || !value)
  ) {
    throw new H2HSettlementDataError(`${field} must be a string array.`);
  }
  return [...new Set(parsed)];
}

function parseCounter(raw: string | undefined, field: string): number {
  if (raw === undefined) return 0;
  if (!/^\d+$/.test(raw)) {
    throw new H2HSettlementDataError(
      `${field} must be a non-negative integer.`,
    );
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value)) {
    throw new H2HSettlementDataError(
      `${field} exceeds the safe integer range.`,
    );
  }
  return value;
}

function incrementCounter(value: number, field: string): number {
  if (value >= Number.MAX_SAFE_INTEGER) {
    throw new H2HSettlementDataError(`${field} cannot be incremented safely.`);
  }
  return value + 1;
}

function parseElo(raw: string | undefined, field: string): H2HEloRecord | null {
  if (raw === undefined) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    throw new H2HSettlementDataError(`${field} is not valid JSON.`);
  }
  if (!isRecord(parsed)) {
    throw new H2HSettlementDataError(`${field} must be an object.`);
  }
  const rating = parsed.rating;
  const games = safeInteger(parsed.games);
  const wins = safeInteger(parsed.wins);
  const losses = safeInteger(parsed.losses);
  const draws = safeInteger(parsed.draws);
  if (
    typeof rating !== "number" ||
    !Number.isFinite(rating) ||
    games === null ||
    wins === null ||
    losses === null ||
    draws === null ||
    wins + losses + draws !== games
  ) {
    throw new H2HSettlementDataError(`${field} is not a valid Elo record.`);
  }
  return { rating, games, wins, losses, draws };
}

function effectiveElo(
  currentRaw: string | undefined,
  legacyRaw: string | undefined,
  field: string,
): H2HEloRecord {
  const current = parseElo(currentRaw, field);
  if (current) return current;
  const legacy = parseElo(legacyRaw, `${field} legacy record`);
  return (
    legacy ?? {
      rating: ELO_START,
      games: 0,
      wins: 0,
      losses: 0,
      draws: 0,
    }
  );
}

function updateEloPair(
  first: H2HEloRecord,
  second: H2HEloRecord,
  resultForFirst: 0 | 0.5 | 1,
): [H2HEloRecord, H2HEloRecord] {
  const expectedFirst =
    1 / (1 + Math.pow(10, (second.rating - first.rating) / 400));
  const expectedSecond = 1 - expectedFirst;
  const resultForSecond = 1 - resultForFirst;
  return [
    {
      rating: Math.round(
        first.rating + ELO_K * (resultForFirst - expectedFirst),
      ),
      games: incrementCounter(first.games, "first player games"),
      wins: first.wins + (resultForFirst === 1 ? 1 : 0),
      losses: first.losses + (resultForFirst === 0 ? 1 : 0),
      draws: first.draws + (resultForFirst === 0.5 ? 1 : 0),
    },
    {
      rating: Math.round(
        second.rating + ELO_K * (resultForSecond - expectedSecond),
      ),
      games: incrementCounter(second.games, "second player games"),
      wins: second.wins + (resultForSecond === 1 ? 1 : 0),
      losses: second.losses + (resultForSecond === 0 ? 1 : 0),
      draws: second.draws + (resultForSecond === 0.5 ? 1 : 0),
    },
  ];
}

function settlementDate(endedAt: number): string {
  const date = new Date(endedAt);
  if (!Number.isFinite(date.getTime())) {
    throw new H2HSettlementDataError(
      "The settlement timestamp cannot be represented as a date.",
    );
  }
  return date.toISOString().slice(0, 10);
}

function parseReceipt(raw: string, eventId: string): H2HSettlementReceipt {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    throw new H2HSettlementDataError(
      `Settlement receipt ${JSON.stringify(eventId)} is not valid JSON.`,
    );
  }
  if (!isRecord(parsed)) {
    throw new H2HSettlementDataError(
      `Settlement receipt ${JSON.stringify(eventId)} is invalid.`,
    );
  }
  const settledAt = safeInteger(parsed.settledAt);
  if (
    parsed.version !== RECEIPT_VERSION ||
    parsed.eventId !== eventId ||
    typeof parsed.fingerprint !== "string" ||
    settledAt === null
  ) {
    throw new H2HSettlementDataError(
      `Settlement receipt ${JSON.stringify(eventId)} is invalid.`,
    );
  }
  return {
    version: RECEIPT_VERSION,
    eventId,
    fingerprint: parsed.fingerprint,
    settledAt,
  };
}

function normalizeLimit(
  value: number | undefined,
  fallback: number,
  maximum: number,
): number {
  const limit = value ?? fallback;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > maximum) {
    throw new RangeError(
      `Settlement drain limit must be between 1 and ${maximum}.`,
    );
  }
  return limit;
}

/** Atomically applies durable H2H terminal events to rating and metrics. */
export class H2HSettlementService {
  private readonly now: () => number;
  private readonly casOptions: RedisCasOptions;
  private readonly defaultDrainLimit: number;
  private readonly maxDrainLimit: number;

  constructor(
    private readonly redis: RedisCasClient,
    options: H2HSettlementServiceOptions = {},
  ) {
    this.now = options.now ?? Date.now;
    this.casOptions = options.cas ?? {};
    this.maxDrainLimit = options.maxDrainLimit ?? DEFAULT_MAX_DRAIN_LIMIT;
    this.defaultDrainLimit = options.defaultDrainLimit ?? DEFAULT_DRAIN_LIMIT;
    normalizeLimit(
      this.defaultDrainLimit,
      DEFAULT_DRAIN_LIMIT,
      this.maxDrainLimit,
    );
  }

  async settle(eventInput: H2HSettlementEvent): Promise<H2HSettlementResult> {
    const event = normalizeH2HSettlementEvent(eventInput);
    const fingerprint = h2hSettlementFingerprint(event);
    const [firstId, secondId] = event.playerIds;
    const receiptKey = H2H_SETTLEMENT_KEYS.receipt(event.eventId);
    const firstEloKey = H2H_SETTLEMENT_KEYS.elo(firstId);
    const secondEloKey = H2H_SETTLEMENT_KEYS.elo(secondId);
    const firstLegacyKey = H2H_SETTLEMENT_KEYS.legacyElo(firstId);
    const secondLegacyKey = H2H_SETTLEMENT_KEYS.legacyElo(secondId);
    const terminalCountKey =
      event.endedReason === "player_left"
        ? H2H_SETTLEMENT_KEYS.playerLeftCount
        : H2H_SETTLEMENT_KEYS.gameOverCount;
    const dailyKey = H2H_SETTLEMENT_KEYS.dailyCount(
      settlementDate(event.endedAt),
    );
    const settledAt = this.now();
    if (safeInteger(settledAt) === null) {
      throw new RangeError(
        "Settlement time must be a non-negative safe integer timestamp.",
      );
    }

    return redisMultiCas<H2HSettlementResult>(
      this.redis,
      [
        H2H_STORE_KEYS.pendingSettlements,
        receiptKey,
        firstEloKey,
        secondEloKey,
        firstLegacyKey,
        secondLegacyKey,
        H2H_SETTLEMENT_KEYS.players,
        H2H_SETTLEMENT_KEYS.completedUsers,
        terminalCountKey,
        dailyKey,
      ],
      (snapshot) => {
        const pending = parseH2HSettlementEvents(
          snapshot.get(H2H_STORE_KEYS.pendingSettlements),
        );
        const pendingIndex = pending.findIndex(
          (candidate) => candidate.eventId === event.eventId,
        );
        const pendingEvent =
          pendingIndex < 0 ? undefined : pending[pendingIndex];
        if (
          pendingEvent &&
          h2hSettlementFingerprint(pendingEvent) !== fingerprint
        ) {
          throw new H2HSettlementDataError(
            `Pending settlement ${JSON.stringify(event.eventId)} has a conflicting fingerprint.`,
          );
        }

        const receiptRaw = snapshot.get(receiptKey);
        if (receiptRaw !== undefined) {
          const receipt = parseReceipt(receiptRaw, event.eventId);
          if (receipt.fingerprint !== fingerprint) {
            throw new H2HSettlementDataError(
              `Settlement receipt ${JSON.stringify(event.eventId)} has a conflicting fingerprint.`,
            );
          }
          const writes = new Map<string, RedisCasWrite>();
          if (pendingIndex >= 0) {
            setWrite(
              writes,
              H2H_STORE_KEYS.pendingSettlements,
              serializeH2HSettlementEvents(
                pending.filter((_, index) => index !== pendingIndex),
              ),
            );
          }
          return commitOrNoChange(writes, {
            eventId: event.eventId,
            status: "already_settled" as const,
            receipt,
          });
        }

        if (!pendingEvent) {
          return {
            action: "no-change" as const,
            result: {
              eventId: event.eventId,
              status: "not_pending" as const,
              receipt: null,
            },
          };
        }

        const first = effectiveElo(
          snapshot.get(firstEloKey),
          snapshot.get(firstLegacyKey),
          `Elo record for ${firstId}`,
        );
        const second = effectiveElo(
          snapshot.get(secondEloKey),
          snapshot.get(secondLegacyKey),
          `Elo record for ${secondId}`,
        );
        const [nextFirst, nextSecond] = updateEloPair(
          first,
          second,
          event.resultForFirst,
        );
        const players = parseStringSet(
          snapshot.get(H2H_SETTLEMENT_KEYS.players),
          "H2H player index",
        );
        const completedUsers = parseStringSet(
          snapshot.get(H2H_SETTLEMENT_KEYS.completedUsers),
          "H2H completed-user set",
        );
        const terminalCount = incrementCounter(
          parseCounter(snapshot.get(terminalCountKey), "H2H terminal count"),
          "H2H terminal count",
        );
        const dailyCount = incrementCounter(
          parseCounter(snapshot.get(dailyKey), "H2H daily count"),
          "H2H daily count",
        );
        const receipt: H2HSettlementReceipt = {
          version: RECEIPT_VERSION,
          eventId: event.eventId,
          fingerprint,
          settledAt,
        };

        const writes = new Map<string, RedisCasWrite>();
        setWrite(
          writes,
          H2H_STORE_KEYS.pendingSettlements,
          serializeH2HSettlementEvents(
            pending.filter((_, index) => index !== pendingIndex),
          ),
        );
        setWrite(writes, receiptKey, JSON.stringify(receipt));
        setWrite(writes, firstEloKey, JSON.stringify(nextFirst));
        setWrite(writes, secondEloKey, JSON.stringify(nextSecond));
        if (snapshot.get(firstLegacyKey) !== undefined) {
          deleteWrite(writes, firstLegacyKey);
        }
        if (snapshot.get(secondLegacyKey) !== undefined) {
          deleteWrite(writes, secondLegacyKey);
        }
        setWrite(
          writes,
          H2H_SETTLEMENT_KEYS.players,
          JSON.stringify([...new Set([...players, firstId, secondId])]),
        );
        setWrite(
          writes,
          H2H_SETTLEMENT_KEYS.completedUsers,
          JSON.stringify([...new Set([...completedUsers, firstId, secondId])]),
        );
        setWrite(writes, terminalCountKey, String(terminalCount));
        setWrite(writes, dailyKey, String(dailyCount));

        return {
          action: "commit" as const,
          writes: [...writes.values()],
          result: {
            eventId: event.eventId,
            status: "settled" as const,
            receipt,
          },
        };
      },
      this.casOptions,
    );
  }

  async drainPending(limitInput?: number): Promise<H2HSettlementDrainResult> {
    const limit = normalizeLimit(
      limitInput,
      this.defaultDrainLimit,
      this.maxDrainLimit,
    );
    const pending = parseH2HSettlementEvents(
      await this.redis.get(H2H_STORE_KEYS.pendingSettlements),
    ).slice(0, limit);
    const result: H2HSettlementDrainResult = {
      attempted: pending.length,
      settled: 0,
      alreadySettled: 0,
      noLongerPending: 0,
      failedEventIds: [],
      remaining: 0,
    };

    for (const event of pending) {
      try {
        const settled = await this.settle(event);
        if (settled.status === "settled") result.settled++;
        else if (settled.status === "already_settled") {
          result.alreadySettled++;
        } else {
          result.noLongerPending++;
        }
      } catch {
        // The durable event remains available for the next bounded drain.
        result.failedEventIds.push(event.eventId);
      }
    }

    result.remaining = parseH2HSettlementEvents(
      await this.redis.get(H2H_STORE_KEYS.pendingSettlements),
    ).length;
    return result;
  }
}
