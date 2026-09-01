import { randomUUID } from "node:crypto";

import type {
  H2HLeaveRequest,
  H2HMoveRequest,
  ShareChatItem,
} from "../shared/types/api";
import {
  appendH2HChat,
  applyH2HMove,
  createH2HCanonicalState,
  createH2HRematch,
  createInitialH2HBoard,
  endH2HByDeparture,
  H2HDomainError,
  type H2HCanonicalStateSnapshot,
  type H2HMoveAcceptedResponse,
} from "./h2h";
import {
  commitRedisCasWrites as decision,
  deleteRedisCasWrite as deleteWrite,
  redisCas,
  redisMultiCas,
  setRedisCasWrite as setWrite,
  type RedisCasClient,
  type RedisCasOptions,
  type RedisCasSnapshot,
  type RedisCasWrite,
  type RedisMultiCasDecision,
} from "./redis-cas";

export const H2H_STORE_KEYS = Object.freeze({
  queue: "euclid:queue_json",
  activeGames: "euclid:active_games",
  pendingSettlements: "euclid:h2h:settlement:pending",
  game: (gameId: string) => `euclid:game:${gameId}`,
  userGame: (userId: string) => `euclid:user:${userId}:game`,
  chatLast: (userId: string) => `euclid:chat:last:${userId}`,
});

export const H2H_CHAT_RATE_LIMIT_MS = 1_000;
export const H2H_SETTLEMENT_EVENT_VERSION = 1;

const DEFAULT_MAX_IDLE_MS = 10 * 60 * 1000;
const DEFAULT_DYNAMIC_ATTEMPTS = 8;

export type H2HStoreOptions = {
  now?: () => number;
  createGameId?: () => string;
  maxIdleMs?: number;
  maxDynamicAttempts?: number;
  cas?: RedisCasOptions;
};

export type H2HStoreErrorCode =
  | "invalid_identifier"
  | "not_mapped"
  | "game_not_found"
  | "mapping_conflict"
  | "game_live"
  | "chat_rate_limited"
  | "dynamic_conflict";

export class H2HStoreError extends Error {
  override readonly name = "H2HStoreError";

  constructor(
    readonly code: H2HStoreErrorCode,
    message: string,
    readonly retryAfterMs: number | undefined = undefined,
  ) {
    super(message);
  }
}

export type H2HCreatedPair = {
  gameId: string;
  playerIds: [string, string];
  state: H2HCanonicalStateSnapshot;
};

export type H2HQueueResult =
  | {
      status: "resumed";
      gameId: string;
      isPlayer1: boolean;
      state: H2HCanonicalStateSnapshot;
    }
  | {
      status: "paired";
      gameId: string;
      isPlayer1: boolean;
      state: H2HCanonicalStateSnapshot;
      createdPair: H2HCreatedPair;
    }
  | {
      status: "queued";
      createdPair?: H2HCreatedPair;
    };

export type H2HMappingRead = {
  gameId: string;
  state: H2HCanonicalStateSnapshot | null;
  isPlayer1: boolean | null;
};

export type H2HMoveCommit = {
  response: H2HMoveAcceptedResponse;
  settlementEvent: H2HSettlementEvent | null;
};

export type H2HLeaveCommit = {
  gameId: string | null;
  state: H2HCanonicalStateSnapshot | null;
  causedForfeitTransition: boolean;
  settlementEvent: H2HSettlementEvent | null;
};

export type H2HSettlementEndReason = "game_over" | "tie" | "player_left";

/**
 * Durable, server-authored terminal result. The game revision makes the ID
 * unique across rematches, which intentionally reuse the same game ID.
 */
export type H2HSettlementEvent = {
  version: typeof H2H_SETTLEMENT_EVENT_VERSION;
  eventId: string;
  gameId: string;
  revision: number;
  playerIds: [string, string];
  resultForFirst: 0 | 0.5 | 1;
  endedReason: H2HSettlementEndReason;
  endedBy: string | null;
  endedAt: number;
};

export class H2HSettlementDataError extends Error {
  override readonly name = "H2HSettlementDataError";
}

export type H2HChatCommit = {
  item: ShareChatItem;
  state: H2HCanonicalStateSnapshot;
};

export type H2HLiveGame = {
  gameId: string;
  names: Record<string, string>;
  scores: [number, number];
  lastSaved: number;
  revision: number;
};

export type H2HCleanupResult = {
  gameId: string;
  deletedGame: boolean;
  removedFromActive: boolean;
  deletedMappings: string[];
};

type QueueAttemptResult =
  | { status: "retry" }
  | { status: "done"; value: H2HQueueResult };

type DynamicAttemptResult<TResult> =
  | { status: "retry" }
  | { status: "done"; value: TResult };

type QueueDiscovery = {
  watchKeys: string[];
  proposedGameId: string;
  watchedMappingKeys: Set<string>;
  watchedGameKeys: Set<string>;
};

function requireIdentifier(value: string, field: string): void {
  if (!value || !value.trim()) {
    throw new H2HStoreError(
      "invalid_identifier",
      `${field} must be a non-empty string.`,
    );
  }
}

