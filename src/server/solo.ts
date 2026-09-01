import { Board, Player, type RandomSource } from "../shared/game/engine";
import {
  GAME_STATES,
  PLAY_STYLES,
  RANKED_SOLO_RULES,
  SOLO_RULES_VERSION,
  playStyleForDifficulty,
  playerColorForIndex,
  validatePracticeRules,
  type GameOutcome,
  type PlayerIndex,
  type PracticeRules,
  type RankedSoloRules,
  type SoloRules,
} from "../shared/game/rules";
import type {
  CanonicalBoardSnapshot,
  RankedRatingChange,
  RankedSoloSessionMetadata,
  SoloAbandonRequest,
  SoloAbandonResponse,
  SoloEndReason,
  SoloEvent,
  SoloGameEndedEvent,
  SoloMoveEvent,
  SoloMoveRequest,
  SoloMoveResponse,
  SoloPublicBoardSnapshot,
  SoloSessionMetadata,
  SoloSessionSnapshot,
  SoloSessionStatus,
  SoloStartRequest,
  SoloTerminalResult,
  SharePlayer,
  SharePoint,
  ShareSquare,
} from "../shared/types/api";
import { createSoloTurnRng } from "./solo-rng";

export const SOLO_SCHEMA_VERSION = 1 as const;
export const SOLO_AI_USER_ID = "euclid-ai";

const MAX_IDENTIFIER_LENGTH = 256;
const MAX_TIMESTAMP = 8_640_000_000_000_000;
const NO_RANDOMNESS: RandomSource = () => 0;

export type SoloPrivateBoardSnapshot = CanonicalBoardSnapshot & {
  rulesVersion: typeof SOLO_RULES_VERSION;
  m_targets: [string | null, string | null];
};

export type SoloSessionRecord = {
  schemaVersion: typeof SOLO_SCHEMA_VERSION;
  gameId: string;
  ownerId: string;
  privateSeed: string;
  rules: RankedSoloRules | PracticeRules;
  revision: number;
  board: SoloPrivateBoardSnapshot;
  status: SoloSessionStatus;
  outcome: GameOutcome;
  endedReason: SoloEndReason | null;
  humanMoveCount: number;
  aiMoveCount: number;
  createdAt: number;
  updatedAt: number;
  rating?: RankedRatingChange;
};

export type CreateSoloSessionInput = {
  gameId: string;
  ownerId: string;
  rules: RankedSoloRules | PracticeRules;
  privateSeed: string;
  now: number;
};

export type CreateSoloSessionResult = {
  record: SoloSessionRecord;
  events: SoloEvent[];
};

export type SoloMoveResult = {
  record: SoloSessionRecord;
  response: SoloMoveResponse;
};

export type SoloAbandonResult = {
  record: SoloSessionRecord;
  response: SoloAbandonResponse;
};

export type ValidatedSoloStart = {
  request: SoloStartRequest;
  rules: RankedSoloRules | PracticeRules;
};

export type SoloDomainErrorCode = "invalid_request" | "invalid_session";

export class SoloDomainError extends Error {
  override readonly name = "SoloDomainError";

  constructor(
    readonly code: SoloDomainErrorCode,
    message: string,
  ) {
    super(message);
  }
}

type ReplayResult = {
  engine: Board;
  moves: SoloMoveEvent[];
  humanMoveCount: number;
  aiMoveCount: number;
  outcome: GameOutcome;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function invalidRequest(message: string): never {
  throw new SoloDomainError("invalid_request", message);
}

function invalidSession(message: string): never {
  throw new SoloDomainError("invalid_session", message);
}

function requireExactFields(
  source: Record<string, unknown>,
  allowed: ReadonlySet<string>,
  subject: string,
): void {
  const unknown = Object.keys(source).find((field) => !allowed.has(field));
  if (unknown !== undefined) {
    invalidRequest(`${subject} contains unknown field "${unknown}".`);
  }
}

function requireIdentifier(value: unknown, field: string): string {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > MAX_IDENTIFIER_LENGTH ||
    value.trim() !== value
  ) {
    invalidRequest(
      `${field} must be a non-empty canonical string of at most ${MAX_IDENTIFIER_LENGTH} characters.`,
    );
  }
  return value;
}

function requireTimestamp(value: unknown, field: string): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 0 ||
    value > MAX_TIMESTAMP
  ) {
    invalidRequest(
      `${field} must be a valid non-negative millisecond timestamp.`,
    );
  }
  return value;
}

