import { Board, Player, type RandomSource } from "../game/engine";
import {
  PLAY_STYLES,
  RANKED_SOLO_RULES,
  SOLO_RULES_VERSION,
  playStyleForDifficulty,
  validatePracticeRules,
  type GameOutcome,
  type PlayerColor,
  type PlayerIndex,
  type PracticeRules,
  type RankedSoloRules,
} from "../game/rules";
import type { BoardPoint, BoardSquare, SerializableBoard } from "../game/types";

/**
 * One game against Euclid, played entirely in the browser. The engine and
 * Euclid's move policy are the shared rules code; this module only sequences
 * turns, records moves and decides how a game ends.
 */

export type SoloGameRules = RankedSoloRules | PracticeRules;
export type SoloStatus = "active" | "completed" | "abandoned";
export type SoloEndReason =
  | "score_target"
  | "board_full"
  | "move_limit"
  | "abandoned";

export interface SoloGame {
  id: string;
  rules: SoloGameRules;
  /** Plain-data board for rendering and saving; never mutated in place. */
  board: SerializableBoard;
  status: SoloStatus;
  outcome: GameOutcome;
  endedReason: SoloEndReason | null;
  humanMoves: number;
  startedAt: number;
  updatedAt: number;
  /** Set once the result has been added to the player's records. */
  settled: boolean;
  /** Ranked games keep the rating change they produced. */
  rating?: { before: number; after: number };
}

export interface SoloMove {
  /** 1-based position in the game's move history. */
  moveNumber: number;
  actor: "human" | "euclid";
  player: PlayerIndex;
  point: BoardPoint;
  pointsScored: number;
  completedSquares: BoardSquare[];
  /** Fading pieces: stones that washed away after this move. */
  washed: Array<BoardPoint & { owner: PlayerColor }>;
}

const HUMAN_ID = "you";
const EUCLID_ID = "euclid";

const toPlain = (engine: Board): SerializableBoard =>
  JSON.parse(JSON.stringify(engine.toJSON())) as SerializableBoard;

function createEngine(rules: SoloGameRules, rng: RandomSource): Board {
  const euclid: PlayerIndex = rules.humanPlayer === 0 ? 1 : 0;
  const players: [Player, Player] = [
    new Player(PLAY_STYLES.OFFENSIVE, false, HUMAN_ID),
    new Player(PLAY_STYLES.OFFENSIVE, false, HUMAN_ID),
  ];
  players[euclid] = new Player(
    playStyleForDifficulty(rules.difficulty),
    true,
    EUCLID_ID,
  );
  const engine = new Board(players[0], players[1], {
    W: rules.W,
    H: rules.H,
    scoring: rules.scoring,
    winScore: rules.winScore,
    rng,
    fadeTurns: rules.fadeTurns,
  });
  engine.m_turn = rules.firstPlayer;
  return engine;
}

function endReason(engine: Board, outcome: GameOutcome): SoloEndReason | null {
  if (outcome.status === "running") return null;
  if (engine.m_players.some((player) => player.m_score >= engine.winScore)) {
    return "score_target";
  }
  return engine.m_board.every(Boolean) ? "board_full" : "move_limit";
}

/** Places the piece for whoever is on turn and reports what it completed. */
function placeForTurn(engine: Board, x: number, y: number): SoloMoveCore {
  const player = engine.m_turn;
  const mover = engine.m_players[player];
  const before = mover.m_squares.length;
  mover.m_lastNumSquares = 0;
  const point = engine.pointAt(x, y);
  const pointsScored = engine.placePiece(point);
  engine.m_lastPoints = pointsScored;
  const washed = engine
    .expireStones()
    .map(({ point: { x, y, index }, owner }) => ({ x, y, index, owner }));
  engine.advanceTurn();
  return {
    washed,
    player,
    point: { x: point.x, y: point.y, index: point.index },
    pointsScored,
    completedSquares: mover.m_squares.slice(before).map((square) => ({
      p1: { ...square.p1 },
      p2: { ...square.p2 },
      p3: { ...square.p3 },
      p4: { ...square.p4 },
      points: square.points,
      remain: square.remain,
      clr: square.clr,
    })),
  };
}

