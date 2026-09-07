import { Board, Player } from "../shared/game/engine";
import type {
  GameOutcome,
  PlayerColor,
  PlayerIndex,
} from "../shared/game/rules";
import type {
  CanonicalBoardSnapshot,
  H2HCanonicalState,
  H2HEndReason,
  H2HMoveRequest,
  H2HMoveResponse,
  SerializableBoard,
  ShareChatItem,
  SharePlayer,
  SharePoint,
  ShareSquare,
} from "../shared/types/api";

export const H2H_SCHEMA_VERSION = 1;

export const H2H_RULES = Object.freeze({
  W: 8,
  H: 8,
  scoring: "bbox" as const,
  winScore: 150,
  rulesVersion: 1,
});

export const H2H_CHAT_MAX_LENGTH = 140;
export const H2H_CHAT_MAX_ITEMS = 100;

export type H2HBoardSnapshot = CanonicalBoardSnapshot & {
  schemaVersion: number;
  /** Server turn clock; chat and spectator activity must not renew it. */
  turnStartedAt?: number;
};

export type H2HCanonicalStateSnapshot = Omit<H2HCanonicalState, "board"> & {
  board: H2HBoardSnapshot;
};

export type H2HDomainErrorCode =
  | "invalid_board"
  | "invalid_request"
  | "not_participant"
  | "stale_revision"
  | "not_your_turn"
  | "out_of_range"
  | "cell_occupied"
  | "game_ended";

export class H2HDomainError extends Error {
  override readonly name = "H2HDomainError";

  constructor(
    readonly code: H2HDomainErrorCode,
    message: string,
    readonly state: H2HCanonicalState | undefined = undefined,
  ) {
    super(message);
  }
}

export type CreateH2HBoardOptions = {
  names?: Readonly<Record<string, string>>;
  avatars?: Readonly<Record<string, string>>;
  chat?: Readonly<{
    seq: number;
    items: readonly ShareChatItem[];
  }>;
  now: number;
};

export type H2HMoveAcceptedResponse = H2HCanonicalStateSnapshot & {
  ok: true;
  accepted: true;
  pointsScored: number;
  completedSquares: ShareSquare[];
};

export type H2HChatAppendResult = {
  item: ShareChatItem;
  state: H2HCanonicalStateSnapshot;
};

type CanonicalEnd = {
  ended: boolean;
  endedReason: Exclude<H2HEndReason, "opponent_left"> | null;
  endedBy: string | null;
};

const deterministicRng = () => 0;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOwn(source: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(source, key);
}

function invalidBoard(message: string): never {
  throw new H2HDomainError("invalid_board", message);
}

function reject(
  code: H2HDomainErrorCode,
  message: string,
  state?: H2HCanonicalState,
): never {
  throw new H2HDomainError(code, message, state);
}

function nonNegativeInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : null;
}

function requireNow(value: unknown): number {
  const now = nonNegativeInteger(value);
  if (now === null) {
    return reject(
      "invalid_request",
      "now must be a non-negative safe integer timestamp.",
    );
  }
  return now;
}

function requireIdentifier(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    return reject("invalid_request", `${field} must be a non-empty string.`);
  }
  return value;
}

function requireCompatibleField(
  source: Record<string, unknown>,
  field: string,
  expected: unknown,
): void {
  if (
    hasOwn(source, field) &&
    source[field] !== undefined &&
    source[field] !== expected
  ) {
    invalidBoard(`${field} is incompatible with the current H2H rules.`);
  }
}

function normalizePoint(value: unknown, allowEmpty = false): SharePoint | null {
  if (!isRecord(value)) return null;

  const x = value.x;
  const y = value.y;
  const index = value.index;
  if (
    allowEmpty &&
    x === -1 &&
    y === -1 &&
    (index === -1 || index === undefined)
  ) {
    return { x: -1, y: -1, index: -1 };
  }
  if (
    typeof x !== "number" ||
    typeof y !== "number" ||
    !Number.isSafeInteger(x) ||
    !Number.isSafeInteger(y) ||
    x < 0 ||
    x >= H2H_RULES.W ||
    y < 0 ||
    y >= H2H_RULES.H
  ) {
    return null;
  }

  const expectedIndex = y * H2H_RULES.W + x;
  if (index !== undefined && index !== expectedIndex) return null;
  return { x, y, index: expectedIndex };
}