function requireRevision(value: unknown, field = "expectedRevision"): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    invalidRequest(`${field} must be a non-negative safe integer.`);
  }
  return value;
}

function cloneOutcome(outcome: GameOutcome): GameOutcome {
  return { ...outcome };
}

function sameValue(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((item, index) => sameValue(item, right[index]))
    );
  }
  if (!isRecord(left) || !isRecord(right)) return false;
  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();
  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every(
      (key, index) =>
        key === rightKeys[index] && sameValue(left[key], right[key]),
    )
  );
}

export function rankedSoloSessionMetadata(): RankedSoloSessionMetadata {
  return {
    mode: "ranked",
    ranked: true,
    rulesVersion: SOLO_RULES_VERSION,
    rules: { ...RANKED_SOLO_RULES },
  };
}

export function soloSessionMetadata(
  rules: RankedSoloRules | PracticeRules,
): SoloSessionMetadata {
  if (rules.mode === "ranked") {
    return rankedSoloSessionMetadata();
  }
  return {
    mode: "practice",
    ranked: false,
    rulesVersion: SOLO_RULES_VERSION,
    rules: { ...rules },
  };
}

function normalizeStoredRules(value: unknown): RankedSoloRules | PracticeRules {
  if (!isRecord(value)) return invalidSession("Solo rules must be an object.");
  const fullFields = new Set([
    "rulesVersion",
    "mode",
    "W",
    "H",
    "scoring",
    "winScore",
    "humanPlayer",
    "firstPlayer",
    "difficulty",
  ]);
  const unknown = Object.keys(value).find((field) => !fullFields.has(field));
  if (unknown !== undefined) {
    return invalidSession(`Solo rules contain unknown field "${unknown}".`);
  }
  if (value.rulesVersion !== SOLO_RULES_VERSION) {
    return invalidSession("The solo rules version is not supported.");
  }

  if (value.mode === "ranked") {
    if (!sameValue(value, RANKED_SOLO_RULES)) {
      return invalidSession("Ranked solo rules must match the fixed preset.");
    }
    return { ...RANKED_SOLO_RULES };
  }
  if (value.mode !== "practice") {
    return invalidSession("The solo mode is not supported.");
  }

  try {
    const rules = validatePracticeRules({
      W: value.W,
      H: value.H,
      scoring: value.scoring,
      winScore: value.winScore,
      difficulty: value.difficulty,
      humanPlayer: value.humanPlayer,
      firstPlayer: value.firstPlayer,
    });
    if (!sameValue(value, rules)) {
      return invalidSession("Stored Practice rules are not canonical.");
    }
    return rules;
  } catch (error) {
    return invalidSession(
      error instanceof Error ? error.message : "Practice rules are invalid.",
    );
  }
}

/** Strictly accepts only the documented start fields for each solo mode. */
export function validateSoloStartRequest(input: unknown): ValidatedSoloStart {
  if (!isRecord(input)) return invalidRequest("Solo start must be an object.");
  const commandId = requireIdentifier(input.commandId, "commandId");

  if (input.mode === "ranked") {
    requireExactFields(
      input,
      new Set(["mode", "commandId"]),
      "Ranked solo start",
    );
    return {
      request: { mode: "ranked", commandId },
      rules: { ...RANKED_SOLO_RULES },
    };
  }

  if (input.mode === "practice") {
    requireExactFields(
      input,
      new Set(["mode", "commandId", "rules"]),
      "Practice solo start",
    );
    try {
      const rules = validatePracticeRules(input.rules);
      return {
        request: {
          mode: "practice",
          commandId,
          rules: {
            W: rules.W,
            H: rules.H,
            scoring: rules.scoring,
            winScore: rules.winScore,
            difficulty: rules.difficulty,
            humanPlayer: rules.humanPlayer,
            firstPlayer: rules.firstPlayer,
          },
        },
        rules,
      };
    } catch (error) {
      return invalidRequest(
        error instanceof Error ? error.message : "Practice rules are invalid.",
      );
    }
  }

  return invalidRequest('mode must be "ranked" or "practice".');
}