type SoloMoveCore = Omit<SoloMove, "moveNumber" | "actor">;

function withEngine(
  game: SoloGame,
  engine: Board,
  now: number,
  humanMoves: number,
): SoloGame {
  const outcome = engine.getOutcome();
  const reason = endReason(engine, outcome);
  return {
    ...game,
    board: toPlain(engine),
    status: reason ? "completed" : "active",
    outcome,
    endedReason: reason,
    humanMoves,
    updatedAt: now,
  };
}

export function createSoloGame(
  rules: SoloGameRules,
  { id, now }: { id: string; now: number },
): SoloGame {
  const engine = createEngine(rules, Math.random);
  return {
    id,
    rules: { ...rules },
    board: toPlain(engine),
    status: "active",
    outcome: engine.getOutcome(),
    endedReason: null,
    humanMoves: 0,
    startedAt: now,
    updatedAt: now,
    settled: false,
  };
}

export const isHumanTurn = (game: SoloGame) =>
  game.status === "active" && game.board.m_turn === game.rules.humanPlayer;

export const isEuclidTurn = (game: SoloGame) =>
  game.status === "active" && game.board.m_turn !== game.rules.humanPlayer;

/** The player's move, or null when it is not their turn or the point is taken. */
export function playHumanMove(
  game: SoloGame,
  x: number,
  y: number,
  now: number,
): { game: SoloGame; move: SoloMove } | null {
  if (!isHumanTurn(game)) return null;
  const { W, H, m_board } = game.board;
  if (!Number.isInteger(x) || !Number.isInteger(y)) return null;
  if (x < 0 || y < 0 || x >= W || y >= H || m_board[y * W + x] !== 0) {
    return null;
  }
  const engine = Board.fromJSON(game.board, Math.random);
  const core = placeForTurn(engine, x, y);
  return {
    game: withEngine(game, engine, now, game.humanMoves + 1),
    move: { ...core, moveNumber: engine.m_history.length, actor: "human" },
  };
}

/** Euclid chooses and plays its move with the shared move policy. */
export function playEuclidMove(
  game: SoloGame,
  now: number,
  rng: RandomSource = Math.random,
): { game: SoloGame; move: SoloMove } | null {
  if (!isEuclidTurn(game)) return null;
  // The same engine chooses and plays, so Euclid keeps its target memory.
  const engine = Board.fromJSON(game.board, rng);
  const choice = engine.findBestMove();
  const core = placeForTurn(engine, choice.x, choice.y);
  return {
    game: withEngine(game, engine, now, game.humanMoves),
    move: { ...core, moveNumber: engine.m_history.length, actor: "euclid" },
  };
}

/**
 * Leaving an active game. After the first move a Ranked game is forfeited
 * to Euclid, so leaving can never erase a losing position.
 */
export function abandonSoloGame(game: SoloGame, now: number): SoloGame {
  if (game.status !== "active") return game;
  const euclidWins: GameOutcome =
    game.rules.humanPlayer === 0
      ? { state: 2, status: "player2_win", winner: 2 }
      : { state: 1, status: "player1_win", winner: 1 };
  return {
    ...game,
    status: "abandoned",
    outcome: countsAsForfeit(game) ? euclidWins : game.outcome,
    endedReason: "abandoned",
    updatedAt: now,
  };
}

export const countsAsForfeit = (game: SoloGame) =>
  game.rules.mode === "ranked" && game.humanMoves > 0;