function requireRevision(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new H2HDomainError(
      "invalid_request",
      "expectedRevision must be a non-negative safe integer.",
    );
  }
}

function parseTimestamp(raw: string | undefined): number | null {
  if (raw === undefined || raw.trim() === "") return null;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function monotonicTimestamp(
  candidate: number,
  floor: number | undefined,
): number {
  // Preserve invalid candidates so the domain remains the validation authority.
  if (
    !Number.isSafeInteger(candidate) ||
    candidate < 0 ||
    floor === undefined
  ) {
    return candidate;
  }
  return Math.max(candidate, floor);
}

function parseStringList(raw: string | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) &&
      parsed.every((value) => typeof value === "string")
      ? parsed
      : [];
  } catch {
    return [];
  }
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values.filter((value) => value.length > 0))];
}

function serializeList(values: readonly string[]): string {
  return JSON.stringify(uniqueStrings(values));
}

function parseJson(raw: string | undefined): unknown {
  if (!raw) return undefined;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireSettlementInteger(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new H2HSettlementDataError(
      `${field} must be a non-negative safe integer.`,
    );
  }
  return value;
}

function requireSettlementIdentifier(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new H2HSettlementDataError(`${field} must be a non-empty string.`);
  }
  return value;
}

export function h2hSettlementEventId(gameId: string, revision: number): string {
  return `${gameId}:${revision}`;
}

export function normalizeH2HSettlementEvent(
  value: unknown,
): H2HSettlementEvent {
  if (!isRecord(value)) {
    throw new H2HSettlementDataError("A pending settlement must be an object.");
  }
  if (value.version !== H2H_SETTLEMENT_EVENT_VERSION) {
    throw new H2HSettlementDataError(
      "A pending settlement has an unsupported version.",
    );
  }

  const gameId = requireSettlementIdentifier(value.gameId, "gameId");
  const revision = requireSettlementInteger(value.revision, "revision");
  const eventId = requireSettlementIdentifier(value.eventId, "eventId");
  if (eventId !== h2hSettlementEventId(gameId, revision)) {
    throw new H2HSettlementDataError(
      "A pending settlement ID does not match its game revision.",
    );
  }

  if (
    !Array.isArray(value.playerIds) ||
    value.playerIds.length !== 2 ||
    value.playerIds.some(
      (playerId) => typeof playerId !== "string" || !playerId.trim(),
    )
  ) {
    throw new H2HSettlementDataError(
      "A pending settlement must identify exactly two players.",
    );
  }
  const playerIds: [string, string] = [value.playerIds[0], value.playerIds[1]];
  if (playerIds[0] === playerIds[1]) {
    throw new H2HSettlementDataError(
      "A pending settlement must identify two different players.",
    );
  }

  const endedReason = value.endedReason;
  if (
    endedReason !== "game_over" &&
    endedReason !== "tie" &&
    endedReason !== "player_left"
  ) {
    throw new H2HSettlementDataError(
      "A pending settlement has an invalid end reason.",
    );
  }
  const resultForFirst = value.resultForFirst;
  if (resultForFirst !== 0 && resultForFirst !== 0.5 && resultForFirst !== 1) {
    throw new H2HSettlementDataError(
      "A pending settlement has an invalid result.",
    );
  }
  const endedBy = value.endedBy;
  if (endedBy !== null && typeof endedBy !== "string") {
    throw new H2HSettlementDataError(
      "A pending settlement has an invalid departure identity.",
    );
  }
  if (endedReason === "tie") {
    if (resultForFirst !== 0.5 || endedBy !== null) {
      throw new H2HSettlementDataError(
        "A tied settlement must contain a draw and no departing player.",
      );
    }
  } else if (endedReason === "game_over") {
    if (resultForFirst === 0.5 || endedBy !== null) {
      throw new H2HSettlementDataError(
        "A scored settlement must contain one winner and no departure.",
      );
    }
  } else {
    const departedIndex = playerIds.indexOf(endedBy ?? "");
    if (
      departedIndex < 0 ||
      (departedIndex === 0 && resultForFirst !== 0) ||
      (departedIndex === 1 && resultForFirst !== 1)
    ) {
      throw new H2HSettlementDataError(
        "A forfeit settlement result must identify the departing player.",
      );
    }
  }

  return {
    version: H2H_SETTLEMENT_EVENT_VERSION,
    eventId,
    gameId,
    revision,
    playerIds,
    resultForFirst,
    endedReason,
    endedBy,
    endedAt: requireSettlementInteger(value.endedAt, "endedAt"),
  };
}

export function h2hSettlementFingerprint(event: H2HSettlementEvent): string {
  const normalized = normalizeH2HSettlementEvent(event);
  return JSON.stringify(normalized);
}

export function parseH2HSettlementEvents(
  raw: string | null | undefined,
): H2HSettlementEvent[] {
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    throw new H2HSettlementDataError(
      "The pending settlement outbox is not valid JSON.",
    );
  }
  if (!Array.isArray(parsed)) {
    throw new H2HSettlementDataError(
      "The pending settlement outbox must be an array.",
    );
  }

  const events = parsed.map(normalizeH2HSettlementEvent);
  const seen = new Set<string>();
  for (const event of events) {
    if (seen.has(event.eventId)) {
      throw new H2HSettlementDataError(
        `The pending settlement outbox contains duplicate event ${JSON.stringify(event.eventId)}.`,
      );
    }
    seen.add(event.eventId);
  }
  return events;
}