function normalizeHistory(value: unknown, rules: SoloRules): SharePoint[] {
  if (!Array.isArray(value))
    return invalidSession("Move history must be an array.");
  if (value.length > rules.W * rules.H) {
    return invalidSession("Move history exceeds the board capacity.");
  }

  const occupied = new Set<number>();
  return value.map((candidate) => {
    if (!isRecord(candidate)) {
      return invalidSession("Move history contains an invalid point.");
    }
    const { x, y, index } = candidate;
    if (
      typeof x !== "number" ||
      typeof y !== "number" ||
      !Number.isSafeInteger(x) ||
      !Number.isSafeInteger(y) ||
      x < 0 ||
      x >= rules.W ||
      y < 0 ||
      y >= rules.H ||
      index !== y * rules.W + x
    ) {
      return invalidSession("Move history contains an out-of-range point.");
    }
    if (occupied.has(index)) {
      return invalidSession("Move history cannot occupy a cell twice.");
    }
    occupied.add(index);
    return { x, y, index };
  });
}

function squareSignature(square: ShareSquare): string {
  return [square.p1.index, square.p2.index, square.p3.index, square.p4.index]
    .sort((left, right) => left - right)
    .join(",");
}

function cloneSquare(square: ShareSquare): ShareSquare {
  return {
    p1: { ...square.p1 },
    p2: { ...square.p2 },
    p3: { ...square.p3 },
    p4: { ...square.p4 },
    points: square.points,
    remain: square.remain,
    clr: square.clr,
  };
}

function serializePlayer(player: Player): SharePlayer {
  return {
    m_squares: player.m_squares
      .map(cloneSquare)
      .sort((left, right) =>
        squareSignature(left).localeCompare(squareSignature(right)),
      ),
    m_score: player.m_score,
    m_lastNumSquares: player.m_lastNumSquares,
    m_playStyle: player.m_playStyle,
    m_goofs: false,
    m_computer: player.m_computer,
    userId: player.userId,
  };
}

function createInitialEngine(
  rules: RankedSoloRules | PracticeRules,
  ownerId: string,
): Board {
  const aiPlayer: PlayerIndex = rules.humanPlayer === 0 ? 1 : 0;
  const players: [Player, Player] = [
    new Player(PLAY_STYLES.OFFENSIVE, false, ownerId),
    new Player(PLAY_STYLES.OFFENSIVE, false, ownerId),
  ];
  players[aiPlayer] = new Player(
    playStyleForDifficulty(rules.difficulty),
    true,
    SOLO_AI_USER_ID,
  );

  const engine = new Board(players[0], players[1], {
    W: rules.W,
    H: rules.H,
    scoring: rules.scoring,
    winScore: rules.winScore,
    rng: NO_RANDOMNESS,
  });
  engine.m_turn = rules.firstPlayer;
  return engine;
}

function replaySoloHistory(
  rules: RankedSoloRules | PracticeRules,
  ownerId: string,
  privateSeed: string,
  history: readonly SharePoint[],
): ReplayResult {
  let engine = createInitialEngine(rules, ownerId);
  let humanMoveCount = 0;
  let aiMoveCount = 0;
  const moves: SoloMoveEvent[] = [];

  for (let moveIndex = 0; moveIndex < history.length; moveIndex++) {
    if (engine.getOutcome().status !== "running") {
      return invalidSession("Move history continues after the game ended.");
    }
    const recorded = history[moveIndex];
    if (!recorded)
      return invalidSession("Move history contains a missing move.");

    const player = engine.m_turn;
    const actor = player === rules.humanPlayer ? "human" : "ai";
    if (actor === "ai") {
      const aiEngine = Board.fromJSON(
        engine.toJSON(),
        createSoloTurnRng(privateSeed, aiMoveCount),
      );
      const expected = aiEngine.findBestMove();
      if (
        expected.x !== recorded.x ||
        expected.y !== recorded.y ||
        expected.index !== recorded.index
      ) {
        return invalidSession(
          `AI move ${aiMoveCount + 1} does not match the private deterministic seed.`,
        );
      }
      engine = aiEngine;
    } else {
      engine = Board.fromJSON(engine.toJSON(), NO_RANDOMNESS);
    }

    const movingPlayer = engine.m_players[player];
    const squareCountBefore = movingPlayer.m_squares.length;
    movingPlayer.m_lastNumSquares = 0;
    const pointsScored = engine.placePiece(
      engine.pointAt(recorded.x, recorded.y),
    );
    engine.m_lastPoints = pointsScored;
    engine.advanceTurn();

    const completedSquares = movingPlayer.m_squares
      .slice(squareCountBefore)
      .map(cloneSquare)
      .sort((left, right) =>
        squareSignature(left).localeCompare(squareSignature(right)),
      );
    moves.push({
      type: "move",
      revision: moveIndex + 1,
      actor,
      player,
      point: { ...recorded },
      pointsScored,
      completedSquares,
    });
    if (actor === "human") humanMoveCount++;
    else aiMoveCount++;
  }

  return {
    engine,
    moves,
    humanMoveCount,
    aiMoveCount,
    outcome: cloneOutcome(engine.getOutcome()),
  };
}