/** 1 for a win, 0.5 for a tie, 0 for a loss, null when nothing counts. */
export function humanResult(game: SoloGame): 1 | 0.5 | 0 | null {
  if (game.status === "active") return null;
  if (game.status === "abandoned" && !countsAsForfeit(game)) return null;
  const human = game.rules.humanPlayer === 0 ? 1 : 2;
  if (game.outcome.status === "tie") return 0.5;
  return game.outcome.winner === human ? 1 : 0;
}

/* Saving and resuming ----------------------------------------------------- */

const SAVE_VERSION = 1;

export interface SavedSoloGame {
  v: typeof SAVE_VERSION;
  id: string;
  rules: SoloGameRules;
  moves: Array<[number, number]>;
  targets: Array<string | null>;
  humanMoves: number;
  startedAt: number;
  updatedAt: number;
}

export function saveSoloGame(game: SoloGame): SavedSoloGame {
  return {
    v: SAVE_VERSION,
    id: game.id,
    rules: game.rules,
    moves: game.board.m_history.map((point) => [point.x, point.y]),
    targets: [...(game.board.m_targets ?? [null, null])],
    humanMoves: game.humanMoves,
    startedAt: game.startedAt,
    updatedAt: game.updatedAt,
  };
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);

function restoreRules(value: unknown): SoloGameRules | null {
  if (!isRecord(value)) return null;
  if (value.mode === "ranked") {
    const ranked = RANKED_SOLO_RULES as unknown as Record<string, unknown>;
    return Object.keys(ranked).every((key) => value[key] === ranked[key])
      ? RANKED_SOLO_RULES
      : null;
  }
  if (value.mode !== "practice" || value.rulesVersion !== SOLO_RULES_VERSION) {
    return null;
  }
  try {
    const {
      W,
      H,
      scoring,
      winScore,
      difficulty,
      humanPlayer,
      firstPlayer,
      fadeTurns,
    } = value;
    return validatePracticeRules({
      W,
      H,
      scoring,
      winScore,
      difficulty,
      humanPlayer,
      firstPlayer,
      fadeTurns,
    });
  } catch {
    return null;
  }
}

const isTimestamp = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

/**
 * Rebuilds a saved game by replaying its moves through the engine. Anything
 * that does not replay to a legal, unfinished game is discarded.
 */
export function restoreSoloGame(value: unknown): SoloGame | null {
  if (!isRecord(value) || value.v !== SAVE_VERSION) return null;
  const rules = restoreRules(value.rules);
  const { id, moves, targets, startedAt, updatedAt } = value;
  if (
    !rules ||
    typeof id !== "string" ||
    !id ||
    !Array.isArray(moves) ||
    !isTimestamp(startedAt) ||
    !isTimestamp(updatedAt)
  ) {
    return null;
  }

  const engine = createEngine(rules, Math.random);
  let humanMoves = 0;
  for (const move of moves) {
    if (engine.getOutcome().status !== "running") return null;
    if (!Array.isArray(move) || move.length !== 2) return null;
    const [x, y] = move as unknown[];
    if (
      typeof x !== "number" ||
      typeof y !== "number" ||
      !Number.isInteger(x) ||
      !Number.isInteger(y) ||
      x < 0 ||
      y < 0 ||
      x >= rules.W ||
      y >= rules.H ||
      engine.m_board[y * rules.W + x] !== 0
    ) {
      return null;
    }
    if (engine.m_turn === rules.humanPlayer) humanMoves++;
    placeForTurn(engine, x, y);
  }
  if (engine.getOutcome().status !== "running") return null;
  if (
    Array.isArray(targets) &&
    targets.length === 2 &&
    targets.every((target) => target === null || typeof target === "string")
  ) {
    engine.m_targets = [targets[0] ?? null, targets[1] ?? null];
  }

  return {
    id,
    rules,
    board: toPlain(engine),
    status: "active",
    outcome: engine.getOutcome(),
    endedReason: null,
    humanMoves,
    startedAt,
    updatedAt,
    settled: false,
  };
}
