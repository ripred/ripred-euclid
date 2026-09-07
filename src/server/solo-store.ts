import { createHash, randomUUID } from "node:crypto";

import type {
  RankingsShareRow,
  ResultSharePayload,
  SoloAbandonRequest,
  SoloAbandonResponse,
  SoloMoveRequest,
  SoloMoveResponse,
  SoloEndReason,
  SoloSessionSnapshot,
  SoloStartResponse,
  SoloTerminalResult,
} from "../shared/types/api";
import {
  AI_DIFFICULTY_LABELS,
  playerColorForIndex,
  type AiDifficulty,
  type GameOutcome,
  type PracticeRules,
  type RankedSoloRules,
  type SoloRules,
} from "../shared/game/rules";
import {
  abandonSoloSession,
  applySoloMove,
  createSoloSession,
  normalizeSoloSessionRecord,
  publicSoloSnapshotFromCanonicalRecord,
  soloResultForHumanFromCanonicalRecord,
  soloSessionMetadata,
  soloTerminalResultFromCanonicalRecord,
  validateSoloStartRequest,
  withSoloRating,
  type SoloSessionRecord,
} from "./solo";
import {
  commitRedisCasWrites as commitDecision,
  deleteRedisCasWrite as deleteWrite,
  redisMultiCas,
  setRedisCasWrite as setWrite,
  type RedisCasClient,
  type RedisCasOptions,
  type RedisCasSnapshot,
  type RedisCasWrite,
} from "./redis-cas";
import {
  SOLO_WORK_LIMITS,
  SOLO_PRACTICE_RETENTION_MS,
  SOLO_SHARE_COOLDOWN_MS,
  soloWorkBudgetKey,
  soloShareCooldownKey,
  reserveWindowBudget,
  soloReceiptBudgetKey,
  writeSoloReceipt,
  writeShareCooldown,
} from "./request-limits";

export const SOLO_STORE_SCHEMA_VERSION = 1 as const;
export const SOLO_RATING_SCHEMA_VERSION = 1 as const;
export const SOLO_RANKED_START_RATING = 1_200;
export const SOLO_RANKED_AI_RATING = 1_600;
export const SOLO_RANKED_K_FACTOR = 32;

const DEFAULT_DYNAMIC_ATTEMPTS = 8;
const MAX_IDENTIFIER_LENGTH = 256;
const MAX_FAILURE_MESSAGE_LENGTH = 1_000;

const metricSet = (name: string) => `euclid:metric:set:${name}`;
const metricCount = (name: string) => `euclid:metric:count:${name}`;

/**
 * Versioned canonical solo keys. The old `euclid:elo:hva:*`,
 * `euclid:players:hva`, and `euclid:solo:last:*` namespaces are intentionally
 * absent so legacy client-claimed results cannot enter the Ranked table.
 */
export const SOLO_STORE_KEYS = Object.freeze({
  game: (gameId: string) => `euclid:solo:v1:game:${gameId}`,
  activeRanked: (userId: string) => `euclid:solo:v1:ranked:active:${userId}`,
  start: (userId: string, commandHash: string) =>
    `euclid:solo:v1:start:${userId}:${commandHash}`,
  move: (gameId: string, commandHash: string) =>
    `euclid:solo:v1:move:${gameId}:${commandHash}`,
  abandon: (gameId: string, commandHash: string) =>
    `euclid:solo:v1:abandon:${gameId}:${commandHash}`,
  result: (gameId: string) => `euclid:solo:v1:result:${gameId}`,
  rankedRating: (userId: string) => `euclid:solo:v1:ranked:r1:elo:${userId}`,
  rankedPlayers: "euclid:solo:v1:ranked:r1:players",
  share: (gameId: string) => `euclid:solo:v1:share:${gameId}`,
  sharedPost: (shareId: string) => `euclid:share:post:${shareId}`,
  profileName: (userId: string) => `euclid:name:${userId}`,
  profileAvatar: (userId: string) => `euclid:avatar:${userId}`,
  aiFirstUsers: metricSet("ai_first_users"),
  aiFirstCount: metricCount("ai_first_count"),
  aiCompletedUsers: metricSet("ai_completed_users"),
  aiCompletedCount: metricCount("ai_completed_count"),
  aiDifficultyCount: (difficulty: AiDifficulty) =>
    metricCount(`ai_diff_${difficulty}_count`),
  aiDailyCount: (difficulty: AiDifficulty, date: string) =>
    metricCount(`euclid:daily:ai_${difficulty}:${date}`),
});

export type SoloStoreOptions = {
  now?: () => number;
  createGameId?: () => string;
  createSeed?: () => string;
  createShareId?: () => string;
  maxDynamicAttempts?: number;
  cas?: RedisCasOptions;
};

export type SoloStoreErrorCode =
  | "invalid_identifier"
  | "game_not_found"
  | "not_owner"
  | "command_conflict"
  | "mapping_corrupt"
  | "data_corrupt"
  | "dynamic_conflict"
  | "result_not_found"
  | "result_not_shareable"
  | "share_conflict";

export class SoloStoreError extends Error {
  override readonly name = "SoloStoreError";

  constructor(
    readonly code: SoloStoreErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export type SoloRankedRatingRecord = {
  schemaVersion: typeof SOLO_RATING_SCHEMA_VERSION;
  rating: number;
  games: number;
  wins: number;
  losses: number;
  draws: number;
};

export type SoloCanonicalResult = {
  schemaVersion: typeof SOLO_STORE_SCHEMA_VERSION;
  fingerprint: string;
  gameId: string;
  ownerId: string;
  revision: number;
  mode: SoloRules["mode"];
  rules: RankedSoloRules | PracticeRules;
  outcome: GameOutcome;
  endedReason: SoloEndReason;
  snapshot: SoloSessionSnapshot;
  completedAt: string;
  resultForHuman: 0 | 0.5 | 1 | null;
  rated: boolean;
  rating: { before: number; after: number } | null;
};

export type SoloSharePrepareInput = {
  gameId: string;
  commandId: string;
  subredditName: string;
  humanName: string;
  humanAvatar?: string;
};

export type SoloPreparedShareReceipt = {
  schemaVersion: typeof SOLO_STORE_SCHEMA_VERSION;
  status: "prepared";
  gameId: string;
  ownerId: string;
  commandId: string;
  commandHash: string;
  resultFingerprint: string;
  shareId: string;
  payload: ResultSharePayload;
  preparedAt: string;
};

export type SoloPostedShareReceipt = Omit<
  SoloPreparedShareReceipt,
  "status"
> & {
  status: "posted";
  postId: string;
  permalink: string;
  runAs: string;
  postedAt: string;
};

export type SoloFailedShareReceipt = Omit<
  SoloPreparedShareReceipt,
  "status"
> & {
  status: "failed";
  failureMessage: string;
  failedAt: string;
};

export type SoloStoredShareReceipt =
  | SoloPreparedShareReceipt
  | SoloFailedShareReceipt
  | SoloPostedShareReceipt;

export type SoloPrepareShareResult = {
  receipt: SoloPreparedShareReceipt | SoloPostedShareReceipt;
  shouldSubmit: boolean;
};

export type SoloFinalizeShareInput = {
  gameId: string;
  shareId: string;
  postId: string;
  permalink: string;
  runAs: string;
};

export type SoloFailShareInput = {
  gameId: string;
  shareId: string;
  failureMessage: string;
};

type SoloStartReceipt = {
  schemaVersion: typeof SOLO_STORE_SCHEMA_VERSION;
  ownerId: string;
  commandHash: string;
  fingerprint: string;
  gameId: string;
  response: SoloStartResponse;
};

type SoloCommandReceipt<TResponse> = {
  schemaVersion: typeof SOLO_STORE_SCHEMA_VERSION;
  ownerId: string;
  gameId: string;
  commandHash: string;
  fingerprint: string;
  response: TResponse;
};

type DynamicResult<TResult> =
  | { status: "retry" }
  | { status: "done"; value: TResult };

type StartDiscovery = {
  watchKeys: string[];
};

type MutationDiscovery = {
  mode: SoloRules["mode"];
  humanMoveCount: number;
  watchKeys: string[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseJson(raw: string | undefined): unknown {
  if (!raw) return undefined;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    throw new SoloStoreError("data_corrupt", "Stored solo JSON is malformed.");
  }
}

function requireIdentifier(value: unknown, field: string): string {
  if (
    typeof value !== "string" ||
    value.trim().length === 0 ||
    value.trim() !== value ||
    value.length > MAX_IDENTIFIER_LENGTH
  ) {
    throw new SoloStoreError(
      "invalid_identifier",
      `${field} must be a non-empty string no longer than ${MAX_IDENTIFIER_LENGTH} characters.`,
    );
  }
  return value;
}

function requireFailureMessage(value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new SoloStoreError(
      "invalid_identifier",
      "failureMessage must be a non-empty string.",
    );
  }
  return value.trim().slice(0, MAX_FAILURE_MESSAGE_LENGTH);
}

export function hashSoloCommandId(commandId: string): string {
  requireIdentifier(commandId, "commandId");
  return createHash("sha256").update(commandId, "utf8").digest("hex");
}

function hashValue(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function serialize(value: unknown): string {
  return JSON.stringify(value);
}

function isoTime(timestamp: number): string {
  if (!Number.isSafeInteger(timestamp) || timestamp < 0) {
    throw new RangeError(
      "The solo store clock must return a non-negative integer.",
    );
  }
  return new Date(timestamp).toISOString();
}

function utcDate(timestamp: number): string {
  return isoTime(timestamp).slice(0, 10);
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values.filter((value) => value.length > 0))];
}

function parseStringList(raw: string | undefined, field: string): string[] {
  if (raw === undefined) return [];
  const parsed = parseJson(raw);
  if (
    !Array.isArray(parsed) ||
    parsed.some((value) => typeof value !== "string" || !value)
  ) {
    throw new SoloStoreError("data_corrupt", `${field} is malformed.`);
  }
  return uniqueStrings(parsed);
}

function parseCount(raw: string | undefined, field: string): number {
  if (raw === undefined) return 0;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new SoloStoreError("data_corrupt", `${field} is malformed.`);
  }
  return value;
}

