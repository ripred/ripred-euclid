import { EditionRuleError } from "./edition-contract";
import type {
  EditionDefinition,
  EditionState,
  Player,
} from "./edition-contract";
import { squareCatalog, type SquarePattern } from "./edition-geometry";

export const TIDE_SIZE = 6;
export const STONE_LIFETIME = 12;
export const TIDE_SQUARES = squareCatalog(TIDE_SIZE);
export interface TideSquare extends SquarePattern {
  owner: Player;
}
export interface TideEvent {
  point: number;
  player: Player;
  points: number;
  squares: string[];
  washed: number[];
}
export interface TideState extends EditionState {
  board: number[];
  expires: number[];
  anchored: boolean[];
  scores: [number, number];
  squares: TideSquare[];
  history: TideEvent[];
  target: number;
  moveLimit: number;
}

function create(options: unknown): TideState {
  if (
    options !== undefined &&
    options !== null &&
    (typeof options !== "object" || Array.isArray(options))
  )
    throw new EditionRuleError("Choose a valid game length.");
  const target = options && "target" in options ? options.target : 60;
  if (target !== 40 && target !== 60 && target !== 90)
    throw new EditionRuleError("Choose 40, 60, or 90 points.");
  return {
    revision: 0,
    turn: 1,
    winner: null,
    board: Array<number>(36).fill(0),
    expires: Array<number>(36).fill(0),
    anchored: Array<boolean>(36).fill(false),
    scores: [0, 0],
    squares: [],
    history: [],
    target,
    moveLimit: 60,
  };
}

function move(state: TideState, action: unknown): TideState {
  if (state.winner !== null)
    throw new EditionRuleError("The tide has settled. Start a new game.");
  const point =
    action && typeof action === "object" && "point" in action
      ? action.point
      : null;
  if (
    typeof point !== "number" ||
    !Number.isInteger(point) ||
    point < 0 ||
    point >= 36
  )
    throw new EditionRuleError("Choose a point on the board.");
  if (state.board[point] !== 0)
    throw new EditionRuleError("That point is already occupied.");
  const next: TideState = {
    ...state,
    board: [...state.board],
    expires: [...state.expires],
    anchored: [...state.anchored],
    scores: [...state.scores],
    squares: [...state.squares],
    history: [...state.history],
    revision: state.revision + 1,
  };
  const player = state.turn;
  next.board[point] = player;
  next.expires[point] = state.revision + STONE_LIFETIME;
  const owned = new Set(state.squares.map((square) => square.id));
  const completed = TIDE_SQUARES.filter(
    (square) =>
      !owned.has(square.id) &&
      square.corners.includes(point) &&
      square.corners.every((corner) => next.board[corner] === player),
  );
  let points = 0;
  for (const square of completed) {
    points += square.points;
    next.squares.push({ ...square, owner: player });
    for (const corner of square.corners) next.anchored[corner] = true;
  }
  next.scores[(player - 1) as 0 | 1] += points;
  const washed: number[] = [];
  if (next.scores[(player - 1) as 0 | 1] >= next.target) next.winner = player;
  if (next.winner === null) {
    for (let i = 0; i < next.board.length; i++) {
      if (
        next.board[i] !== 0 &&
        !next.anchored[i] &&
        next.expires[i]! <= next.revision
      ) {
        next.board[i] = 0;
        next.expires[i] = 0;
        washed.push(i);
      }
    }
    if (next.revision >= next.moveLimit || next.board.every(Boolean)) {
      next.winner =
        next.scores[0] === next.scores[1]
          ? 0
          : next.scores[0] > next.scores[1]
            ? 1
            : 2;
    }
  }
  next.history.push({
    point,
    player,
    points,
    squares: completed.map((square) => square.id),
    washed,
  });
  next.turn = next.winner === null ? (player === 1 ? 2 : 1) : player;
  return next;
}

function buildValue(state: TideState, player: Player): number {
  let result = 0;
  for (const square of TIDE_SQUARES) {
    if (
      square.corners.some(
        (corner) => state.board[corner] !== 0 && state.board[corner] !== player,
      )
    )
      continue;
    const count = square.corners.filter(
      (corner) => state.board[corner] === player,
    ).length;
    if (count === 0 || count === 4) continue;
    const missing = 4 - count;
    // A tempting square is not a plan if its oldest corner washes away first.
    const viable = square.corners.every(
      (corner) =>
        !state.board[corner] ||
        state.anchored[corner] ||
        state.expires[corner]! - state.revision >= missing * 2 - 1,
    );
    if (viable) result += square.points * [0, 0.08, 0.7, 3][count]!;
  }
  return result;
}

function chooseMove(state: TideState): { point: number } {
  if (state.winner !== null) throw new EditionRuleError("This game is over.");
  const player = state.turn,
    other: Player = player === 1 ? 2 : 1;
  let best = -Infinity,
    choice = -1;
  for (let point = 0; point < 36; point++) {
    if (state.board[point] !== 0) continue;
    const next = move(state, { point });
    const block = move({ ...state, turn: other }, { point });
    const gain = next.scores[player - 1]! - state.scores[player - 1]!;
    const denied = block.scores[other - 1]! - state.scores[other - 1]!;
    const centrality =
      5 - Math.abs((point % 6) - 2.5) - Math.abs(Math.floor(point / 6) - 2.5);
    const value =
      (next.winner === player ? 1e7 : 0) +
      (block.winner === other ? 1e6 : 0) +
      gain * 15 +
      denied * 12 +
      buildValue(next, player) -
      buildValue(next, other) * 0.8 +
      centrality * 0.05;
    if (value > best) {
      best = value;
      choice = point;
    }
  }
  if (choice < 0) throw new EditionRuleError("No empty points remain.");
  return { point: choice };
}

export const edition: EditionDefinition<TideState> = {
  id: "tide",
  create,
  move,
  chooseMove,
};