function samePoint(left: SharePoint, right: SharePoint): boolean {
  return left.x === right.x && left.y === right.y && left.index === right.index;
}

function normalizeSquare(value: unknown): ShareSquare | null {
  if (!isRecord(value)) return null;
  const p1 = normalizePoint(value.p1);
  const p2 = normalizePoint(value.p2);
  const p3 = normalizePoint(value.p3);
  const p4 = normalizePoint(value.p4);
  const points = nonNegativeInteger(value.points);
  const remain = nonNegativeInteger(value.remain);
  const clr = value.clr;
  if (
    !p1 ||
    !p2 ||
    !p3 ||
    !p4 ||
    points === null ||
    remain === null ||
    (clr !== 1 && clr !== 2)
  ) {
    return null;
  }

  const corners = new Set([p1.index, p2.index, p3.index, p4.index]);
  if (corners.size !== 4) return null;
  return { p1, p2, p3, p4, points, remain, clr };
}

function squareSignature(square: ShareSquare): string {
  const indices = [
    square.p1.index,
    square.p2.index,
    square.p3.index,
    square.p4.index,
  ].sort((left, right) => left - right);
  return `${indices.join(",")}|${square.clr}|${square.points}|${square.remain}`;
}

function serializeSquare(square: ShareSquare): ShareSquare {
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

function serializePlayer(player: SharePlayer): SharePlayer {
  return {
    m_squares: player.m_squares.map(serializeSquare),
    m_score: player.m_score,
    m_lastNumSquares: player.m_lastNumSquares,
    m_playStyle: Board.PS_OFFENSIVE,
    m_goofs: false,
    m_computer: false,
    userId: player.userId,
  };
}

function normalizeStringRecord(
  value: unknown,
  field: string,
): Record<string, string> {
  if (value === undefined) return {};
  if (!isRecord(value)) return invalidBoard(`${field} must be an object.`);

  const entries = Object.entries(value);
  for (const [, item] of entries) {
    if (typeof item !== "string") {
      return invalidBoard(`${field} values must be strings.`);
    }
  }
  return Object.fromEntries(entries) as Record<string, string>;
}

function canonicalChatText(value: string): string {
  return value.replace(/[\r\n]+/g, " ").trim();
}

function normalizeChat(
  value: unknown,
  participantIds: ReadonlySet<string>,
): NonNullable<SerializableBoard["chat"]> {
  if (value === undefined) return { seq: 0, items: [] };
  if (!isRecord(value) || !Array.isArray(value.items)) {
    return invalidBoard("chat must contain a sequence and item list.");
  }

  const seq = nonNegativeInteger(value.seq);
  if (seq === null) return invalidBoard("chat.seq must be non-negative.");
  if (value.items.length > H2H_CHAT_MAX_ITEMS) {
    return invalidBoard("The stored chat exceeds its item limit.");
  }

  let previousId = 0;
  const items: ShareChatItem[] = value.items.map((candidate) => {
    if (!isRecord(candidate)) return invalidBoard("A chat item is invalid.");
    const id = nonNegativeInteger(candidate.id);
    const ts = nonNegativeInteger(candidate.ts);
    const sender = candidate.sender;
    const text = candidate.text;
    if (id === null || id < 1 || id <= previousId) {
      return invalidBoard("Chat item ids must be positive and increasing.");
    }
    if (ts === null) return invalidBoard("Chat timestamps must be valid.");
    if (typeof sender !== "string" || !participantIds.has(sender)) {
      return invalidBoard("Every chat sender must be a game participant.");
    }
    if (
      typeof text !== "string" ||
      text.length < 1 ||
      text.length > H2H_CHAT_MAX_LENGTH ||
      canonicalChatText(text) !== text
    ) {
      return invalidBoard("Stored chat text is not canonical.");
    }
    previousId = id;
    return { id, ts, sender, text };
  });

  if (seq < previousId) {
    return invalidBoard("chat.seq cannot precede its newest item id.");
  }
  return { seq, items };
}

function normalizeHistory(value: unknown): SharePoint[] {
  if (value === undefined) return [];
  if (!Array.isArray(value))
    return invalidBoard("Move history must be an array.");

  const occupied = new Set<number>();
  return value.map((candidate) => {
    const point = normalizePoint(candidate);
    if (!point) return invalidBoard("Move history contains an invalid point.");
    if (occupied.has(point.index)) {
      return invalidBoard("Move history cannot occupy a cell twice.");
    }
    occupied.add(point.index);
    return point;
  });
}

function validateStoredPlayer(
  value: unknown,
  canonical: SharePlayer,
  playerIndex: PlayerIndex,
): void {
  if (!isRecord(value) || value.userId !== canonical.userId) {
    invalidBoard(`Player ${playerIndex + 1} identity is invalid.`);
  }

  if (
    value.m_score !== undefined &&
    nonNegativeInteger(value.m_score) !== canonical.m_score
  ) {
    invalidBoard(
      `Player ${playerIndex + 1} score does not match move history.`,
    );
  }
  if (
    value.m_lastNumSquares !== undefined &&
    nonNegativeInteger(value.m_lastNumSquares) !== canonical.m_lastNumSquares
  ) {
    invalidBoard(
      `Player ${playerIndex + 1} last-square count does not match move history.`,
    );
  }
  if (
    value.m_playStyle !== undefined &&
    value.m_playStyle !== Board.PS_OFFENSIVE
  ) {
    invalidBoard(`Player ${playerIndex + 1} has an invalid H2H play style.`);
  }
  if (value.m_goofs !== undefined && value.m_goofs !== false) {
    invalidBoard(`Player ${playerIndex + 1} cannot contain AI mistake state.`);
  }
  if (value.m_computer !== undefined && value.m_computer !== false) {
    invalidBoard(`Player ${playerIndex + 1} must be human.`);
  }

  if (value.m_squares !== undefined) {
    if (!Array.isArray(value.m_squares)) {
      invalidBoard(`Player ${playerIndex + 1} squares must be an array.`);
    }
    const storedSignatures = value.m_squares.map((candidate) => {
      const square = normalizeSquare(candidate);
      if (!square) {
        return invalidBoard(
          `Player ${playerIndex + 1} contains an invalid square.`,
        );
      }
      return squareSignature(square);
    });
    const canonicalSignatures = canonical.m_squares.map(squareSignature);
    storedSignatures.sort();
    canonicalSignatures.sort();
    if (
      storedSignatures.length !== canonicalSignatures.length ||
      storedSignatures.some(
        (signature, index) => signature !== canonicalSignatures[index],
      )
    ) {
      invalidBoard(
        `Player ${playerIndex + 1} squares do not match move history.`,
      );
    }
  }
}

function replayHistory(
  cells: readonly number[],
  history: readonly SharePoint[],
  playerIds: readonly [string, string],
): Board {
  const replay = new Board(
    new Player(Board.PS_OFFENSIVE, false, playerIds[0]),
    new Player(Board.PS_OFFENSIVE, false, playerIds[1]),
    {
      W: H2H_RULES.W,
      H: H2H_RULES.H,
      scoring: H2H_RULES.scoring,
      winScore: H2H_RULES.winScore,
      rng: deterministicRng,
    },
  );

  for (let moveIndex = 0; moveIndex < history.length; moveIndex++) {
    if (replay.getOutcome().status !== "running") {
      invalidBoard("Move history continues after the game ended.");
    }
    const point = history[moveIndex];
    if (!point) return invalidBoard("Move history contains a missing move.");
    const expectedColor: PlayerColor = moveIndex % 2 === 0 ? 1 : 2;
    if (cells[point.index] !== expectedColor) {
      invalidBoard("Board colors do not match alternating move history.");
    }

    const movingPlayer = replay.m_players[replay.m_turn];
    movingPlayer.m_lastNumSquares = 0;
    const points = replay.placePiece(replay.pointAt(point.x, point.y));
    replay.m_lastPoints = points;
    replay.advanceTurn();
  }

  if (cells.some((cell, index) => cell !== replay.m_board[index])) {
    invalidBoard("Occupied board cells do not match move history.");
  }
  return replay;
}

function normalizeEnd(
  source: Record<string, unknown>,
  outcome: GameOutcome,
  participantIds: ReadonlySet<string>,
): CanonicalEnd {
  if (source.ended !== undefined && typeof source.ended !== "boolean") {
    return invalidBoard("ended must be a boolean when present.");
  }
  const explicitEnded = source.ended;

  let reason: CanonicalEnd["endedReason"] = null;
  if (source.endedReason !== undefined && source.endedReason !== "") {
    if (
      source.endedReason !== "game_over" &&
      source.endedReason !== "tie" &&
      source.endedReason !== "player_left" &&
      source.endedReason !== "opponent_left"
    ) {
      return invalidBoard("The stored end reason is not recognized.");
    }
    // Legacy readers wrote `opponent_left` from the survivor's viewpoint. Its
    // endedBy field still identified the departing player, so the canonical,
    // viewpoint-independent representation is `player_left`.
    reason =
      source.endedReason === "opponent_left"
        ? "player_left"
        : source.endedReason;
  }

  let endedBy: string | null = null;
  if (source.endedBy !== undefined && source.endedBy !== "") {
    if (typeof source.endedBy !== "string") {
      return invalidBoard("endedBy must identify a player.");
    }
    endedBy = source.endedBy;
  }

  const terminalReason: CanonicalEnd["endedReason"] =
    outcome.status === "tie"
      ? "tie"
      : outcome.status === "running"
        ? null
        : "game_over";
  const ended =
    explicitEnded ??
    (reason !== null || endedBy !== null || terminalReason !== null);

  if (!ended) {
    if (reason !== null || endedBy !== null || terminalReason !== null) {
      return invalidBoard("A live board contains terminal game state.");
    }
    return { ended: false, endedReason: null, endedBy: null };
  }

  if (terminalReason !== null) {
    if (reason !== null && reason !== terminalReason) {
      return invalidBoard("The stored end reason does not match the outcome.");
    }
    if (endedBy !== null) {
      return invalidBoard(
        "A scored game outcome cannot identify a departing player.",
      );
    }
    return { ended: true, endedReason: terminalReason, endedBy: null };
  }

  if (reason !== "player_left") {
    return invalidBoard(
      "An ended live position must record a player departure.",
    );
  }
  if (endedBy === null || !participantIds.has(endedBy)) {
    return invalidBoard(
      "A departure must identify one of the game participants.",
    );
  }
  return { ended: true, endedReason: "player_left", endedBy };
}

/**
 * Validates persisted H2H state by replaying its complete move history. Missing
 * fields from the unversioned legacy shape are migrated, but explicit values
 * that contradict the fixed rules or replayed state are rejected.
 */
export function normalizeH2HBoard(source: unknown): H2HBoardSnapshot {
  if (!isRecord(source)) return invalidBoard("Board data must be an object.");

  requireCompatibleField(source, "W", H2H_RULES.W);
  requireCompatibleField(source, "H", H2H_RULES.H);
  requireCompatibleField(source, "scoring", H2H_RULES.scoring);
  requireCompatibleField(source, "winScore", H2H_RULES.winScore);
  requireCompatibleField(source, "rulesVersion", H2H_RULES.rulesVersion);
  requireCompatibleField(source, "schemaVersion", H2H_SCHEMA_VERSION);
  requireCompatibleField(source, "m_stopAt150", true);
  requireCompatibleField(source, "m_createRandomizedRangeOrder", true);

  if (
    !Array.isArray(source.m_board) ||
    source.m_board.length !== H2H_RULES.W * H2H_RULES.H ||
    !source.m_board.every((cell) => cell === 0 || cell === 1 || cell === 2)
  ) {
    return invalidBoard("Board cells must be a valid 8x8 position.");
  }
  if (!Array.isArray(source.m_players) || source.m_players.length !== 2) {
    return invalidBoard("A board must contain exactly two players.");
  }

  const firstStoredPlayer = source.m_players[0];
  const secondStoredPlayer = source.m_players[1];
  if (
    !isRecord(firstStoredPlayer) ||
    typeof firstStoredPlayer.userId !== "string" ||
    !firstStoredPlayer.userId ||
    !isRecord(secondStoredPlayer) ||
    typeof secondStoredPlayer.userId !== "string" ||
    !secondStoredPlayer.userId
  ) {
    return invalidBoard("A board must contain two identified players.");
  }
  if (firstStoredPlayer.userId === secondStoredPlayer.userId) {
    return invalidBoard("A board must contain two different players.");
  }

  const cells = [...source.m_board] as number[];
  const history = normalizeHistory(source.m_history);
  const playerIds: [string, string] = [
    firstStoredPlayer.userId,
    secondStoredPlayer.userId,
  ];
  const participantIds = new Set(playerIds);
  const replay = replayHistory(cells, history, playerIds);
  const replayJson = replay.toJSON();
  const players: [SharePlayer, SharePlayer] = [
    serializePlayer(replayJson.m_players[0] as SharePlayer),
    serializePlayer(replayJson.m_players[1] as SharePlayer),
  ];

  validateStoredPlayer(firstStoredPlayer, players[0], 0);
  validateStoredPlayer(secondStoredPlayer, players[1], 1);

  if (
    source.m_turn !== undefined &&
    source.m_turn !== 0 &&
    source.m_turn !== 1
  ) {
    return invalidBoard("The stored turn is invalid.");
  }
  if (source.m_turn !== undefined && source.m_turn !== replay.m_turn) {
    return invalidBoard("The stored turn does not match move history.");
  }

  const canonicalLast: SharePoint =
    history.at(-1) ?? ({ x: -1, y: -1, index: -1 } satisfies SharePoint);
  if (source.m_last !== undefined) {
    const storedLast = normalizePoint(source.m_last, true);
    if (!storedLast || !samePoint(storedLast, canonicalLast)) {
      return invalidBoard("The last move does not match move history.");
    }
  }
  if (
    source.m_lastPoints !== undefined &&
    nonNegativeInteger(source.m_lastPoints) !== replay.m_lastPoints
  ) {
    return invalidBoard("The last move score does not match move history.");
  }

  const storedRevision =
    source.revision === undefined ? null : nonNegativeInteger(source.revision);
  if (source.revision !== undefined && storedRevision === null) {
    return invalidBoard("revision must be a non-negative safe integer.");
  }
  if (storedRevision !== null && storedRevision < history.length) {
    return invalidBoard("revision cannot precede the replayed move count.");
  }
  const revision = storedRevision ?? history.length;

  if (
    source.m_targets !== undefined &&
    (!Array.isArray(source.m_targets) ||
      source.m_targets.length !== 2 ||
      source.m_targets.some((target) => target !== null))
  ) {
    return invalidBoard("H2H games cannot contain AI targets.");
  }

  const playerNames = normalizeStringRecord(source.playerNames, "playerNames");
  const playerAvatars = normalizeStringRecord(
    source.playerAvatars,
    "playerAvatars",
  );
  const chat = normalizeChat(source.chat, participantIds);

  const createdAt =
    source.createdAt === undefined
      ? null
      : nonNegativeInteger(source.createdAt);
  const lastSaved =
    source.lastSaved === undefined
      ? null
      : nonNegativeInteger(source.lastSaved);
  if (source.createdAt !== undefined && createdAt === null) {
    return invalidBoard("createdAt must be a non-negative safe integer.");
  }
  if (source.lastSaved !== undefined && lastSaved === null) {
    return invalidBoard("lastSaved must be a non-negative safe integer.");
  }
  if (createdAt !== null && lastSaved !== null && lastSaved < createdAt) {
    return invalidBoard("lastSaved cannot precede createdAt.");
  }
  const turnStartedAt =
    source.turnStartedAt === undefined
      ? (lastSaved ?? createdAt)
      : nonNegativeInteger(source.turnStartedAt);
  if (source.turnStartedAt !== undefined && turnStartedAt === null) {
    return invalidBoard("turnStartedAt must be a non-negative safe integer.");
  }
  if (
    turnStartedAt !== null &&
    ((createdAt !== null && turnStartedAt < createdAt) ||
      (lastSaved !== null && turnStartedAt > lastSaved))
  ) {
    return invalidBoard(
      "turnStartedAt must be within the persisted timestamps.",
    );
  }

  if (
    source.m_displayed_game_over !== undefined &&
    typeof source.m_displayed_game_over !== "boolean"
  ) {
    return invalidBoard("m_displayed_game_over must be a boolean.");
  }
  if (
    source.m_onlyShowLastSquares !== undefined &&
    typeof source.m_onlyShowLastSquares !== "boolean"
  ) {
    return invalidBoard("m_onlyShowLastSquares must be a boolean.");
  }

  const end = normalizeEnd(source, replay.getOutcome(), participantIds);

  return {
    W: H2H_RULES.W,
    H: H2H_RULES.H,
    scoring: H2H_RULES.scoring,
    winScore: H2H_RULES.winScore,
    m_board: [...replay.m_board],
    m_players: players,
    m_turn: replay.m_turn,
    m_history: history.map((move) => ({ ...move })),
    m_displayed_game_over: source.m_displayed_game_over === true,
    m_onlyShowLastSquares: source.m_onlyShowLastSquares === true,
    m_createRandomizedRangeOrder: true,
    m_stopAt150: true,
    m_last: { ...canonicalLast },
    m_lastPoints: replay.m_lastPoints,
    playerNames,
    playerAvatars,
    m_targets: [null, null],
    chat,
    revision,
    rulesVersion: H2H_RULES.rulesVersion,
    schemaVersion: H2H_SCHEMA_VERSION,
    ...(createdAt !== null ? { createdAt } : {}),
    ...(lastSaved !== null ? { lastSaved } : {}),
    ...(turnStartedAt !== null ? { turnStartedAt } : {}),
    ended: end.ended,
    ...(end.endedReason ? { endedReason: end.endedReason } : {}),
    ...(end.endedBy ? { endedBy: end.endedBy } : {}),
  };
}

/** Creates a new fixed-rules game from an explicitly supplied timestamp. */
export function createInitialH2HBoard(
  playerOneId: string,
  playerTwoId: string,
  options: CreateH2HBoardOptions,
): H2HBoardSnapshot {
  requireIdentifier(playerOneId, "playerOneId");
  requireIdentifier(playerTwoId, "playerTwoId");
  if (playerOneId === playerTwoId) {
    return reject(
      "invalid_request",
      "A game requires two different identified players.",
    );
  }
  const now = requireNow(options?.now);

  const board = new Board(
    new Player(Board.PS_OFFENSIVE, false, playerOneId),
    new Player(Board.PS_OFFENSIVE, false, playerTwoId),
    {
      W: H2H_RULES.W,
      H: H2H_RULES.H,
      scoring: H2H_RULES.scoring,
      winScore: H2H_RULES.winScore,
      rng: deterministicRng,
    },
  );

  return normalizeH2HBoard({
    ...board.toJSON(),
    playerNames: { ...(options.names ?? {}) },
    playerAvatars: { ...(options.avatars ?? {}) },
    chat: options.chat
      ? {
          seq: options.chat.seq,
          items: options.chat.items.map((item) => ({ ...item })),
        }
      : { seq: 0, items: [] },
    revision: 0,
    rulesVersion: H2H_RULES.rulesVersion,
    schemaVersion: H2H_SCHEMA_VERSION,
    createdAt: now,
    lastSaved: now,
    turnStartedAt: now,
    ended: false,
  });
}

function victorForDeparture(
  board: H2HBoardSnapshot,
  endedBy: string | null,
): PlayerColor | null {
  if (!endedBy) return null;
  if (board.m_players[0].userId === endedBy) return 2;
  if (board.m_players[1].userId === endedBy) return 1;
  return null;
}

/** Builds the single canonical state returned to players and spectators. */
export function createH2HCanonicalState(
  gameId: string,
  source: unknown,
): H2HCanonicalStateSnapshot {
  requireIdentifier(gameId, "gameId");
  const board = normalizeH2HBoard(source);
  const endedReason =
    board.endedReason === "game_over" ||
    board.endedReason === "tie" ||
    board.endedReason === "player_left"
      ? board.endedReason
      : null;
  const endedBy =
    endedReason === "player_left" && typeof board.endedBy === "string"
      ? board.endedBy
      : null;
  const outcome = Board.fromJSON(board, deterministicRng).getOutcome();

  let victorSide: PlayerColor | null = null;
  if (endedReason === "game_over") victorSide = outcome.winner;
  else if (endedReason === "player_left") {
    victorSide = victorForDeparture(board, endedBy);
  }

  return {
    gameId,
    board,
    revision: board.revision,
    rulesVersion: board.rulesVersion,
    ended: board.ended === true,
    endedReason,
    endedBy,
    victorSide,
  };
}

function playerIndexForUser(
  board: H2HBoardSnapshot,
  userId: string,
): PlayerIndex | null {
  if (board.m_players[0].userId === userId) return 0;
  if (board.m_players[1].userId === userId) return 1;
  return null;
}

function requireParticipant(
  board: H2HBoardSnapshot,
  userId: string,
): PlayerIndex {
  const playerIndex = playerIndexForUser(board, userId);
  if (playerIndex === null) {
    return reject("not_participant", "The caller is not a participant.");
  }
  return playerIndex;
}

function nextRevision(revision: number): number {
  if (revision >= Number.MAX_SAFE_INTEGER) {
    return invalidBoard("revision cannot be incremented safely.");
  }
  return revision + 1;
}

function mutationTimestamps(
  board: H2HBoardSnapshot,
  now: number,
): { createdAt: number; lastSaved: number } {
  const createdAt = board.createdAt ?? board.lastSaved ?? now;
  const previousTimestamp = board.lastSaved ?? board.createdAt;
  if (
    now < createdAt ||
    (previousTimestamp !== undefined && now < previousTimestamp)
  ) {
    return reject(
      "invalid_request",
      "now cannot precede the persisted game timestamp.",
    );
  }
  return { createdAt, lastSaved: now };
}

function endFieldsForOutcome(outcome: GameOutcome): {
  ended: boolean;
  endedReason?: "game_over" | "tie";
} {
  if (outcome.status === "running") return { ended: false };
  return {
    ended: true,
    endedReason: outcome.status === "tie" ? "tie" : "game_over",
  };
}

/**
 * Applies one coordinate intent to a cloned canonical board. No client board
 * or client-computed score is accepted by this seam.
 */
export function applyH2HMove(
  source: unknown,
  userId: string,
  request: H2HMoveRequest,
  nowInput: number,
): H2HMoveAcceptedResponse {
  const gameId = requireIdentifier(request?.gameId, "gameId");
  const now = requireNow(nowInput);
  const state = createH2HCanonicalState(gameId, source);
  const playerIndex = requireParticipant(state.board, userId);
  if (state.ended) {
    return reject("game_ended", "The game has already ended.", state);
  }
  if (
    !Number.isSafeInteger(request.expectedRevision) ||
    request.expectedRevision < 0
  ) {
    return reject("invalid_request", "expectedRevision must be non-negative.");
  }
  if (request.expectedRevision !== state.revision) {
    return reject("stale_revision", "The game revision is stale.", state);
  }
  if (state.board.m_turn !== playerIndex) {
    return reject("not_your_turn", "It is not the caller's turn.", state);
  }
  if (
    !Number.isSafeInteger(request.x) ||
    !Number.isSafeInteger(request.y) ||
    request.x < 0 ||
    request.x >= H2H_RULES.W ||
    request.y < 0 ||
    request.y >= H2H_RULES.H
  ) {
    return reject(
      "out_of_range",
      "The selected cell is outside the board.",
      state,
    );
  }

  const index = request.y * H2H_RULES.W + request.x;
  if (state.board.m_board[index] !== 0) {
    return reject("cell_occupied", "The selected cell is occupied.", state);
  }

  const engine = Board.fromJSON(state.board, deterministicRng);
  const movingPlayer = engine.m_players[playerIndex];
  const squareCountBefore = movingPlayer.m_squares.length;
  movingPlayer.m_lastNumSquares = 0;
  const pointsScored = engine.placePiece(engine.pointAt(request.x, request.y));
  engine.m_lastPoints = pointsScored;
  engine.advanceTurn();

  const end = endFieldsForOutcome(engine.getOutcome());
  const nextBoard = normalizeH2HBoard({
    ...state.board,
    ...engine.toJSON(),
    revision: nextRevision(state.revision),
    rulesVersion: H2H_RULES.rulesVersion,
    schemaVersion: H2H_SCHEMA_VERSION,
    ...mutationTimestamps(state.board, now),
    ended: end.ended,
    turnStartedAt: now,
    endedReason: end.endedReason,
    endedBy: undefined,
  });
  const nextState = createH2HCanonicalState(gameId, nextBoard);
  const completedSquares =
    nextState.board.m_players[playerIndex].m_squares.slice(squareCountBefore);

  return {
    ...nextState,
    ok: true,
    accepted: true,
    pointsScored,
    completedSquares,
  } satisfies H2HMoveResponse;
}

/** Ends a live game because the identified participant departed. */
export function endH2HByDeparture(
  source: unknown,
  userId: string,
  gameIdInput: string,
  nowInput: number,
): H2HCanonicalStateSnapshot {
  const gameId = requireIdentifier(gameIdInput, "gameId");
  const now = requireNow(nowInput);
  const state = createH2HCanonicalState(gameId, source);
  requireParticipant(state.board, userId);
  if (state.ended) {
    return reject("game_ended", "The game has already ended.", state);
  }

  return createH2HCanonicalState(gameId, {
    ...state.board,
    revision: nextRevision(state.revision),
    ...mutationTimestamps(state.board, now),
    ended: true,
    endedReason: "player_left",
    endedBy: userId,
  });
}

/** Appends one canonical, bounded chat item to a live game. */
export function appendH2HChat(
  source: unknown,
  userId: string,
  gameIdInput: string,
  textInput: string,
  nowInput: number,
): H2HChatAppendResult {
  const gameId = requireIdentifier(gameIdInput, "gameId");
  const now = requireNow(nowInput);
  const state = createH2HCanonicalState(gameId, source);
  requireParticipant(state.board, userId);
  if (state.ended) {
    return reject("game_ended", "The game has already ended.", state);
  }
  if (typeof textInput !== "string") {
    return reject("invalid_request", "Chat text must be a string.");
  }
  const text = canonicalChatText(textInput);
  if (!text) return reject("invalid_request", "Chat text cannot be empty.");
  if (text.length > H2H_CHAT_MAX_LENGTH) {
    return reject(
      "invalid_request",
      `Chat text cannot exceed ${H2H_CHAT_MAX_LENGTH} characters.`,
    );
  }

  const chat = state.board.chat ?? { seq: 0, items: [] };
  if (chat.seq >= Number.MAX_SAFE_INTEGER) {
    return invalidBoard("chat.seq cannot be incremented safely.");
  }
  const item: ShareChatItem = {
    id: chat.seq + 1,
    ts: now,
    sender: userId,
    text,
  };
  const items = [...chat.items, item].slice(-H2H_CHAT_MAX_ITEMS);
  const nextState = createH2HCanonicalState(gameId, {
    ...state.board,
    chat: { seq: item.id, items },
    turnStartedAt: state.board.turnStartedAt ?? now,
    revision: nextRevision(state.revision),
    ...mutationTimestamps(state.board, now),
  });

  return { item: { ...item }, state: nextState };
}

/** True only for terminal outcomes that can legitimately start a rematch. */
export function isH2HRematchEligibleState(
  state: Pick<H2HCanonicalStateSnapshot, "ended" | "endedReason">,
): boolean {
  return (
    state.ended &&
    (state.endedReason === "game_over" || state.endedReason === "tie")
  );
}

/**
 * Resets a normally completed game while preserving its participants and
 * presentation.
 */
export function createH2HRematch(
  source: unknown,
  userId: string,
  gameIdInput: string,
  nowInput: number,
): H2HCanonicalStateSnapshot {
  const gameId = requireIdentifier(gameIdInput, "gameId");
  const now = requireNow(nowInput);
  const state = createH2HCanonicalState(gameId, source);
  requireParticipant(state.board, userId);
  if (!state.ended) {
    return reject("invalid_request", "Only an ended game can be rematched.");
  }
  if (!isH2HRematchEligibleState(state)) {
    return reject(
      "invalid_request",
      "Only a normally completed game can be rematched.",
    );
  }

  const timestamps = mutationTimestamps(state.board, now);
  const initial = createInitialH2HBoard(
    state.board.m_players[0].userId,
    state.board.m_players[1].userId,
    {
      ...(state.board.playerNames ? { names: state.board.playerNames } : {}),
      ...(state.board.playerAvatars
        ? { avatars: state.board.playerAvatars }
        : {}),
      now,
    },
  );
  return createH2HCanonicalState(gameId, {
    ...initial,
    revision: nextRevision(state.revision),
    createdAt: timestamps.createdAt,
    lastSaved: timestamps.lastSaved,
  });
}