function addSetMember(raw: string | undefined, member: string, field: string) {
  const values = parseStringList(raw, field);
  return values.includes(member) ? values : [...values, member];
}

function assertOwner(record: SoloSessionRecord, userId: string): void {
  if (record.ownerId !== userId) {
    throw new SoloStoreError(
      "not_owner",
      "The caller does not own this solo game.",
    );
  }
}

function startFingerprint(rules: SoloRules): string {
  return hashValue(serialize({ operation: "start", rules }));
}

function moveFingerprint(request: SoloMoveRequest): string {
  return hashValue(
    serialize({
      operation: "move",
      gameId: request.gameId,
      x: request.x,
      y: request.y,
      expectedRevision: request.expectedRevision,
    }),
  );
}

function abandonFingerprint(request: SoloAbandonRequest): string {
  return hashValue(
    serialize({
      operation: "abandon",
      gameId: request.gameId,
      expectedRevision: request.expectedRevision,
    }),
  );
}

function parseStartReceipt(raw: string | undefined): SoloStartReceipt | null {
  if (raw === undefined) return null;
  const value = parseJson(raw);
  if (
    !isRecord(value) ||
    value.schemaVersion !== SOLO_STORE_SCHEMA_VERSION ||
    typeof value.ownerId !== "string" ||
    typeof value.commandHash !== "string" ||
    typeof value.fingerprint !== "string" ||
    typeof value.gameId !== "string" ||
    !isRecord(value.response)
  ) {
    throw new SoloStoreError(
      "data_corrupt",
      "A solo start receipt is malformed.",
    );
  }
  return value as SoloStartReceipt;
}

function parseCommandReceipt<TResponse>(
  raw: string | undefined,
  operation: string,
): SoloCommandReceipt<TResponse> | null {
  if (raw === undefined) return null;
  const value = parseJson(raw);
  if (
    !isRecord(value) ||
    value.schemaVersion !== SOLO_STORE_SCHEMA_VERSION ||
    typeof value.ownerId !== "string" ||
    typeof value.gameId !== "string" ||
    typeof value.commandHash !== "string" ||
    typeof value.fingerprint !== "string" ||
    !isRecord(value.response)
  ) {
    throw new SoloStoreError(
      "data_corrupt",
      `A solo ${operation} receipt is malformed.`,
    );
  }
  return value as SoloCommandReceipt<TResponse>;
}

function parseRating(raw: string | undefined): SoloRankedRatingRecord {
  if (raw === undefined) {
    return {
      schemaVersion: SOLO_RATING_SCHEMA_VERSION,
      rating: SOLO_RANKED_START_RATING,
      games: 0,
      wins: 0,
      losses: 0,
      draws: 0,
    };
  }
  const value = parseJson(raw);
  if (!isRecord(value) || value.schemaVersion !== SOLO_RATING_SCHEMA_VERSION) {
    throw new SoloStoreError(
      "data_corrupt",
      "A Ranked solo rating is malformed.",
    );
  }
  const ratingField = (
    field: keyof Omit<SoloRankedRatingRecord, "schemaVersion">,
  ) => {
    const item = value[field];
    if (typeof item !== "number" || !Number.isSafeInteger(item) || item < 0) {
      throw new SoloStoreError(
        "data_corrupt",
        "A Ranked solo rating is malformed.",
      );
    }
    return item;
  };
  const normalized: SoloRankedRatingRecord = {
    schemaVersion: SOLO_RATING_SCHEMA_VERSION,
    rating: ratingField("rating"),
    games: ratingField("games"),
    wins: ratingField("wins"),
    losses: ratingField("losses"),
    draws: ratingField("draws"),
  };
  if (
    normalized.games !==
    normalized.wins + normalized.losses + normalized.draws
  ) {
    throw new SoloStoreError(
      "data_corrupt",
      "A Ranked solo rating total is inconsistent.",
    );
  }
  return normalized;
}

export function settleSoloRankedRating(
  current: SoloRankedRatingRecord,
  result: 0 | 0.5 | 1,
): SoloRankedRatingRecord {
  const expected =
    1 / (1 + Math.pow(10, (SOLO_RANKED_AI_RATING - current.rating) / 400));
  return {
    ...current,
    rating: Math.round(
      current.rating + SOLO_RANKED_K_FACTOR * (result - expected),
    ),
    games: current.games + 1,
    wins: current.wins + (result === 1 ? 1 : 0),
    losses: current.losses + (result === 0 ? 1 : 0),
    draws: current.draws + (result === 0.5 ? 1 : 0),
  };
}

function canonicalResultBase(
  record: SoloSessionRecord,
  rating: { before: number; after: number } | null,
): Omit<SoloCanonicalResult, "fingerprint"> {
  const terminal = soloTerminalResultFromCanonicalRecord(record);
  if (!terminal) {
    throw new SoloStoreError(
      "data_corrupt",
      "An active solo game cannot produce a terminal result.",
    );
  }
  const snapshot = publicSoloSnapshotFromCanonicalRecord(record);
  return {
    schemaVersion: SOLO_STORE_SCHEMA_VERSION,
    gameId: record.gameId,
    ownerId: record.ownerId,
    revision: record.revision,
    mode: record.rules.mode,
    rules: record.rules,
    outcome: terminal.outcome,
    endedReason: terminal.endedReason,
    snapshot,
    completedAt: terminal.completedAt,
    resultForHuman: terminal.resultForHuman,
    rated: rating !== null,
    rating,
  };
}