function reasonForOutcome(
  engine: Board,
  outcome: GameOutcome,
): SoloEndReason | null {
  if (outcome.status === "running") return null;
  return engine.m_players.some((player) => player.m_score >= engine.winScore)
    ? "score_target"
    : "board_full";
}

function canonicalBoard(
  replay: ReplayResult,
  rules: RankedSoloRules | PracticeRules,
  revision: number,
  status: SoloSessionStatus,
  endedReason: SoloEndReason | null,
): SoloPrivateBoardSnapshot {
  const json = replay.engine.toJSON();
  const first = replay.engine.m_players[0];
  const second = replay.engine.m_players[1];
  return {
    W: rules.W,
    H: rules.H,
    scoring: rules.scoring,
    winScore: rules.winScore,
    m_board: [...replay.engine.m_board],
    m_players: [serializePlayer(first), serializePlayer(second)],
    m_turn: replay.engine.m_turn,
    m_history: replay.engine.m_history.map((point) => ({
      x: point.x,
      y: point.y,
      index: point.index,
    })),
    m_displayed_game_over: false,
    m_onlyShowLastSquares: false,
    m_createRandomizedRangeOrder: true,
    m_stopAt150: true,
    m_last: {
      x: replay.engine.m_last.x,
      y: replay.engine.m_last.y,
      index: replay.engine.m_last.index,
    },
    m_lastPoints: replay.engine.m_lastPoints,
    playerNames: {},
    playerAvatars: {},
    m_targets: [json.m_targets?.[0] ?? null, json.m_targets?.[1] ?? null],
    revision,
    rulesVersion: SOLO_RULES_VERSION,
    solo: soloSessionMetadata(rules),
    ended: status !== "active",
    ...(endedReason ? { endedReason } : {}),
  };
}

function buildCanonicalRecord(input: {
  gameId: string;
  ownerId: string;
  privateSeed: string;
  rules: RankedSoloRules | PracticeRules;
  history: readonly SharePoint[];
  requestedStatus: "active" | "abandoned";
  createdAt: number;
  updatedAt: number;
  rating?: RankedRatingChange;
}): { record: SoloSessionRecord; replay: ReplayResult } {
  const replay = replaySoloHistory(
    input.rules,
    input.ownerId,
    input.privateSeed,
    input.history,
  );
  const terminalReason = reasonForOutcome(replay.engine, replay.outcome);
  const status: SoloSessionStatus = terminalReason
    ? "completed"
    : input.requestedStatus;
  const endedReason = status === "abandoned" ? "abandoned" : terminalReason;
  const revision = input.history.length + (status === "abandoned" ? 1 : 0);
  // After the first human move, abandoning Ranked play is a forfeit rather than
  // a way to discard a rating result, so the canonical outcome awards Euclid.
  const ratedAbandonment =
    status === "abandoned" &&
    input.rules.mode === "ranked" &&
    replay.humanMoveCount > 0;
  const outcome: GameOutcome = ratedAbandonment
    ? input.rules.humanPlayer === 0
      ? {
          state: GAME_STATES.PLAYER_2_WIN,
          status: "player2_win",
          winner: 2,
        }
      : {
          state: GAME_STATES.PLAYER_1_WIN,
          status: "player1_win",
          winner: 1,
        }
    : cloneOutcome(replay.outcome);

  const record: SoloSessionRecord = {
    schemaVersion: SOLO_SCHEMA_VERSION,
    gameId: input.gameId,
    ownerId: input.ownerId,
    privateSeed: input.privateSeed,
    rules: { ...input.rules },
    revision,
    board: canonicalBoard(replay, input.rules, revision, status, endedReason),
    status,
    outcome,
    endedReason,
    humanMoveCount: replay.humanMoveCount,
    aiMoveCount: replay.aiMoveCount,
    createdAt: input.createdAt,
    updatedAt: input.updatedAt,
    ...(input.rating ? { rating: { ...input.rating } } : {}),
  };
  return { record, replay };
}