export function serializeH2HSettlementEvents(
  events: readonly H2HSettlementEvent[],
): string {
  const normalized = events.map(normalizeH2HSettlementEvent);
  const seen = new Set<string>();
  for (const event of normalized) {
    if (seen.has(event.eventId)) {
      throw new H2HSettlementDataError(
        `Cannot serialize duplicate settlement event ${JSON.stringify(event.eventId)}.`,
      );
    }
    seen.add(event.eventId);
  }
  return JSON.stringify(normalized);
}

export function createH2HSettlementEvent(
  state: H2HCanonicalStateSnapshot,
): H2HSettlementEvent {
  if (!state.ended || !state.endedReason) {
    throw new H2HSettlementDataError(
      "Only a canonical terminal state can create a settlement event.",
    );
  }
  const endedReason = state.endedReason;
  if (
    endedReason !== "game_over" &&
    endedReason !== "tie" &&
    endedReason !== "player_left"
  ) {
    throw new H2HSettlementDataError(
      "The canonical terminal state has an unsupported end reason.",
    );
  }
  const resultForFirst: 0 | 0.5 | 1 | null =
    endedReason === "tie"
      ? 0.5
      : state.victorSide === 1
        ? 1
        : state.victorSide === 2
          ? 0
          : null;
  if (resultForFirst === null) {
    throw new H2HSettlementDataError(
      "The canonical terminal state does not identify a result.",
    );
  }
  const endedAt = state.board.lastSaved;
  if (endedAt === undefined) {
    throw new H2HSettlementDataError(
      "A terminal state must have a persisted completion timestamp.",
    );
  }

  return normalizeH2HSettlementEvent({
    version: H2H_SETTLEMENT_EVENT_VERSION,
    eventId: h2hSettlementEventId(state.gameId, state.revision),
    gameId: state.gameId,
    revision: state.revision,
    playerIds: [
      state.board.m_players[0].userId,
      state.board.m_players[1].userId,
    ],
    resultForFirst,
    endedReason,
    endedBy: state.endedBy,
    endedAt,
  });
}

function appendSettlementEvent(
  raw: string | undefined,
  event: H2HSettlementEvent,
): string | null {
  const events = parseH2HSettlementEvents(raw);
  const existing = events.find(
    (candidate) => candidate.eventId === event.eventId,
  );
  if (existing) {
    if (
      h2hSettlementFingerprint(existing) !== h2hSettlementFingerprint(event)
    ) {
      throw new H2HSettlementDataError(
        `Settlement event ${JSON.stringify(event.eventId)} has conflicting terminal data.`,
      );
    }
    return null;
  }
  return serializeH2HSettlementEvents([...events, event]);
}

function playerIdsFromRaw(raw: string | undefined): string[] {
  const parsed = parseJson(raw);
  if (!parsed || typeof parsed !== "object" || !("m_players" in parsed)) {
    return [];
  }
  const players = (parsed as { m_players?: unknown }).m_players;
  if (!Array.isArray(players)) return [];
  return uniqueStrings(
    players.map((player) =>
      player && typeof player === "object" && "userId" in player
        ? String((player as { userId?: unknown }).userId ?? "")
        : "",
    ),
  );
}

function stateFromRaw(
  gameId: string,
  raw: string | undefined,
): H2HCanonicalStateSnapshot | null {
  const parsed = parseJson(raw);
  return parsed === undefined ? null : createH2HCanonicalState(gameId, parsed);
}

function isStale(
  state: H2HCanonicalStateSnapshot,
  now: number,
  maxIdleMs: number,
): boolean {
  const timestamp = state.board.lastSaved ?? state.board.createdAt;
  return timestamp !== undefined && now - timestamp > maxIdleMs;
}

function sameList(left: readonly string[], right: readonly string[]): boolean {
  return serializeList(left) === serializeList(right);
}

function removeActiveGame(
  active: string[],
  gameId: string,
): { next: string[]; removed: boolean } {
  const next = active.filter((candidate) => candidate !== gameId);
  return { next, removed: next.length !== active.length };
}

function addActiveGame(active: string[], gameId: string): string[] {
  return [gameId, ...active.filter((candidate) => candidate !== gameId)];
}

/**
 * Redis-backed H2H persistence. Every mutation is a watched transaction; the
 * only ordinary Redis reads are discovery and read-only endpoint operations.
 */
export class H2HStore {
  private readonly now: () => number;
  private readonly createGameId: () => string;
  private readonly maxIdleMs: number;
  private readonly maxDynamicAttempts: number;
  private readonly casOptions: RedisCasOptions;