function createCanonicalResult(
  record: SoloSessionRecord,
  rating: { before: number; after: number } | null,
): SoloCanonicalResult {
  const base = canonicalResultBase(record, rating);
  return { ...base, fingerprint: hashValue(serialize(base)) };
}

function parseCanonicalResult(
  raw: string | undefined,
  expectedGameId?: string,
): SoloCanonicalResult | null {
  if (raw === undefined) return null;
  const value = parseJson(raw);
  if (
    !isRecord(value) ||
    value.schemaVersion !== SOLO_STORE_SCHEMA_VERSION ||
    typeof value.fingerprint !== "string" ||
    typeof value.gameId !== "string" ||
    typeof value.ownerId !== "string" ||
    typeof value.revision !== "number" ||
    (value.mode !== "ranked" && value.mode !== "practice") ||
    !isRecord(value.rules) ||
    !isRecord(value.outcome) ||
    !isRecord(value.snapshot) ||
    typeof value.completedAt !== "string" ||
    typeof value.rated !== "boolean"
  ) {
    throw new SoloStoreError(
      "data_corrupt",
      "A canonical solo result is malformed.",
    );
  }
  if (expectedGameId !== undefined && value.gameId !== expectedGameId) {
    throw new SoloStoreError(
      "data_corrupt",
      "A canonical solo result is stored under the wrong game ID.",
    );
  }
  const { fingerprint, ...base } = value;
  if (hashValue(serialize(base)) !== fingerprint) {
    throw new SoloStoreError(
      "data_corrupt",
      "A canonical solo result fingerprint is inconsistent.",
    );
  }
  return value as SoloCanonicalResult;
}

function parseShareReceipt(
  raw: string | undefined,
  expectedGameId: string,
): SoloStoredShareReceipt | null {
  if (raw === undefined) return null;
  const value = parseJson(raw);
  if (
    !isRecord(value) ||
    value.schemaVersion !== SOLO_STORE_SCHEMA_VERSION ||
    (value.status !== "prepared" &&
      value.status !== "failed" &&
      value.status !== "posted") ||
    value.gameId !== expectedGameId ||
    typeof value.ownerId !== "string" ||
    typeof value.commandId !== "string" ||
    typeof value.commandHash !== "string" ||
    typeof value.resultFingerprint !== "string" ||
    typeof value.shareId !== "string" ||
    !isRecord(value.payload) ||
    typeof value.preparedAt !== "string"
  ) {
    throw new SoloStoreError(
      "data_corrupt",
      "A canonical solo share receipt is malformed.",
    );
  }
  if (
    value.status === "failed" &&
    (typeof value.failureMessage !== "string" ||
      value.failureMessage.trim().length === 0 ||
      value.failureMessage.length > MAX_FAILURE_MESSAGE_LENGTH ||
      typeof value.failedAt !== "string")
  ) {
    throw new SoloStoreError(
      "data_corrupt",
      "A failed solo share receipt is malformed.",
    );
  }
  if (
    value.status === "posted" &&
    (typeof value.postId !== "string" ||
      typeof value.permalink !== "string" ||
      typeof value.runAs !== "string" ||
      typeof value.postedAt !== "string")
  ) {
    throw new SoloStoreError(
      "data_corrupt",
      "A posted solo share receipt is malformed.",
    );
  }
  return value as SoloStoredShareReceipt;
}

function assertStoredSharePayload(
  snapshot: RedisCasSnapshot,
  receipt: SoloStoredShareReceipt,
): void {
  const storedPayload = snapshot.get(
    SOLO_STORE_KEYS.sharedPost(receipt.shareId),
  );
  if (
    storedPayload === undefined ||
    hashValue(storedPayload) !== hashValue(serialize(receipt.payload))
  ) {
    throw new SoloStoreError(
      "data_corrupt",
      "The prepared solo share payload is missing or inconsistent.",
    );
  }
}

function addRatingToMoveResponse(
  response: SoloMoveResponse,
  rating: { before: number; after: number } | null,
): SoloMoveResponse {
  if (!rating || !response.accepted) return response;
  return {
    ...response,
    events: response.events.map((event) =>
      event.type === "game_ended" ? { ...event, rating } : event,
    ),
    snapshot: { ...response.snapshot, rating },
  };
}

function addRatingToAbandonResponse(
  response: SoloAbandonResponse,
  rating: { before: number; after: number } | null,
): SoloAbandonResponse {
  if (!rating || !response.abandoned) return response;
  return {
    ...response,
    events: response.events.map((event) =>
      event.type === "game_ended" ? { ...event, rating } : event,
    ),
    snapshot: { ...response.snapshot, rating },
  };
}

function resultForCommandConflict(
  commandId: string,
  snapshot: SoloSessionSnapshot,
): SoloMoveResponse {
  return {
    ok: false,
    accepted: false,
    commandId,
    replayed: false,
    reason: "command_conflict",
    message: "This command ID was already used for a different move.",
    events: [],
    snapshot,
  };
}

function abandonResultForCommandConflict(
  commandId: string,
  snapshot: SoloSessionSnapshot,
): SoloAbandonResponse {
  return {
    ok: false,
    abandoned: false,
    commandId,
    replayed: false,
    reason: "command_conflict",
    message: "This command ID was already used for a different action.",
    events: [],
    snapshot,
  };
}

function asReplayed<T extends { replayed: boolean }>(response: T): T {
  return { ...response, replayed: true };
}

function terminalRatingResult(record: SoloSessionRecord): 0 | 0.5 | 1 | null {
  if (record.rules.mode !== "ranked") return null;
  return soloResultForHumanFromCanonicalRecord(record);
}

function writeFirstMoveMetrics(
  snapshot: RedisCasSnapshot,
  writes: Map<string, RedisCasWrite>,
  ownerId: string,
): void {
  setWrite(
    writes,
    SOLO_STORE_KEYS.aiFirstUsers,
    serialize(
      addSetMember(
        snapshot.get(SOLO_STORE_KEYS.aiFirstUsers),
        ownerId,
        "AI first-move users",
      ),
    ),
  );
  setWrite(
    writes,
    SOLO_STORE_KEYS.aiFirstCount,
    String(
      parseCount(
        snapshot.get(SOLO_STORE_KEYS.aiFirstCount),
        "AI first-move count",
      ) + 1,
    ),
  );
}

function writeCompletionMetrics(
  snapshot: RedisCasSnapshot,
  writes: Map<string, RedisCasWrite>,
  ownerId: string,
  difficulty: AiDifficulty,
  date: string,
): void {
  const difficultyKey = SOLO_STORE_KEYS.aiDifficultyCount(difficulty);
  const dailyKey = SOLO_STORE_KEYS.aiDailyCount(difficulty, date);
  setWrite(
    writes,
    SOLO_STORE_KEYS.aiCompletedUsers,
    serialize(
      addSetMember(
        snapshot.get(SOLO_STORE_KEYS.aiCompletedUsers),
        ownerId,
        "AI completed users",
      ),
    ),
  );
  for (const [key, field] of [
    [SOLO_STORE_KEYS.aiCompletedCount, "AI completed count"],
    [difficultyKey, "AI difficulty count"],
    [dailyKey, "AI daily count"],
  ] as const) {
    setWrite(writes, key, String(parseCount(snapshot.get(key), field) + 1));
  }
}