function nextAiMove(
  replay: ReplayResult,
  rules: RankedSoloRules | PracticeRules,
  privateSeed: string,
): SharePoint {
  if (replay.engine.m_turn === rules.humanPlayer) {
    return invalidSession("The AI cannot move on the human turn.");
  }
  const engine = Board.fromJSON(
    replay.engine.toJSON(),
    createSoloTurnRng(privateSeed, replay.aiMoveCount),
  );
  const point = engine.findBestMove();
  return { x: point.x, y: point.y, index: point.index };
}

function gameEndedEvent(record: SoloSessionRecord): SoloGameEndedEvent {
  if (!record.endedReason) {
    return invalidSession("A terminal event requires an end reason.");
  }
  return {
    type: "game_ended",
    revision: record.revision,
    reason: record.endedReason,
    outcome: cloneOutcome(record.outcome),
    ...(record.rating ? { rating: { ...record.rating } } : {}),
  };
}

/** Creates a canonical game using only caller-supplied identity, seed, and time. */
export function createSoloSession(
  input: CreateSoloSessionInput,
): CreateSoloSessionResult {
  const gameId = requireIdentifier(input?.gameId, "gameId");
  const ownerId = requireIdentifier(input?.ownerId, "ownerId");
  const privateSeed = requireIdentifier(input?.privateSeed, "privateSeed");
  const now = requireTimestamp(input?.now, "now");
  const rules = normalizeStoredRules(input?.rules);

  let history: SharePoint[] = [];
  let created = buildCanonicalRecord({
    gameId,
    ownerId,
    privateSeed,
    rules,
    history,
    requestedStatus: "active",
    createdAt: now,
    updatedAt: now,
  });

  if (
    created.record.status === "active" &&
    created.replay.engine.m_turn !== rules.humanPlayer
  ) {
    history = [nextAiMove(created.replay, rules, privateSeed)];
    created = buildCanonicalRecord({
      gameId,
      ownerId,
      privateSeed,
      rules,
      history,
      requestedStatus: "active",
      createdAt: now,
      updatedAt: now,
    });
  }

  if (
    created.record.status === "active" &&
    created.record.board.m_turn !== rules.humanPlayer
  ) {
    return invalidSession(
      "A new active session must return control to the human.",
    );
  }

  const events: SoloEvent[] = [...created.replay.moves];
  if (created.record.status === "completed") {
    events.push(gameEndedEvent(created.record));
  }
  return { record: created.record, events };
}

function normalizeRating(
  value: unknown,
  rules: RankedSoloRules | PracticeRules,
  status: SoloSessionStatus,
  humanMoveCount: number,
): RankedRatingChange | undefined {
  if (value === undefined) return undefined;
  const isRatedResult =
    rules.mode === "ranked" &&
    (status === "completed" || (status === "abandoned" && humanMoveCount > 0));
  if (!isRatedResult || !isRecord(value)) {
    return invalidSession(
      "Only a rated terminal Ranked session can contain a rating.",
    );
  }
  const before = value.before;
  const after = value.after;
  if (
    typeof before !== "number" ||
    typeof after !== "number" ||
    !Number.isSafeInteger(before) ||
    !Number.isSafeInteger(after) ||
    before < 0 ||
    after < 0 ||
    Object.keys(value).some((field) => field !== "before" && field !== "after")
  ) {
    return invalidSession("The stored Ranked rating change is invalid.");
  }
  return { before, after };
}

/**
 * Replays every move, including each seed-derived AI choice, and rejects any
 * stored cell, score, square, turn, target, count, outcome, or metadata drift.
 */