  constructor(
    private readonly redis: RedisCasClient,
    options: H2HStoreOptions = {},
  ) {
    this.now = options.now ?? Date.now;
    this.createGameId = options.createGameId ?? randomUUID;
    this.maxIdleMs = options.maxIdleMs ?? DEFAULT_MAX_IDLE_MS;
    this.maxDynamicAttempts =
      options.maxDynamicAttempts ?? DEFAULT_DYNAMIC_ATTEMPTS;
    this.casOptions = options.cas ?? {};

    if (!Number.isSafeInteger(this.maxIdleMs) || this.maxIdleMs < 1) {
      throw new RangeError("maxIdleMs must be a positive safe integer.");
    }
    if (
      !Number.isSafeInteger(this.maxDynamicAttempts) ||
      this.maxDynamicAttempts < 1
    ) {
      throw new RangeError(
        "maxDynamicAttempts must be a positive safe integer.",
      );
    }
  }

  async queueOrResume(userId: string): Promise<H2HQueueResult> {
    requireIdentifier(userId, "userId");

    for (let attempt = 0; attempt < this.maxDynamicAttempts; attempt++) {
      const now = this.now();
      const discovery = await this.discoverQueueKeys(userId);
      const result = await redisMultiCas(
        this.redis,
        discovery.watchKeys,
        (snapshot) => this.decideQueue(snapshot, discovery, userId, now),
        this.casOptions,
      );
      if (result.status === "done") return result.value;
    }

    throw new H2HStoreError(
      "dynamic_conflict",
      "The matchmaking queue changed too frequently to pair safely.",
    );
  }

  async getMapping(userId: string): Promise<H2HMappingRead | null> {
    requireIdentifier(userId, "userId");
    const gameId = await this.redis.get(H2H_STORE_KEYS.userGame(userId));
    if (!gameId) return null;

    const state = await this.getState(gameId);
    if (!state) return { gameId, state: null, isPlayer1: null };
    const firstId = state.board.m_players[0].userId;
    const secondId = state.board.m_players[1].userId;
    return {
      gameId,
      state,
      isPlayer1: userId === firstId ? true : userId === secondId ? false : null,
    };
  }

  async getState(gameId: string): Promise<H2HCanonicalStateSnapshot | null> {
    requireIdentifier(gameId, "gameId");
    const raw = await this.redis.get(H2H_STORE_KEYS.game(gameId));
    return stateFromRaw(gameId, raw ?? undefined);
  }

  async cancelQueue(userId: string): Promise<{ removed: boolean }> {
    requireIdentifier(userId, "userId");
    const removed = await redisCas(
      this.redis,
      H2H_STORE_KEYS.queue,
      (raw) => {
        const queue = uniqueStrings(parseStringList(raw));
        const next = queue.filter((candidate) => candidate !== userId);
        return sameList(queue, next)
          ? { action: "no-change", result: false }
          : { action: "set", value: serializeList(next), result: true };
      },
      this.casOptions,
    );
    return { removed };
  }

  async deleteMappingIfEqual(userId: string, gameId: string): Promise<boolean> {
    requireIdentifier(userId, "userId");
    requireIdentifier(gameId, "gameId");
    return redisCas(
      this.redis,
      H2H_STORE_KEYS.userGame(userId),
      (current) =>
        current === gameId
          ? { action: "delete", result: true }
          : { action: "no-change", result: false },
      this.casOptions,
    );
  }

  async applyMove(
    userId: string,
    request: H2HMoveRequest,
  ): Promise<H2HMoveCommit> {
    requireIdentifier(userId, "userId");
    requireIdentifier(request.gameId, "gameId");
    const gameKey = H2H_STORE_KEYS.game(request.gameId);
    const mappingKey = H2H_STORE_KEYS.userGame(userId);
    const now = this.now();

    return redisMultiCas(
      this.redis,
      [
        gameKey,
        mappingKey,
        H2H_STORE_KEYS.activeGames,
        H2H_STORE_KEYS.pendingSettlements,
      ],
      (snapshot) => {
        if (snapshot.get(mappingKey) !== request.gameId) {
          throw new H2HStoreError(
            "not_mapped",
            "The caller is not mapped to this game.",
          );
        }
        const raw = snapshot.get(gameKey);
        if (!raw) {
          throw new H2HStoreError("game_not_found", "Game not found.");
        }

        const response = applyH2HMove(parseJson(raw), userId, request, now);
        const active = uniqueStrings(
          parseStringList(snapshot.get(H2H_STORE_KEYS.activeGames)),
        );
        const writes = new Map<string, RedisCasWrite>();
        setWrite(writes, gameKey, JSON.stringify(response.board));
        const settlementEvent = response.ended
          ? createH2HSettlementEvent(response)
          : null;

        if (settlementEvent) {
          const removed = removeActiveGame(active, request.gameId);
          if (removed.removed) {
            setWrite(
              writes,
              H2H_STORE_KEYS.activeGames,
              serializeList(removed.next),
            );
          }
          const nextOutbox = appendSettlementEvent(
            snapshot.get(H2H_STORE_KEYS.pendingSettlements),
            settlementEvent,
          );
          if (nextOutbox !== null) {
            setWrite(writes, H2H_STORE_KEYS.pendingSettlements, nextOutbox);
          }
        }

        return decision(writes, {
          response,
          settlementEvent,
        });
      },
      this.casOptions,
    );
  }