function describeRules(rules: SoloRules): string {
  const mode = rules.mode === "ranked" ? "Ranked" : "Practice";
  const scoring = rules.scoring === "bbox" ? "Grid Footprint" : "True Area";
  return `${mode} · ${rules.W}×${rules.H} · ${scoring} · First to ${rules.winScore} · ${AI_DIFFICULTY_LABELS[rules.difficulty]}`;
}

function buildSharePayload(
  result: SoloCanonicalResult,
  input: SoloSharePrepareInput,
  shareId: string,
  sharedAt: string,
): ResultSharePayload {
  const humanSide = playerColorForIndex(result.rules.humanPlayer);
  const humanScore =
    result.snapshot.board.m_players[result.rules.humanPlayer].m_score;
  const aiIndex = result.rules.humanPlayer === 0 ? 1 : 0;
  const aiScore = result.snapshot.board.m_players[aiIndex].m_score;
  const humanIsFirst = result.rules.humanPlayer === 0;
  return {
    kind: "result",
    shareId,
    subredditName: input.subredditName,
    sharedAt,
    mode: "ai",
    title: "Redditor vs Euclid",
    subtitle: describeRules(result.rules),
    headline: `${input.humanName} defeated Euclid!`,
    details: `${humanScore}–${aiScore}`,
    footer: "Play Euclid on Reddit",
    board: result.snapshot.board,
    p1Name: humanIsFirst ? input.humanName : "Euclid",
    p2Name: humanIsFirst ? "Euclid" : input.humanName,
    ...(humanIsFirst
      ? input.humanAvatar
        ? { p1Avatar: input.humanAvatar }
        : {}
      : input.humanAvatar
        ? { p2Avatar: input.humanAvatar }
        : {}),
    winnerSide: humanSide,
    solo: soloSessionMetadata(result.rules),
  };
}

/**
 * Owns canonical solo sessions and their idempotency receipts. A watched
 * transaction groups each command's related session, result, rating, metric,
 * and receipt writes so it cannot leave partial state or settle twice.
 */
export class SoloStore {
  private readonly now: () => number;
  private readonly createGameId: () => string;
  private readonly createSeed: () => string;
  private readonly createShareId: () => string;
  private readonly maxDynamicAttempts: number;
  private readonly casOptions: RedisCasOptions;

  constructor(
    private readonly redis: RedisCasClient,
    options: SoloStoreOptions = {},
  ) {
    this.now = options.now ?? Date.now;
    this.createGameId = options.createGameId ?? randomUUID;
    this.createSeed = options.createSeed ?? randomUUID;
    this.createShareId = options.createShareId ?? randomUUID;
    this.maxDynamicAttempts =
      options.maxDynamicAttempts ?? DEFAULT_DYNAMIC_ATTEMPTS;
    this.casOptions = options.cas ?? {};

    if (
      !Number.isSafeInteger(this.maxDynamicAttempts) ||
      this.maxDynamicAttempts < 1
    ) {
      throw new RangeError(
        "maxDynamicAttempts must be a positive safe integer.",
      );
    }
  }

  // A start receipt binds one command ID to one rules fingerprint and response;
  // retries replay it, while newly discovered dependencies restart discovery.
  async start(userId: string, input: unknown): Promise<SoloStartResponse> {
    requireIdentifier(userId, "userId");
    const { request, rules } = validateSoloStartRequest(input);
    await this.admitWork(userId);
    const commandHash = hashSoloCommandId(request.commandId);
    const fingerprint = startFingerprint(rules);
    const candidateGameId = requireIdentifier(this.createGameId(), "gameId");
    const candidateSeed = requireIdentifier(this.createSeed(), "seed");
    const candidateGameKey = SOLO_STORE_KEYS.game(candidateGameId);
    const receiptKey = SOLO_STORE_KEYS.start(userId, commandHash);
    const timestamp = this.now();

    for (let attempt = 0; attempt < this.maxDynamicAttempts; attempt++) {
      const discovery = await this.discoverStart(
        userId,
        rules.mode,
        receiptKey,
        candidateGameKey,
      );
      const result = await redisMultiCas<DynamicResult<SoloStartResponse>>(
        this.redis,
        discovery.watchKeys,
        (snapshot) => {
          const existingReceipt = parseStartReceipt(snapshot.get(receiptKey));
          if (existingReceipt) {
            this.assertStartReceipt(
              existingReceipt,
              userId,
              commandHash,
              fingerprint,
            );
            const receiptGameKey = SOLO_STORE_KEYS.game(existingReceipt.gameId);
            if (!discovery.watchKeys.includes(receiptGameKey)) {
              return {
                action: "no-change" as const,
                result: { status: "retry" as const },
              };
            }
            const receiptGameRaw = snapshot.get(receiptGameKey);
            if (!receiptGameRaw) {
              throw new SoloStoreError(
                "data_corrupt",
                "A solo start receipt points to a missing game.",
              );
            }
            const receiptGame = normalizeSoloSessionRecord(
              parseJson(receiptGameRaw),
              existingReceipt.gameId,
            );
            assertOwner(receiptGame, userId);
            return {
              action: "no-change" as const,
              result: {
                status: "done" as const,
                value: asReplayed(existingReceipt.response),
              },
            };
          }

          if (rules.mode === "ranked") {
            const activeKey = SOLO_STORE_KEYS.activeRanked(userId);
            const activeGameId = snapshot.get(activeKey);
            if (activeGameId) {
              const activeGameKey = SOLO_STORE_KEYS.game(activeGameId);
              if (!discovery.watchKeys.includes(activeGameKey)) {
                return {
                  action: "no-change" as const,
                  result: { status: "retry" as const },
                };
              }
              const activeRaw = snapshot.get(activeGameKey);
              if (!activeRaw) {
                throw new SoloStoreError(
                  "mapping_corrupt",
                  "The active Ranked mapping points to a missing game.",
                );
              }
              const active = normalizeSoloSessionRecord(
                parseJson(activeRaw),
                activeGameId,
              );
              assertOwner(active, userId);
              if (active.rules.mode !== "ranked") {
                throw new SoloStoreError(
                  "mapping_corrupt",
                  "The active Ranked mapping points to a Practice game.",
                );
              }
              const activeResult = parseCanonicalResult(
                snapshot.get(SOLO_STORE_KEYS.result(activeGameId)),
                activeGameId,
              );
              if (active.status === "active") {
                if (activeResult) {
                  throw new SoloStoreError(
                    "mapping_corrupt",
                    "An active Ranked game already has a terminal result.",
                  );
                }
                const response: SoloStartResponse = {
                  ok: true,
                  resumed: true,
                  commandId: request.commandId,
                  replayed: false,
                  events: [],
                  snapshot: publicSoloSnapshotFromCanonicalRecord(active),
                };
                const receipt: SoloStartReceipt = {
                  schemaVersion: SOLO_STORE_SCHEMA_VERSION,
                  ownerId: userId,
                  commandHash,
                  fingerprint,
                  gameId: activeGameId,
                  response,
                };
                const writes = new Map<string, RedisCasWrite>();
                writeSoloReceipt(
                  snapshot,
                  writes,
                  userId,
                  receiptKey,
                  serialize(receipt),
                  timestamp,
                );
                return commitDecision(writes, {
                  status: "done" as const,
                  value: response,
                });
              }
              if (!activeResult || activeResult.ownerId !== userId) {
                throw new SoloStoreError(
                  "mapping_corrupt",
                  "A terminal Ranked mapping is missing its canonical result.",
                );
              }
              // A well-formed terminal game is a stale mapping, not a corrupt
              // live invariant. The new mapping replaces it in this CAS.
            }
          }

          if (snapshot.get(candidateGameKey) !== undefined) {
            throw new SoloStoreError(
              "data_corrupt",
              "The generated solo game ID is already in use.",
            );
          }
          const created = createSoloSession({
            gameId: candidateGameId,
            ownerId: userId,
            rules,
            privateSeed: candidateSeed,
            now: timestamp,
          });
          const response: SoloStartResponse = {
            ok: true,
            resumed: false,
            commandId: request.commandId,
            replayed: false,
            events: created.events,
            snapshot: publicSoloSnapshotFromCanonicalRecord(created.record),
          };
          const receipt: SoloStartReceipt = {
            schemaVersion: SOLO_STORE_SCHEMA_VERSION,
            ownerId: userId,
            commandHash,
            fingerprint,
            gameId: candidateGameId,
            response,
          };
          const writes = new Map<string, RedisCasWrite>();
          this.writeGame(snapshot, writes, created.record, timestamp);
          writeSoloReceipt(
            snapshot,
            writes,
            userId,
            receiptKey,
            serialize(receipt),
            timestamp,
          );
          if (rules.mode === "ranked") {
            setWrite(
              writes,
              SOLO_STORE_KEYS.activeRanked(userId),
              candidateGameId,
            );
          }
          return commitDecision(writes, {
            status: "done" as const,
            value: response,
          });
        },
        this.casOptions,
      );
      if (result.status === "done") return result.value;
    }

    throw new SoloStoreError(
      "dynamic_conflict",
      "The active solo session changed too frequently to start safely.",
    );
  }