export function normalizeSoloSessionRecord(
  value: unknown,
  expectedGameId?: string,
): SoloSessionRecord {
  if (!isRecord(value))
    return invalidSession("Solo session must be an object.");
  const allowedFields = new Set([
    "schemaVersion",
    "gameId",
    "ownerId",
    "privateSeed",
    "rules",
    "revision",
    "board",
    "status",
    "outcome",
    "endedReason",
    "humanMoveCount",
    "aiMoveCount",
    "createdAt",
    "updatedAt",
    "rating",
  ]);
  const unknown = Object.keys(value).find((field) => !allowedFields.has(field));
  if (unknown !== undefined) {
    return invalidSession(`Solo session contains unknown field "${unknown}".`);
  }
  if (value.schemaVersion !== SOLO_SCHEMA_VERSION) {
    return invalidSession("The solo session schema version is not supported.");
  }

  let gameId: string;
  let ownerId: string;
  let privateSeed: string;
  let createdAt: number;
  let updatedAt: number;
  try {
    gameId = requireIdentifier(value.gameId, "gameId");
    ownerId = requireIdentifier(value.ownerId, "ownerId");
    privateSeed = requireIdentifier(value.privateSeed, "privateSeed");
    createdAt = requireTimestamp(value.createdAt, "createdAt");
    updatedAt = requireTimestamp(value.updatedAt, "updatedAt");
  } catch (error) {
    return invalidSession(
      error instanceof Error ? error.message : "Invalid session metadata.",
    );
  }
  if (expectedGameId !== undefined && gameId !== expectedGameId) {
    return invalidSession("The stored game ID does not match its key.");
  }
  if (updatedAt < createdAt) {
    return invalidSession("updatedAt cannot precede createdAt.");
  }

  const rules = normalizeStoredRules(value.rules);
  if (!isRecord(value.board))
    return invalidSession("Solo board must be an object.");
  const history = normalizeHistory(value.board.m_history, rules);
  const replay = replaySoloHistory(rules, ownerId, privateSeed, history);
  const terminalReason = reasonForOutcome(replay.engine, replay.outcome);

  const status = value.status;
  if (status !== "active" && status !== "completed" && status !== "abandoned") {
    return invalidSession("The stored solo status is invalid.");
  }
  if (terminalReason !== null && status !== "completed") {
    return invalidSession("A terminal board must be completed.");
  }
  if (terminalReason === null && status === "completed") {
    return invalidSession("A running board cannot be completed.");
  }
  if (status === "active" && replay.engine.m_turn !== rules.humanPlayer) {
    return invalidSession("An active session cannot stop on the AI turn.");
  }

  const requestedStatus = status === "abandoned" ? "abandoned" : "active";
  const rating = normalizeRating(
    value.rating,
    rules,
    status,
    replay.humanMoveCount,
  );
  const canonical = buildCanonicalRecord({
    gameId,
    ownerId,
    privateSeed,
    rules,
    history,
    requestedStatus,
    createdAt,
    updatedAt,
    ...(rating ? { rating } : {}),
  }).record;

  if (!sameValue(value.board, canonical.board)) {
    return invalidSession(
      "Stored board fields do not match canonical move-history replay.",
    );
  }
  if (!sameValue(value, canonical)) {
    return invalidSession(
      "Stored session fields do not match canonical move-history replay.",
    );
  }
  return canonical;
}

function clonePublicBoard(
  board: SoloPrivateBoardSnapshot,
): SoloPublicBoardSnapshot {
  const clone: SoloPrivateBoardSnapshot = {
    ...board,
    m_board: [...board.m_board],
    m_players: [
      {
        ...board.m_players[0],
        m_squares: board.m_players[0].m_squares.map(cloneSquare),
      },
      {
        ...board.m_players[1],
        m_squares: board.m_players[1].m_squares.map(cloneSquare),
      },
    ] as [SharePlayer, SharePlayer],
    m_history: board.m_history.map((point) => ({ ...point })),
    m_last: { ...board.m_last },
    playerNames: { ...(board.playerNames ?? {}) },
    playerAvatars: { ...(board.playerAvatars ?? {}) },
  };
  if (board.solo) clone.solo = soloSessionMetadata(board.solo.rules);
  delete (clone as Partial<SoloPrivateBoardSnapshot>).m_targets;
  delete (clone as Partial<SoloPrivateBoardSnapshot>).chat;
  return clone;
}

/**
 * Projects an already normalized record without replaying its full history.
 * Callers must obtain the record from this domain's create/normalize/mutation
 * functions rather than constructing it themselves.
 */
export function publicSoloSnapshotFromCanonicalRecord(
  record: SoloSessionRecord,
): SoloSessionSnapshot {
  return {
    ...soloSessionMetadata(record.rules),
    gameId: record.gameId,
    revision: record.revision,
    board: clonePublicBoard(record.board),
    status: record.status,
    outcome: cloneOutcome(record.outcome),
    endedReason: record.endedReason,
    canShare: soloResultForHumanFromCanonicalRecord(record) === 1,
    humanMoveCount: record.humanMoveCount,
    aiMoveCount: record.aiMoveCount,
    rankedAbandonCountsAsLoss:
      record.rules.mode === "ranked" && record.humanMoveCount > 0,
    createdAt: new Date(record.createdAt).toISOString(),
    updatedAt: new Date(record.updatedAt).toISOString(),
    ...(record.rating ? { rating: { ...record.rating } } : {}),
  };
}