  async leave(
    userId: string,
    request: H2HLeaveRequest,
  ): Promise<H2HLeaveCommit> {
    requireIdentifier(userId, "userId");
    requireIdentifier(request.gameId, "gameId");
    requireRevision(request.expectedRevision);

    const mappingKey = H2H_STORE_KEYS.userGame(userId);
    const gameKey = H2H_STORE_KEYS.game(request.gameId);
    const now = this.now();

    return redisMultiCas<H2HLeaveCommit>(
      this.redis,
      [
        mappingKey,
        gameKey,
        H2H_STORE_KEYS.activeGames,
        H2H_STORE_KEYS.pendingSettlements,
      ],
      (snapshot) => {
        const currentGameId = snapshot.get(mappingKey);
        if (currentGameId === undefined) {
          return {
            action: "no-change",
            result: {
              gameId: null,
              state: null,
              causedForfeitTransition: false,
              settlementEvent: null,
            },
          };
        }
        if (currentGameId !== request.gameId) {
          throw new H2HStoreError(
            "mapping_conflict",
            "The caller is mapped to a different game.",
          );
        }

        const writes = new Map<string, RedisCasWrite>();
        const raw = snapshot.get(gameKey);
        const state = stateFromRaw(request.gameId, raw);
        if (!state) {
          deleteWrite(writes, mappingKey);
          return decision(writes, {
            gameId: request.gameId,
            state: null,
            causedForfeitTransition: false,
            settlementEvent: null,
          });
        }
        if (state.revision !== request.expectedRevision) {
          throw new H2HDomainError(
            "stale_revision",
            `Expected revision ${request.expectedRevision}, but the canonical revision is ${state.revision}.`,
            state,
          );
        }

        const participant = state.board.m_players.some(
          (player) => player.userId === userId,
        );
        if (!participant) {
          deleteWrite(writes, mappingKey);
          return decision(writes, {
            gameId: request.gameId,
            state,
            causedForfeitTransition: false,
            settlementEvent: null,
          });
        }

        deleteWrite(writes, mappingKey);
        if (state.ended) {
          return decision(writes, {
            gameId: request.gameId,
            state,
            causedForfeitTransition: false,
            settlementEvent: null,
          });
        }

        const endedState = endH2HByDeparture(
          state.board,
          userId,
          request.gameId,
          now,
        );
        setWrite(writes, gameKey, JSON.stringify(endedState.board));
        const active = uniqueStrings(
          parseStringList(snapshot.get(H2H_STORE_KEYS.activeGames)),
        );
        const removed = removeActiveGame(active, request.gameId);
        if (removed.removed) {
          setWrite(
            writes,
            H2H_STORE_KEYS.activeGames,
            serializeList(removed.next),
          );
        }
        const settlementEvent = createH2HSettlementEvent(endedState);
        const nextOutbox = appendSettlementEvent(
          snapshot.get(H2H_STORE_KEYS.pendingSettlements),
          settlementEvent,
        );
        if (nextOutbox !== null) {
          setWrite(writes, H2H_STORE_KEYS.pendingSettlements, nextOutbox);
        }
        return decision(writes, {
          gameId: request.gameId,
          state: endedState,
          causedForfeitTransition: true,
          settlementEvent,
        });
      },
      this.casOptions,
    );
  }

  async rematch(
    userId: string,
    gameId: string,
  ): Promise<H2HCanonicalStateSnapshot> {
    requireIdentifier(userId, "userId");
    requireIdentifier(gameId, "gameId");

    for (let attempt = 0; attempt < this.maxDynamicAttempts; attempt++) {
      const gameKey = H2H_STORE_KEYS.game(gameId);
      const discoveredRaw = await this.redis.get(gameKey);
      if (!discoveredRaw) {
        throw new H2HStoreError("game_not_found", "Game not found.");
      }
      const discoveredPlayers = playerIdsFromRaw(discoveredRaw);
      if (discoveredPlayers.length !== 2) {
        createH2HCanonicalState(gameId, parseJson(discoveredRaw));
      }
      const mappingKeys = discoveredPlayers.map(H2H_STORE_KEYS.userGame);
      const now = this.now();
      const result = await redisMultiCas(
        this.redis,
        [gameKey, H2H_STORE_KEYS.activeGames, ...mappingKeys],
        (
          snapshot,
        ): RedisMultiCasDecision<
          DynamicAttemptResult<H2HCanonicalStateSnapshot>
        > => {
          const raw = snapshot.get(gameKey);
          if (!raw) {
            throw new H2HStoreError("game_not_found", "Game not found.");
          }
          const actualPlayers = playerIdsFromRaw(raw);
          if (
            actualPlayers.length !== 2 ||
            actualPlayers.some(
              (playerId) =>
                !mappingKeys.includes(H2H_STORE_KEYS.userGame(playerId)),
            )
          ) {
            return {
              action: "no-change" as const,
              result: { status: "retry" as const },
            };
          }
          const state = stateFromRaw(gameId, raw);
          if (!state) {
            throw new H2HStoreError("game_not_found", "Game not found.");
          }
          if (!state.ended) {
            throw new H2HStoreError(
              "game_live",
              "A live game cannot be rematched.",
            );
          }
          if (!actualPlayers.includes(userId)) {
            throw new H2HDomainError(
              "not_participant",
              "The caller is not a participant.",
            );
          }
          for (const playerId of actualPlayers) {
            const mapped = snapshot.get(H2H_STORE_KEYS.userGame(playerId));
            if (mapped && mapped !== gameId) {
              throw new H2HStoreError(
                "mapping_conflict",
                "A rematch participant is already in another game.",
              );
            }
          }

          const rematchState = createH2HRematch(
            state.board,
            userId,
            gameId,
            now,
          );
          const writes = new Map<string, RedisCasWrite>();
          setWrite(writes, gameKey, JSON.stringify(rematchState.board));
          for (const playerId of actualPlayers) {
            setWrite(writes, H2H_STORE_KEYS.userGame(playerId), gameId);
          }
          const active = uniqueStrings(
            parseStringList(snapshot.get(H2H_STORE_KEYS.activeGames)),
          );
          setWrite(
            writes,
            H2H_STORE_KEYS.activeGames,
            serializeList(addActiveGame(active, gameId)),
          );
          return decision(writes, {
            status: "done" as const,
            value: rematchState,
          });
        },
        this.casOptions,
      );
      if (result.status === "done") return result.value;
    }

    throw new H2HStoreError(
      "dynamic_conflict",
      "The game participants changed too frequently to rematch safely.",
    );
  }