  async getActiveRanked(userId: string): Promise<SoloSessionSnapshot | null> {
    requireIdentifier(userId, "userId");
    await this.admitWork(userId);
    const activeKey = SOLO_STORE_KEYS.activeRanked(userId);
    for (let attempt = 0; attempt < 2; attempt++) {
      const gameId = await this.redis.get(activeKey);
      if (!gameId) return null;
      const raw = await this.redis.get(SOLO_STORE_KEYS.game(gameId));
      const confirmedGameId = await this.redis.get(activeKey);
      if (confirmedGameId !== gameId) continue;
      if (!raw) {
        throw new SoloStoreError(
          "mapping_corrupt",
          "The active Ranked mapping points to a missing game.",
        );
      }
      const record = normalizeSoloSessionRecord(parseJson(raw), gameId);
      assertOwner(record, userId);
      if (record.rules.mode !== "ranked") {
        throw new SoloStoreError(
          "mapping_corrupt",
          "The active Ranked mapping points to a Practice game.",
        );
      }
      return record.status === "active"
        ? publicSoloSnapshotFromCanonicalRecord(record)
        : null;
    }
    throw new SoloStoreError(
      "dynamic_conflict",
      "The active Ranked mapping changed while it was being read.",
    );
  }

  async getState(userId: string, gameId: string): Promise<SoloSessionSnapshot> {
    requireIdentifier(userId, "userId");
    requireIdentifier(gameId, "gameId");
    await this.admitWork(userId);
    const raw = await this.redis.get(SOLO_STORE_KEYS.game(gameId));
    if (!raw)
      throw new SoloStoreError("game_not_found", "Solo game not found.");
    const record = normalizeSoloSessionRecord(parseJson(raw), gameId);
    assertOwner(record, userId);
    return publicSoloSnapshotFromCanonicalRecord(record);
  }

  async move(
    userId: string,
    request: SoloMoveRequest,
  ): Promise<SoloMoveResponse> {
    requireIdentifier(userId, "userId");
    requireIdentifier(request?.gameId, "gameId");
    const commandHash = hashSoloCommandId(request?.commandId);
    const fingerprint = moveFingerprint(request);
    await this.admitWork(userId);
    const gameKey = SOLO_STORE_KEYS.game(request.gameId);
    const receiptKey = SOLO_STORE_KEYS.move(request.gameId, commandHash);
    const timestamp = this.now();

    for (let attempt = 0; attempt < this.maxDynamicAttempts; attempt++) {
      const discovery = await this.discoverMutation(
        userId,
        request.gameId,
        receiptKey,
        timestamp,
        true,
      );
      const result = await redisMultiCas<DynamicResult<SoloMoveResponse>>(
        this.redis,
        discovery.watchKeys,
        (snapshot) => {
          const raw = snapshot.get(gameKey);
          if (!raw) {
            throw new SoloStoreError("game_not_found", "Solo game not found.");
          }
          const current = normalizeSoloSessionRecord(
            parseJson(raw),
            request.gameId,
          );
          assertOwner(current, userId);
          if (
            current.rules.mode !== discovery.mode ||
            (current.humanMoveCount === 0) !== (discovery.humanMoveCount === 0)
          ) {
            return {
              action: "no-change" as const,
              result: { status: "retry" as const },
            };
          }
          this.assertResultConsistency(snapshot, current);

          const receipt = parseCommandReceipt<SoloMoveResponse>(
            snapshot.get(receiptKey),
            "move",
          );
          if (receipt) {
            this.assertCommandReceipt(
              receipt,
              userId,
              request.gameId,
              commandHash,
            );
            return {
              action: "no-change" as const,
              result: {
                status: "done" as const,
                value:
                  receipt.fingerprint === fingerprint
                    ? asReplayed(receipt.response)
                    : resultForCommandConflict(
                        request.commandId,
                        publicSoloSnapshotFromCanonicalRecord(current),
                      ),
              },
            };
          }

          const applied = applySoloMove(current, request, timestamp);
          let nextRecord = applied.record;
          let response = applied.response;
          const writes = new Map<string, RedisCasWrite>();
          if (response.accepted) {
            const wasFirstHumanMove = current.humanMoveCount === 0;
            if (wasFirstHumanMove) {
              writeFirstMoveMetrics(snapshot, writes, userId);
            }
            if (nextRecord.status !== "active") {
              const settlement = this.writeTerminalTransition(
                snapshot,
                writes,
                nextRecord,
                timestamp,
                true,
              );
              nextRecord = settlement.record;
              response = addRatingToMoveResponse(response, settlement.rating);
            }
          }
          if (response.accepted || nextRecord.rules.mode === "practice") {
            this.writeGame(snapshot, writes, nextRecord, timestamp);
          }
          const commandReceipt: SoloCommandReceipt<SoloMoveResponse> = {
            schemaVersion: SOLO_STORE_SCHEMA_VERSION,
            ownerId: userId,
            gameId: request.gameId,
            commandHash,
            fingerprint,
            response,
          };
          writeSoloReceipt(
            snapshot,
            writes,
            userId,
            receiptKey,
            serialize(commandReceipt),
            timestamp,
          );
          return commitDecision(writes, {
            status: "done" as const,
            value: response,
          });
        },
        this.casOptions,
      );
      if (result.status === "done") return result.value;
    }

    throw new SoloStoreError(
      "dynamic_conflict",
      "The solo game changed too frequently to apply the move safely.",
    );
  }