/** Returns the client/share snapshot without the private seed or AI targets. */
export function publicSoloSnapshot(source: unknown): SoloSessionSnapshot {
  return publicSoloSnapshotFromCanonicalRecord(
    normalizeSoloSessionRecord(source),
  );
}

function rejection(
  record: SoloSessionRecord,
  request: SoloMoveRequest,
  reason: Exclude<SoloMoveResponse, { ok: true }>["reason"],
  message: string,
): SoloMoveResult {
  return {
    record,
    response: {
      ok: false,
      accepted: false,
      commandId: request.commandId,
      replayed: false,
      reason,
      message,
      events: [],
      snapshot: publicSoloSnapshotFromCanonicalRecord(record),
    },
  };
}

/** Applies one human coordinate and, if still live, one deterministic AI turn. */
export function applySoloMove(
  source: unknown,
  request: SoloMoveRequest,
  nowInput: number,
): SoloMoveResult {
  const record = normalizeSoloSessionRecord(source, request?.gameId);
  const commandId = requireIdentifier(request?.commandId, "commandId");
  const expectedRevision = requireRevision(request?.expectedRevision);
  const now = requireTimestamp(nowInput, "now");
  const canonicalRequest = { ...request, commandId };
  if (record.status !== "active") {
    return rejection(
      record,
      canonicalRequest,
      "game_ended",
      "The game has ended.",
    );
  }
  if (expectedRevision !== record.revision) {
    return rejection(
      record,
      canonicalRequest,
      "stale_revision",
      "The game revision is stale.",
    );
  }
  if (now < record.updatedAt) {
    return invalidRequest(
      "now cannot precede the persisted session timestamp.",
    );
  }
  if (record.board.m_turn !== record.rules.humanPlayer) {
    return rejection(
      record,
      canonicalRequest,
      "not_your_turn",
      "It is not the human player's turn.",
    );
  }
  if (
    !Number.isSafeInteger(request.x) ||
    !Number.isSafeInteger(request.y) ||
    request.x < 0 ||
    request.x >= record.rules.W ||
    request.y < 0 ||
    request.y >= record.rules.H
  ) {
    return rejection(
      record,
      canonicalRequest,
      "out_of_range",
      "The selected cell is outside the board.",
    );
  }

  const index = request.y * record.rules.W + request.x;
  if (record.board.m_board[index] !== 0) {
    return rejection(
      record,
      canonicalRequest,
      "cell_occupied",
      "The selected cell is occupied.",
    );
  }

  const originalLength = record.board.m_history.length;
  const history = [
    ...record.board.m_history.map((point) => ({ ...point })),
    { x: request.x, y: request.y, index },
  ];
  let replay = replaySoloHistory(
    record.rules,
    record.ownerId,
    record.privateSeed,
    history,
  );
  if (
    replay.outcome.status === "running" &&
    replay.engine.m_turn !== record.rules.humanPlayer
  ) {
    history.push(nextAiMove(replay, record.rules, record.privateSeed));
    replay = replaySoloHistory(
      record.rules,
      record.ownerId,
      record.privateSeed,
      history,
    );
  }

  const built = buildCanonicalRecord({
    gameId: record.gameId,
    ownerId: record.ownerId,
    privateSeed: record.privateSeed,
    rules: record.rules,
    history,
    requestedStatus: "active",
    createdAt: record.createdAt,
    updatedAt: now,
  });
  const events: SoloEvent[] = built.replay.moves.slice(originalLength);
  if (built.record.status === "completed") {
    events.push(gameEndedEvent(built.record));
  }
  return {
    record: built.record,
    response: {
      ok: true,
      accepted: true,
      commandId,
      replayed: false,
      events,
      snapshot: publicSoloSnapshotFromCanonicalRecord(built.record),
    },
  };
}

function abandonRejection(
  record: SoloSessionRecord,
  request: SoloAbandonRequest,
  reason: Exclude<SoloAbandonResponse, { ok: true }>["reason"],
  message: string,
): SoloAbandonResult {
  return {
    record,
    response: {
      ok: false,
      abandoned: false,
      commandId: request.commandId,
      replayed: false,
      reason,
      message,
      events: [],
      snapshot: publicSoloSnapshotFromCanonicalRecord(record),
    },
  };
}