  async appendChat(
    userId: string,
    gameId: string,
    text: string,
  ): Promise<H2HChatCommit> {
    requireIdentifier(userId, "userId");
    requireIdentifier(gameId, "gameId");
    const gameKey = H2H_STORE_KEYS.game(gameId);
    const mappingKey = H2H_STORE_KEYS.userGame(userId);
    const rateKey = H2H_STORE_KEYS.chatLast(userId);
    const now = this.now();

    return redisMultiCas(
      this.redis,
      [gameKey, mappingKey, rateKey],
      (snapshot) => {
        const mappedGameId = snapshot.get(mappingKey);
        if (mappedGameId === undefined) {
          throw new H2HStoreError(
            "not_mapped",
            "The caller is not mapped to a game.",
          );
        }
        if (mappedGameId !== gameId) {
          throw new H2HStoreError(
            "mapping_conflict",
            "The caller is mapped to a different game.",
          );
        }

        const raw = snapshot.get(gameKey);
        if (!raw) {
          throw new H2HStoreError("game_not_found", "Game not found.");
        }
        const lastChatAt = parseTimestamp(snapshot.get(rateKey));
        if (lastChatAt !== null) {
          const elapsed = Math.max(0, now - lastChatAt);
          if (elapsed < H2H_CHAT_RATE_LIMIT_MS) {
            throw new H2HStoreError(
              "chat_rate_limited",
              "Chat messages must be at least one second apart.",
              H2H_CHAT_RATE_LIMIT_MS - elapsed,
            );
          }
        }

        const state = createH2HCanonicalState(gameId, parseJson(raw));
        const effectiveTimestamp = monotonicTimestamp(
          now,
          state.board.lastSaved ?? state.board.createdAt,
        );
        const result = appendH2HChat(
          state.board,
          userId,
          gameId,
          text,
          effectiveTimestamp,
        );
        return {
          action: "commit",
          writes: [
            {
              action: "set",
              key: gameKey,
              value: JSON.stringify(result.state.board),
            },
            {
              action: "set",
              key: rateKey,
              value: String(effectiveTimestamp),
            },
          ],
          result,
        };
      },
      this.casOptions,
    );
  }