  async abandon(
    userId: string,
    request: SoloAbandonRequest,
  ): Promise<SoloAbandonResponse> {
    requireIdentifier(userId, "userId");
    requireIdentifier(request?.gameId, "gameId");
    const commandHash = hashSoloCommandId(request?.commandId);
    const fingerprint = abandonFingerprint(request);
    await this.admitWork(userId);
    const gameKey = SOLO_STORE_KEYS.game(request.gameId);
    const receiptKey = SOLO_STORE_KEYS.abandon(request.gameId, commandHash);
    const timestamp = this.now();

    for (let attempt = 0; attempt < this.maxDynamicAttempts; attempt++) {
      const discovery = await this.discoverMutation(
        userId,
        request.gameId,
        receiptKey,
        timestamp,
        false,
      );
      const result = await redisMultiCas<DynamicResult<SoloAbandonResponse>>(
        this.redis,
        discovery.watchKeys,
        (snapshot) => {
          const raw = snapshot.get(gameKey);
          if (!raw) {
            throw new SoloStoreError("game_not_found", "Solo game not found.");
          }
          const current = normalizeSoloSessionRecord(
            parseJson(raw),
            request.gameId,
          );
          assertOwner(current, userId);
          if (current.rules.mode !== discovery.mode) {
            return {
              action: "no-change" as const,
              result: { status: "retry" as const },
            };
          }
          this.assertResultConsistency(snapshot, current);
          const receipt = parseCommandReceipt<SoloAbandonResponse>(
            snapshot.get(receiptKey),
            "abandon",
          );
          if (receipt) {
            this.assertCommandReceipt(
              receipt,
              userId,
              request.gameId,
              commandHash,
            );
            return {
              action: "no-change" as const,
              result: {
                status: "done" as const,
                value:
                  receipt.fingerprint === fingerprint
                    ? asReplayed(receipt.response)
                    : abandonResultForCommandConflict(
                        request.commandId,
                        publicSoloSnapshotFromCanonicalRecord(current),
                      ),
              },
            };
          }

          const abandoned = abandonSoloSession(current, request, timestamp);
          let nextRecord = abandoned.record;
          let response = abandoned.response;
          const writes = new Map<string, RedisCasWrite>();
          if (response.abandoned) {
            const settlement = this.writeTerminalTransition(
              snapshot,
              writes,
              nextRecord,
              timestamp,
              false,
            );
            nextRecord = settlement.record;
            response = addRatingToAbandonResponse(response, settlement.rating);
          }
          if (response.abandoned || nextRecord.rules.mode === "practice") {
            this.writeGame(snapshot, writes, nextRecord, timestamp);
          }
          const commandReceipt: SoloCommandReceipt<SoloAbandonResponse> = {
            schemaVersion: SOLO_STORE_SCHEMA_VERSION,
            ownerId: userId,
            gameId: request.gameId,
            commandHash,
            fingerprint,
            response,
          };
          writeSoloReceipt(
            snapshot,
            writes,
            userId,
            receiptKey,
            serialize(commandReceipt),
            timestamp,
          );
          return commitDecision(writes, {
            status: "done" as const,
            value: response,
          });
        },
        this.casOptions,
      );
      if (result.status === "done") return result.value;
    }

    throw new SoloStoreError(
      "dynamic_conflict",
      "The solo game changed too frequently to abandon safely.",
    );
  }

  async getResult(
    userId: string,
    gameId: string,
  ): Promise<SoloCanonicalResult> {
    requireIdentifier(userId, "userId");
    requireIdentifier(gameId, "gameId");
    const result = parseCanonicalResult(
      (await this.redis.get(SOLO_STORE_KEYS.result(gameId))) ?? undefined,
      gameId,
    );
    if (!result) {
      throw new SoloStoreError("result_not_found", "Solo result not found.");
    }
    if (result.ownerId !== userId) {
      throw new SoloStoreError(
        "not_owner",
        "The caller does not own this solo result.",
      );
    }
    return result;
  }

  async getTerminalResult(
    userId: string,
    gameId: string,
  ): Promise<SoloTerminalResult> {
    const stored = await this.getResult(userId, gameId);
    if (stored.endedReason === null) {
      throw new SoloStoreError(
        "data_corrupt",
        "A stored solo result is missing its terminal reason.",
      );
    }
    const humanPlayer = stored.rules.humanPlayer;
    const aiPlayer = humanPlayer === 0 ? 1 : 0;
    const common = {
      gameId: stored.gameId,
      board: stored.snapshot.board,
      outcome: stored.outcome,
      endedReason: stored.endedReason,
      humanPlayer,
      humanScore: stored.snapshot.board.m_players[humanPlayer].m_score,
      aiScore: stored.snapshot.board.m_players[aiPlayer].m_score,
      resultForHuman: stored.resultForHuman,
      humanMoveCount: stored.snapshot.humanMoveCount,
      aiMoveCount: stored.snapshot.aiMoveCount,
      completedAt: stored.completedAt,
      ...(stored.rating ? { rating: stored.rating } : {}),
    };
    return {
      ...common,
      ...soloSessionMetadata(stored.rules),
    };
  }

  async getRankedRating(userId: string): Promise<SoloRankedRatingRecord> {
    requireIdentifier(userId, "userId");
    return parseRating(
      (await this.redis.get(SOLO_STORE_KEYS.rankedRating(userId))) ?? undefined,
    );
  }

  async countRankedPlayers(): Promise<number> {
    return parseStringList(
      (await this.redis.get(SOLO_STORE_KEYS.rankedPlayers)) ?? undefined,
      "Ranked solo players",
    ).length;
  }

  async getRankedRows(): Promise<RankingsShareRow[]> {
    const playerIds = parseStringList(
      (await this.redis.get(SOLO_STORE_KEYS.rankedPlayers)) ?? undefined,
      "Ranked solo players",
    );
    const rows = await Promise.all(
      playerIds.map(async (userId): Promise<RankingsShareRow | null> => {
        const [ratingRaw, nameRaw, avatarRaw] = await Promise.all([
          this.redis.get(SOLO_STORE_KEYS.rankedRating(userId)),
          this.redis.get(SOLO_STORE_KEYS.profileName(userId)),
          this.redis.get(SOLO_STORE_KEYS.profileAvatar(userId)),
        ]);
        const rating = parseRating(ratingRaw ?? undefined);
        const name = nameRaw?.trim() ?? "";
        if (!name || name.toLowerCase() === "anonymous") return null;
        return {
          userId,
          name,
          ...(avatarRaw ? { avatar: avatarRaw } : {}),
          rating: rating.rating,
          games: rating.games,
          wins: rating.wins,
          losses: rating.losses,
          draws: rating.draws,
        };
      }),
    );
    return rows
      .filter((row): row is RankingsShareRow => row !== null)
      .sort(
        (left, right) =>
          right.rating - left.rating ||
          right.games - left.games ||
          left.name.localeCompare(right.name),
      );
  }