/** Ends an active session without accepting any client-supplied result. */
export function abandonSoloSession(
  source: unknown,
  request: SoloAbandonRequest,
  nowInput: number,
): SoloAbandonResult {
  const record = normalizeSoloSessionRecord(source, request?.gameId);
  const commandId = requireIdentifier(request?.commandId, "commandId");
  const expectedRevision = requireRevision(request?.expectedRevision);
  const now = requireTimestamp(nowInput, "now");
  const canonicalRequest = { ...request, commandId };
  if (record.status !== "active") {
    return abandonRejection(
      record,
      canonicalRequest,
      "game_ended",
      "The game has ended.",
    );
  }
  if (expectedRevision !== record.revision) {
    return abandonRejection(
      record,
      canonicalRequest,
      "stale_revision",
      "The game revision is stale.",
    );
  }
  if (now < record.updatedAt) {
    return invalidRequest(
      "now cannot precede the persisted session timestamp.",
    );
  }

  const built = buildCanonicalRecord({
    gameId: record.gameId,
    ownerId: record.ownerId,
    privateSeed: record.privateSeed,
    rules: record.rules,
    history: record.board.m_history,
    requestedStatus: "abandoned",
    createdAt: record.createdAt,
    updatedAt: now,
  });
  const event = gameEndedEvent(built.record);
  return {
    record: built.record,
    response: {
      ok: true,
      abandoned: true,
      commandId,
      replayed: false,
      events: [event],
      snapshot: publicSoloSnapshotFromCanonicalRecord(built.record),
    },
  };
}

export function soloResultForHumanFromCanonicalRecord(
  record: SoloSessionRecord,
): 0 | 0.5 | 1 | null {
  if (record.status === "abandoned") {
    return record.rules.mode === "ranked" && record.humanMoveCount > 0
      ? 0
      : null;
  }
  if (record.status !== "completed") return null;
  if (record.outcome.status === "tie") return 0.5;
  return record.outcome.winner === playerColorForIndex(record.rules.humanPlayer)
    ? 1
    : 0;
}

/** Canonical human result used by settlement; null means explicitly unrated. */
export function soloResultForHuman(source: unknown): 0 | 0.5 | 1 | null {
  return soloResultForHumanFromCanonicalRecord(
    normalizeSoloSessionRecord(source),
  );
}

export function soloTerminalResultFromCanonicalRecord(
  record: SoloSessionRecord,
): SoloTerminalResult | null {
  if (record.status === "active" || record.endedReason === null) return null;
  const metadata = soloSessionMetadata(record.rules);
  const humanPlayer = record.rules.humanPlayer;
  const aiPlayer: PlayerIndex = humanPlayer === 0 ? 1 : 0;
  return {
    ...metadata,
    gameId: record.gameId,
    board: clonePublicBoard(record.board),
    outcome: cloneOutcome(record.outcome),
    endedReason: record.endedReason,
    humanPlayer,
    humanScore: record.board.m_players[humanPlayer].m_score,
    aiScore: record.board.m_players[aiPlayer].m_score,
    resultForHuman: soloResultForHumanFromCanonicalRecord(record),
    humanMoveCount: record.humanMoveCount,
    aiMoveCount: record.aiMoveCount,
    completedAt: new Date(record.updatedAt).toISOString(),
    ...(record.rating ? { rating: { ...record.rating } } : {}),
  };
}

/** Produces the immutable, seed-redacted terminal source for results/shares. */
export function soloTerminalResult(source: unknown): SoloTerminalResult | null {
  return soloTerminalResultFromCanonicalRecord(
    normalizeSoloSessionRecord(source),
  );
}

/** Adds the server-calculated rating delta to a settled Ranked result. */
export function withSoloRating(
  source: unknown,
  rating: RankedRatingChange,
): SoloSessionRecord {
  const record = normalizeSoloSessionRecord(source);
  const isRatedResult =
    record.rules.mode === "ranked" &&
    (record.status === "completed" ||
      (record.status === "abandoned" && record.humanMoveCount > 0));
  if (!isRatedResult) {
    return invalidRequest(
      "Only a rated terminal Ranked session can receive a rating.",
    );
  }
  return normalizeSoloSessionRecord({
    ...record,
    rating: { ...rating },
  });
}