  async cleanupStaleGame(gameId: string): Promise<H2HCleanupResult> {
    requireIdentifier(gameId, "gameId");

    for (let attempt = 0; attempt < this.maxDynamicAttempts; attempt++) {
      const gameKey = H2H_STORE_KEYS.game(gameId);
      const discoveredRaw = await this.redis.get(gameKey);
      const playerIds = playerIdsFromRaw(discoveredRaw ?? undefined);
      const mappingKeys = playerIds.map(H2H_STORE_KEYS.userGame);
      const now = this.now();
      const result = await redisMultiCas(
        this.redis,
        [gameKey, H2H_STORE_KEYS.activeGames, ...mappingKeys],
        (
          snapshot,
        ): RedisMultiCasDecision<DynamicAttemptResult<H2HCleanupResult>> => {
          const raw = snapshot.get(gameKey);
          const actualPlayers = playerIdsFromRaw(raw);
          if (
            actualPlayers.length !== playerIds.length ||
            actualPlayers.some(
              (playerId) =>
                !mappingKeys.includes(H2H_STORE_KEYS.userGame(playerId)),
            )
          ) {
            return {
              action: "no-change" as const,
              result: { status: "retry" as const },
            };
          }

          const active = uniqueStrings(
            parseStringList(snapshot.get(H2H_STORE_KEYS.activeGames)),
          );
          const removed = removeActiveGame(active, gameId);
          const writes = new Map<string, RedisCasWrite>();
          if (!raw) {
            if (removed.removed) {
              setWrite(
                writes,
                H2H_STORE_KEYS.activeGames,
                serializeList(removed.next),
              );
            }
            return decision(writes, {
              status: "done" as const,
              value: {
                gameId,
                deletedGame: false,
                removedFromActive: removed.removed,
                deletedMappings: [],
              },
            });
          }

          let state: H2HCanonicalStateSnapshot | null = null;
          try {
            state = stateFromRaw(gameId, raw);
          } catch (error) {
            if (!(error instanceof H2HDomainError)) throw error;
          }
          const stale = state ? isStale(state, now, this.maxIdleMs) : true;
          if (state && !state.ended && !stale) {
            return {
              action: "no-change" as const,
              result: {
                status: "done" as const,
                value: {
                  gameId,
                  deletedGame: false,
                  removedFromActive: false,
                  deletedMappings: [],
                },
              },
            };
          }

          if (state?.ended) {
            if (removed.removed) {
              setWrite(
                writes,
                H2H_STORE_KEYS.activeGames,
                serializeList(removed.next),
              );
            }
            return decision(writes, {
              status: "done" as const,
              value: {
                gameId,
                deletedGame: false,
                removedFromActive: removed.removed,
                deletedMappings: [],
              },
            });
          }

          deleteWrite(writes, gameKey);
          if (removed.removed) {
            setWrite(
              writes,
              H2H_STORE_KEYS.activeGames,
              serializeList(removed.next),
            );
          }
          const deletedMappings: string[] = [];
          for (const playerId of actualPlayers) {
            const mappingKey = H2H_STORE_KEYS.userGame(playerId);
            if (snapshot.get(mappingKey) === gameId) {
              deleteWrite(writes, mappingKey);
              deletedMappings.push(playerId);
            }
          }
          return decision(writes, {
            status: "done" as const,
            value: {
              gameId,
              deletedGame: true,
              removedFromActive: removed.removed,
              deletedMappings,
            },
          });
        },
        this.casOptions,
      );
      if (result.status === "done") return result.value;
    }

    throw new H2HStoreError(
      "dynamic_conflict",
      "The game participants changed too frequently to clean up safely.",
    );
  }

  async listLiveGames(): Promise<H2HLiveGame[]> {
    const active = uniqueStrings(
      parseStringList(
        (await this.redis.get(H2H_STORE_KEYS.activeGames)) ?? undefined,
      ),
    );
    const live: H2HLiveGame[] = [];

    for (const gameId of active) {
      let state: H2HCanonicalStateSnapshot | null = null;
      try {
        state = await this.getState(gameId);
      } catch (error) {
        if (!(error instanceof H2HDomainError)) throw error;
      }
      if (!state || state.ended || isStale(state, this.now(), this.maxIdleMs)) {
        await this.cleanupStaleGame(gameId);
        continue;
      }

      live.push({
        gameId,
        names: { ...(state.board.playerNames ?? {}) },
        scores: [
          state.board.m_players[0].m_score,
          state.board.m_players[1].m_score,
        ],
        lastSaved: state.board.lastSaved ?? 0,
        revision: state.revision,
      });
    }

    return live.sort((left, right) => right.lastSaved - left.lastSaved);
  }

  // Queue membership can reveal game and mapping keys dynamically. Discover that
  // graph first so the following CAS watches every key that may affect pairing.
  private async discoverQueueKeys(userId: string): Promise<QueueDiscovery> {
    const queue = uniqueStrings(
      parseStringList(
        (await this.redis.get(H2H_STORE_KEYS.queue)) ?? undefined,
      ),
    );
    const userIds = uniqueStrings([...queue, userId]);
    const mappingKeys = userIds.map(H2H_STORE_KEYS.userGame);
    const mappings = await Promise.all(
      mappingKeys.map(async (key) => (await this.redis.get(key)) ?? undefined),
    );
    const callerMapping = mappings[userIds.indexOf(userId)];
    const watchedGameKeys = new Set<string>();
    const watchedMappingKeys = new Set(mappingKeys);

    if (callerMapping) {
      const gameKey = H2H_STORE_KEYS.game(callerMapping);
      watchedGameKeys.add(gameKey);
      const raw = (await this.redis.get(gameKey)) ?? undefined;
      for (const participantId of playerIdsFromRaw(raw)) {
        watchedMappingKeys.add(H2H_STORE_KEYS.userGame(participantId));
      }
    }

    const proposedGameId = this.createGameId();
    requireIdentifier(proposedGameId, "generated gameId");
    watchedGameKeys.add(H2H_STORE_KEYS.game(proposedGameId));
    return {
      proposedGameId,
      watchedMappingKeys,
      watchedGameKeys,
      watchKeys: uniqueStrings([
        H2H_STORE_KEYS.queue,
        H2H_STORE_KEYS.activeGames,
        ...watchedMappingKeys,
        ...watchedGameKeys,
      ]),
    };
  }