  // Sharing uses a durable receipt state machine: prepared reserves one
  // immutable payload, posted is final, and failed can be prepared again.
  async prepareShare(
    userId: string,
    input: SoloSharePrepareInput,
  ): Promise<SoloPrepareShareResult> {
    requireIdentifier(userId, "userId");
    requireIdentifier(input?.gameId, "gameId");
    const commandHash = hashSoloCommandId(input?.commandId);
    requireIdentifier(input?.subredditName, "subredditName");
    requireIdentifier(input?.humanName, "humanName");
    if (input.humanAvatar !== undefined) {
      requireIdentifier(input.humanAvatar, "humanAvatar");
    }
    const resultKey = SOLO_STORE_KEYS.result(input.gameId);
    const shareKey = SOLO_STORE_KEYS.share(input.gameId);
    const cooldownKey = soloShareCooldownKey(userId);
    const candidateShareId = requireIdentifier(this.createShareId(), "shareId");
    const candidatePostKey = SOLO_STORE_KEYS.sharedPost(candidateShareId);
    const timestamp = this.now();
    const sharedAt = isoTime(timestamp);

    for (let attempt = 0; attempt < this.maxDynamicAttempts; attempt++) {
      const discoveredReceipt = parseShareReceipt(
        (await this.redis.get(shareKey)) ?? undefined,
        input.gameId,
      );
      const watchKeys = [resultKey, shareKey, candidatePostKey, cooldownKey];
      if (discoveredReceipt) {
        watchKeys.push(SOLO_STORE_KEYS.sharedPost(discoveredReceipt.shareId));
      }
      const result = await redisMultiCas<DynamicResult<SoloPrepareShareResult>>(
        this.redis,
        watchKeys,
        (snapshot) => {
          const canonicalResult = parseCanonicalResult(
            snapshot.get(resultKey),
            input.gameId,
          );
          if (!canonicalResult) {
            throw new SoloStoreError(
              "result_not_found",
              "Solo result not found.",
            );
          }
          if (canonicalResult.ownerId !== userId) {
            throw new SoloStoreError(
              "not_owner",
              "The caller does not own this solo result.",
            );
          }
          if (canonicalResult.resultForHuman !== 1) {
            throw new SoloStoreError(
              "result_not_shareable",
              "Only a completed human victory can be shared.",
            );
          }

          const existing = parseShareReceipt(
            snapshot.get(shareKey),
            input.gameId,
          );
          if (existing) {
            if (
              !watchKeys.includes(SOLO_STORE_KEYS.sharedPost(existing.shareId))
            ) {
              return {
                action: "no-change" as const,
                result: { status: "retry" as const },
              };
            }
            if (
              existing.ownerId !== userId ||
              existing.resultFingerprint !== canonicalResult.fingerprint
            ) {
              throw new SoloStoreError(
                "share_conflict",
                "The existing share receipt does not match this result.",
              );
            }
            assertStoredSharePayload(snapshot, existing);
            if (existing.status === "failed") {
              const { failedAt, failureMessage, ...base } = existing;
              const reclaimed: SoloPreparedShareReceipt = {
                ...base,
                status: "prepared",
                commandId: input.commandId,
                commandHash,
                preparedAt: sharedAt,
              };
              const writes = new Map<string, RedisCasWrite>();
              writeShareCooldown(
                snapshot,
                writes,
                cooldownKey,
                SOLO_SHARE_COOLDOWN_MS,
                timestamp,
              );
              setWrite(writes, shareKey, serialize(reclaimed));
              setWrite(writes, resultKey, serialize(canonicalResult));
              return commitDecision(writes, {
                status: "done" as const,
                value: { receipt: reclaimed, shouldSubmit: true },
              });
            }
            return {
              action: "no-change" as const,
              result: {
                status: "done" as const,
                value: { receipt: existing, shouldSubmit: false },
              },
            };
          }
          if (snapshot.get(candidatePostKey) !== undefined) {
            throw new SoloStoreError(
              "data_corrupt",
              "The generated share ID is already in use.",
            );
          }

          const payload = buildSharePayload(
            canonicalResult,
            input,
            candidateShareId,
            sharedAt,
          );
          const receipt: SoloPreparedShareReceipt = {
            schemaVersion: SOLO_STORE_SCHEMA_VERSION,
            status: "prepared",
            gameId: input.gameId,
            ownerId: userId,
            commandId: input.commandId,
            commandHash,
            resultFingerprint: canonicalResult.fingerprint,
            shareId: candidateShareId,
            payload,
            preparedAt: sharedAt,
          };
          const writes = new Map<string, RedisCasWrite>();
          writeShareCooldown(
            snapshot,
            writes,
            cooldownKey,
            SOLO_SHARE_COOLDOWN_MS,
            timestamp,
          );
          setWrite(writes, shareKey, serialize(receipt));
          setWrite(writes, candidatePostKey, serialize(payload));
          // Published payloads and their canonical source remain durable.
          setWrite(writes, resultKey, serialize(canonicalResult));
          return commitDecision(writes, {
            status: "done" as const,
            value: { receipt, shouldSubmit: true },
          });
        },
        this.casOptions,
      );
      if (result.status === "done") return result.value;
    }

    throw new SoloStoreError(
      "dynamic_conflict",
      "The solo share receipt changed too frequently to prepare safely.",
    );
  }

  async finalizeShare(
    userId: string,
    input: SoloFinalizeShareInput,
  ): Promise<SoloPostedShareReceipt> {
    requireIdentifier(userId, "userId");
    requireIdentifier(input?.gameId, "gameId");
    requireIdentifier(input?.shareId, "shareId");
    requireIdentifier(input?.postId, "postId");
    requireIdentifier(input?.permalink, "permalink");
    requireIdentifier(input?.runAs, "runAs");
    const shareKey = SOLO_STORE_KEYS.share(input.gameId);
    const sharedPostKey = SOLO_STORE_KEYS.sharedPost(input.shareId);
    const postedAt = isoTime(this.now());
    return redisMultiCas(
      this.redis,
      [shareKey, sharedPostKey],
      (snapshot) => {
        const receipt = parseShareReceipt(snapshot.get(shareKey), input.gameId);
        if (!receipt) {
          throw new SoloStoreError(
            "result_not_found",
            "The solo share has not been prepared.",
          );
        }
        if (receipt.ownerId !== userId) {
          throw new SoloStoreError(
            "not_owner",
            "The caller does not own this share.",
          );
        }
        if (receipt.shareId !== input.shareId) {
          throw new SoloStoreError(
            "share_conflict",
            "The share ID does not match the prepared receipt.",
          );
        }
        assertStoredSharePayload(snapshot, receipt);
        if (receipt.status === "posted") {
          return { action: "no-change" as const, result: receipt };
        }
        if (receipt.status === "failed") {
          throw new SoloStoreError(
            "share_conflict",
            "A failed solo share must be prepared again before it can be finalized.",
          );
        }
        const posted: SoloPostedShareReceipt = {
          ...receipt,
          status: "posted",
          postId: input.postId,
          permalink: input.permalink,
          runAs: input.runAs,
          postedAt,
        };
        return {
          action: "commit" as const,
          writes: [
            { action: "set" as const, key: shareKey, value: serialize(posted) },
          ],
          result: posted,
        };
      },
      this.casOptions,
    );
  }

  async failShare(
    userId: string,
    input: SoloFailShareInput,
  ): Promise<SoloFailedShareReceipt | SoloPostedShareReceipt> {
    requireIdentifier(userId, "userId");
    requireIdentifier(input?.gameId, "gameId");
    requireIdentifier(input?.shareId, "shareId");
    const failureMessage = requireFailureMessage(input?.failureMessage);
    const shareKey = SOLO_STORE_KEYS.share(input.gameId);
    const sharedPostKey = SOLO_STORE_KEYS.sharedPost(input.shareId);
    const failedAt = isoTime(this.now());

    return redisMultiCas(
      this.redis,
      [shareKey, sharedPostKey],
      (snapshot) => {
        const receipt = parseShareReceipt(snapshot.get(shareKey), input.gameId);
        if (!receipt) {
          throw new SoloStoreError(
            "result_not_found",
            "The solo share has not been prepared.",
          );
        }
        if (receipt.ownerId !== userId) {
          throw new SoloStoreError(
            "not_owner",
            "The caller does not own this share.",
          );
        }
        if (receipt.shareId !== input.shareId) {
          throw new SoloStoreError(
            "share_conflict",
            "The share ID does not match the prepared receipt.",
          );
        }
        assertStoredSharePayload(snapshot, receipt);
        if (receipt.status === "posted" || receipt.status === "failed") {
          return { action: "no-change" as const, result: receipt };
        }

        const failed: SoloFailedShareReceipt = {
          ...receipt,
          status: "failed",
          failureMessage,
          failedAt,
        };
        return {
          action: "commit" as const,
          writes: [
            { action: "set" as const, key: shareKey, value: serialize(failed) },
          ],
          result: failed,
        };
      },
      this.casOptions,
    );
  }

  private async admitWork(userId: string): Promise<void> {
    await reserveWindowBudget(
      this.redis,
      soloWorkBudgetKey(userId),
      SOLO_WORK_LIMITS.count,
      SOLO_WORK_LIMITS.windowMs,
      this.now(),
      this.casOptions,
    );
  }