  // A retry is deliberately write-free: it asks queueOrResume to rediscover
  // after the snapshot exposes a relationship outside the current watch set.
  private decideQueue(
    snapshot: RedisCasSnapshot,
    discovery: QueueDiscovery,
    userId: string,
    now: number,
  ): RedisMultiCasDecision<QueueAttemptResult> {
    const queue = uniqueStrings(
      parseStringList(snapshot.get(H2H_STORE_KEYS.queue)),
    );
    if (
      queue.some(
        (candidate) =>
          !discovery.watchedMappingKeys.has(H2H_STORE_KEYS.userGame(candidate)),
      )
    ) {
      return { action: "no-change", result: { status: "retry" } };
    }

    const callerMappingKey = H2H_STORE_KEYS.userGame(userId);
    const callerGameId = snapshot.get(callerMappingKey);
    if (
      callerGameId &&
      !discovery.watchedGameKeys.has(H2H_STORE_KEYS.game(callerGameId))
    ) {
      return { action: "no-change", result: { status: "retry" } };
    }

    const writes = new Map<string, RedisCasWrite>();
    let active = uniqueStrings(
      parseStringList(snapshot.get(H2H_STORE_KEYS.activeGames)),
    );
    let callerEligible = !callerGameId;
    let resumedState: H2HCanonicalStateSnapshot | null = null;

    if (callerGameId) {
      const gameKey = H2H_STORE_KEYS.game(callerGameId);
      const raw = snapshot.get(gameKey);
      const participantIds = playerIdsFromRaw(raw);
      if (
        participantIds.some(
          (participantId) =>
            !discovery.watchedMappingKeys.has(
              H2H_STORE_KEYS.userGame(participantId),
            ),
        )
      ) {
        return { action: "no-change", result: { status: "retry" } };
      }

      let state: H2HCanonicalStateSnapshot | null = null;
      try {
        state = stateFromRaw(callerGameId, raw);
      } catch (error) {
        if (!(error instanceof H2HDomainError)) throw error;
      }
      const participant =
        state?.board.m_players.some((player) => player.userId === userId) ??
        false;
      if (
        state &&
        participant &&
        !state.ended &&
        !isStale(state, now, this.maxIdleMs)
      ) {
        resumedState = state;
      } else {
        callerEligible = true;
        deleteWrite(writes, callerMappingKey);
        const removed = removeActiveGame(active, callerGameId);
        active = removed.next;

        if (state && !state.ended && isStale(state, now, this.maxIdleMs)) {
          deleteWrite(writes, gameKey);
          for (const participantId of participantIds) {
            const mappingKey = H2H_STORE_KEYS.userGame(participantId);
            if (snapshot.get(mappingKey) === callerGameId) {
              deleteWrite(writes, mappingKey);
            }
          }
        } else if (!state && raw) {
          deleteWrite(writes, gameKey);
        }
      }
    }

    const nextQueue = queue.filter((candidate) => {
      if (candidate === userId) return callerEligible && !resumedState;
      return snapshot.get(H2H_STORE_KEYS.userGame(candidate)) === undefined;
    });
    if (!resumedState && !nextQueue.includes(userId)) nextQueue.push(userId);

    let createdPair: H2HCreatedPair | undefined;
    if (!resumedState && nextQueue.length >= 2) {
      const playerOneId = nextQueue[0];
      const playerTwoId = nextQueue[1];
      if (!playerOneId || !playerTwoId) {
        throw new H2HStoreError(
          "dynamic_conflict",
          "The normalized matchmaking queue is invalid.",
        );
      }
      const gameKey = H2H_STORE_KEYS.game(discovery.proposedGameId);
      if (snapshot.get(gameKey) !== undefined) {
        return { action: "no-change", result: { status: "retry" } };
      }
      const board = createInitialH2HBoard(playerOneId, playerTwoId, { now });
      const state = createH2HCanonicalState(discovery.proposedGameId, board);
      createdPair = {
        gameId: discovery.proposedGameId,
        playerIds: [playerOneId, playerTwoId],
        state,
      };
      setWrite(writes, gameKey, JSON.stringify(state.board));
      setWrite(
        writes,
        H2H_STORE_KEYS.userGame(playerOneId),
        discovery.proposedGameId,
      );
      setWrite(
        writes,
        H2H_STORE_KEYS.userGame(playerTwoId),
        discovery.proposedGameId,
      );
      active = addActiveGame(active, discovery.proposedGameId);
      nextQueue.splice(0, 2);
    }

    if (snapshot.get(H2H_STORE_KEYS.activeGames) !== serializeList(active)) {
      setWrite(writes, H2H_STORE_KEYS.activeGames, serializeList(active));
    }
    if (snapshot.get(H2H_STORE_KEYS.queue) !== serializeList(nextQueue)) {
      setWrite(writes, H2H_STORE_KEYS.queue, serializeList(nextQueue));
    }

    let value: H2HQueueResult;
    if (resumedState && callerGameId) {
      value = {
        status: "resumed",
        gameId: callerGameId,
        isPlayer1: resumedState.board.m_players[0].userId === userId,
        state: resumedState,
      };
    } else if (createdPair?.playerIds.includes(userId)) {
      value = {
        status: "paired",
        gameId: createdPair.gameId,
        isPlayer1: createdPair.playerIds[0] === userId,
        state: createdPair.state,
        createdPair,
      };
    } else {
      value = {
        status: "queued",
        ...(createdPair ? { createdPair } : {}),
      };
    }

    return decision(writes, { status: "done", value });
  }
}