  /** New receipts renew Practice retention so their canonical source outlives them.
   * Reads and receipt replays never renew it. Ranked and shared results are durable.
   */
  private writeGame(
    snapshot: RedisCasSnapshot,
    writes: Map<string, RedisCasWrite>,
    record: SoloSessionRecord,
    timestamp: number,
  ): void {
    const expiration =
      record.rules.mode === "practice"
        ? new Date(timestamp + SOLO_PRACTICE_RETENTION_MS)
        : undefined;
    setWrite(
      writes,
      SOLO_STORE_KEYS.game(record.gameId),
      serialize(record),
      expiration,
    );
    if (expiration && record.status !== "active") {
      const resultKey = SOLO_STORE_KEYS.result(record.gameId);
      const pending = writes.get(resultKey);
      const result =
        pending?.action === "set" ? pending.value : snapshot.get(resultKey);
      if (result !== undefined) {
        setWrite(
          writes,
          resultKey,
          result,
          snapshot.get(SOLO_STORE_KEYS.share(record.gameId)) === undefined
            ? expiration
            : undefined,
        );
      }
    }
  }

  private async discoverStart(
    userId: string,
    mode: SoloRules["mode"],
    receiptKey: string,
    candidateGameKey: string,
  ): Promise<StartDiscovery> {
    const receipt = parseStartReceipt(
      (await this.redis.get(receiptKey)) ?? undefined,
    );
    const activeKey =
      mode === "ranked" ? SOLO_STORE_KEYS.activeRanked(userId) : undefined;
    const activeGameId = activeKey
      ? await this.redis.get(activeKey)
      : undefined;
    const watchKeys = [
      receiptKey,
      candidateGameKey,
      soloReceiptBudgetKey(userId),
    ];
    if (activeKey) watchKeys.push(activeKey);
    if (receipt?.gameId) watchKeys.push(SOLO_STORE_KEYS.game(receipt.gameId));
    if (activeGameId) {
      watchKeys.push(
        SOLO_STORE_KEYS.game(activeGameId),
        SOLO_STORE_KEYS.result(activeGameId),
      );
    }
    return { watchKeys: [...new Set(watchKeys)] };
  }

  private assertStartReceipt(
    receipt: SoloStartReceipt,
    userId: string,
    commandHash: string,
    fingerprint: string,
  ): void {
    if (receipt.ownerId !== userId || receipt.commandHash !== commandHash) {
      throw new SoloStoreError(
        "data_corrupt",
        "A solo start receipt is stored under the wrong command key.",
      );
    }
    if (receipt.fingerprint !== fingerprint) {
      throw new SoloStoreError(
        "command_conflict",
        "This command ID was already used for a different solo start.",
      );
    }
  }

  private assertCommandReceipt<TResponse>(
    receipt: SoloCommandReceipt<TResponse>,
    userId: string,
    gameId: string,
    commandHash: string,
  ): void {
    if (
      receipt.ownerId !== userId ||
      receipt.gameId !== gameId ||
      receipt.commandHash !== commandHash
    ) {
      throw new SoloStoreError(
        "data_corrupt",
        "A solo command receipt is stored under the wrong command key.",
      );
    }
  }

  private async discoverMutation(
    userId: string,
    gameId: string,
    receiptKey: string,
    timestamp: number,
    includeMoveMetrics: boolean,
  ): Promise<MutationDiscovery> {
    const gameKey = SOLO_STORE_KEYS.game(gameId);
    const raw = await this.redis.get(gameKey);
    if (!raw)
      throw new SoloStoreError("game_not_found", "Solo game not found.");
    const record = normalizeSoloSessionRecord(parseJson(raw), gameId);
    assertOwner(record, userId);
    const watchKeys = [
      gameKey,
      receiptKey,
      SOLO_STORE_KEYS.result(gameId),
      SOLO_STORE_KEYS.share(gameId),
      soloReceiptBudgetKey(userId),
    ];

    if (includeMoveMetrics) {
      if (record.humanMoveCount === 0) {
        watchKeys.push(
          SOLO_STORE_KEYS.aiFirstUsers,
          SOLO_STORE_KEYS.aiFirstCount,
        );
      }
      watchKeys.push(
        SOLO_STORE_KEYS.aiCompletedUsers,
        SOLO_STORE_KEYS.aiCompletedCount,
        SOLO_STORE_KEYS.aiDifficultyCount(record.rules.difficulty),
        SOLO_STORE_KEYS.aiDailyCount(
          record.rules.difficulty,
          utcDate(timestamp),
        ),
      );
    }

    if (record.rules.mode === "ranked") {
      watchKeys.push(
        SOLO_STORE_KEYS.activeRanked(userId),
        SOLO_STORE_KEYS.rankedRating(userId),
        SOLO_STORE_KEYS.rankedPlayers,
      );
    }
    return {
      mode: record.rules.mode,
      humanMoveCount: record.humanMoveCount,
      watchKeys: [...new Set(watchKeys)],
    };
  }

  private writeTerminalTransition(
    snapshot: RedisCasSnapshot,
    writes: Map<string, RedisCasWrite>,
    source: SoloSessionRecord,
    timestamp: number,
    countCompletion: boolean,
  ): {
    record: SoloSessionRecord;
    rating: { before: number; after: number } | null;
  } {
    const resultKey = SOLO_STORE_KEYS.result(source.gameId);
    if (parseCanonicalResult(snapshot.get(resultKey), source.gameId)) {
      throw new SoloStoreError(
        "data_corrupt",
        "An active solo transition already has an immutable result.",
      );
    }

    const ratingResult = terminalRatingResult(source);
    let record = source;
    let rating: { before: number; after: number } | null = null;
    if (ratingResult !== null) {
      const ratingKey = SOLO_STORE_KEYS.rankedRating(source.ownerId);
      const current = parseRating(snapshot.get(ratingKey));
      const next = settleSoloRankedRating(current, ratingResult);
      rating = { before: current.rating, after: next.rating };
      record = withSoloRating(source, rating);
      setWrite(writes, ratingKey, serialize(next));
      setWrite(
        writes,
        SOLO_STORE_KEYS.rankedPlayers,
        serialize(
          addSetMember(
            snapshot.get(SOLO_STORE_KEYS.rankedPlayers),
            source.ownerId,
            "Ranked solo players",
          ),
        ),
      );
    }

    if (record.rules.mode === "ranked") {
      const activeKey = SOLO_STORE_KEYS.activeRanked(record.ownerId);
      if (snapshot.get(activeKey) === record.gameId) {
        deleteWrite(writes, activeKey);
      }
    }
    if (countCompletion) {
      writeCompletionMetrics(
        snapshot,
        writes,
        record.ownerId,
        record.rules.difficulty,
        utcDate(timestamp),
      );
    }
    const result = createCanonicalResult(record, rating);
    setWrite(writes, resultKey, serialize(result));
    return { record, rating };
  }

  private assertResultConsistency(
    snapshot: RedisCasSnapshot,
    record: SoloSessionRecord,
  ): void {
    const result = parseCanonicalResult(
      snapshot.get(SOLO_STORE_KEYS.result(record.gameId)),
      record.gameId,
    );
    if (record.status === "active") {
      if (result) {
        throw new SoloStoreError(
          "data_corrupt",
          "An active solo game already has an immutable result.",
        );
      }
      return;
    }
    if (
      !result ||
      result.ownerId !== record.ownerId ||
      result.revision !== record.revision
    ) {
      throw new SoloStoreError(
        "data_corrupt",
        "A terminal solo game is missing its matching immutable result.",
      );
    }
  }
}
