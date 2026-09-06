import { EditionRuleError } from "./edition-contract";
import type {
  EditionDefinition,
  EditionState,
  Player,
} from "./edition-contract";
import { scoreGridFootprint } from "./scoring";

export const BOARD_SIZE = 8;
export type Spot = 0 | Player;
export interface PrismSquare {
  id: string;
  corners: number[];
  points: number;
}
export interface CompletedSquare extends PrismSquare {
  owner: Player;
}
export interface PrismMove {
  index: number;
  player: Player;
  points: number;
  squares: number;
}
export interface PrismState extends EditionState {
  board: Spot[];
  scores: [number, number];
  target: 75 | 150;
  completed: CompletedSquare[];
  history: PrismMove[];
}

/** Rotate every lattice edge by 90 degrees, then deduplicate its four corners. */
function enumerateSquares(): PrismSquare[] {
  const squares = new Map<string, PrismSquare>();
  for (let a = 0; a < 64; a++) {
    for (let b = 0; b < 64; b++) {
      if (a === b) continue;
      const x = a % BOARD_SIZE;
      const y = Math.floor(a / BOARD_SIZE);
      const bx = b % BOARD_SIZE;
      const by = Math.floor(b / BOARD_SIZE);
      const dx = bx - x;
      const dy = by - y;
      const points = [
        { x, y },
        { x: bx, y: by },
        { x: bx - dy, y: by + dx },
        { x: x - dy, y: y + dx },
      ];
      if (
        points.some(
          (p) => p.x < 0 || p.y < 0 || p.x >= BOARD_SIZE || p.y >= BOARD_SIZE,
        )
      )
        continue;
      const corners = points.map((p) => p.y * BOARD_SIZE + p.x);
      const id = [...corners].sort((left, right) => left - right).join("-");
      squares.set(id, { id, corners, points: scoreGridFootprint(points) });
    }
  }
  return [...squares.values()];
}

export const PRISM_SQUARES = enumerateSquares();
const squaresAt = Array.from({ length: 64 }, (_, index) =>
  PRISM_SQUARES.filter((square) => square.corners.includes(index)),
);

export function coordinate(index: number): string {
  return `${String.fromCharCode(65 + (index % BOARD_SIZE))}${Math.floor(index / BOARD_SIZE) + 1}`;
}

export function completionsAt(
  board: readonly Spot[],
  index: number,
  player: Player,
): PrismSquare[] {
  if (board[index] !== 0) return [];
  return (squaresAt[index] ?? []).filter((square) =>
    square.corners.every(
      (corner) => corner === index || board[corner] === player,
    ),
  );
}

export function createPrism(options: unknown = {}): PrismState {
  if (options === undefined || options === null) options = {};
  if (typeof options !== "object" || Array.isArray(options))
    throw new EditionRuleError("Choose a valid game length.");
  const settings = options as Record<string, unknown>;
  if (Object.keys(settings).some((key) => key !== "target"))
    throw new EditionRuleError("Unknown game setting.");
  const target = settings.target ?? 150;
  if (target !== 75 && target !== 150)
    throw new EditionRuleError("The target must be 75 or 150 points.");
  return {
    revision: 0,
    turn: 1,
    winner: null,
    board: Array<Spot>(64).fill(0),
    scores: [0, 0],
    target,
    completed: [],
    history: [],
  };
}

export function playPrism(state: PrismState, action: unknown): PrismState {
  if (state.winner !== null)
    throw new EditionRuleError(
      "This game is finished. Start a new game to play again.",
    );
  if (!action || typeof action !== "object" || Array.isArray(action))
    throw new EditionRuleError("Choose a point on the board.");
  const request = action as Record<string, unknown>;
  if (Object.keys(request).some((key) => key !== "index"))
    throw new EditionRuleError("A move contains only a point index.");
  const index = request.index;
  if (
    typeof index !== "number" ||
    !Number.isInteger(index) ||
    index < 0 ||
    index >= 64
  )
    throw new EditionRuleError("That point is outside the board.");
  if (state.board[index] !== 0)
    throw new EditionRuleError("That point is already claimed.");

  const player = state.turn;
  const squares = completionsAt(state.board, index, player);
  const points = squares.reduce((sum, square) => sum + square.points, 0);
  const board = [...state.board];
  board[index] = player;
  const scores: [number, number] = [...state.scores];
  scores[(player - 1) as 0 | 1] += points;
  // Resolve the winning move before handing the turn to the opponent.
  let winner: PrismState["winner"] =
    scores[(player - 1) as 0 | 1] >= state.target ? player : null;
  if (winner === null && board.every((spot) => spot !== 0)) {
    winner = scores[0] === scores[1] ? 0 : scores[0] > scores[1] ? 1 : 2;
  }
  return {
    ...state,
    board,
    scores,
    winner,
    turn: winner === null ? (player === 1 ? 2 : 1) : player,
    revision: state.revision + 1,
    completed: [
      ...state.completed,
      ...squares.map((square) => ({ ...square, owner: player })),
    ],
    history: [
      ...state.history,
      { index, player, points, squares: squares.length },
    ],
  };
}

/** Deterministic tactical play: finish, prevent a win, score, and build live threats. */
export function choosePrismMove(state: PrismState): { index: number } {
  if (state.winner !== null)
    throw new EditionRuleError("The game is finished.");
  const player = state.turn;
  const opponent = player === 1 ? 2 : 1;
  let bestIndex = -1;
  let bestValue = -Infinity;
  const opponentThreats = state.board.map((spot, index) =>
    spot === 0
      ? completionsAt(state.board, index, opponent).reduce(
          (sum, square) => sum + square.points,
          0,
        )
      : 0,
  );

  for (let index = 0; index < 64; index++) {
    if (state.board[index] !== 0) continue;
    const ownPoints = completionsAt(state.board, index, player).reduce(
      (sum, square) => sum + square.points,
      0,
    );
    const theirBestReply = Math.max(
      ...opponentThreats.map((points, at) => (at === index ? 0 : points)),
    );
    const wins =
      state.scores[(player - 1) as 0 | 1] + ownPoints >= state.target;
    const losesNext =
      state.scores[(opponent - 1) as 0 | 1] + theirBestReply >= state.target;
    let potential = 0;
    for (const square of squaresAt[index] ?? []) {
      const owners = square.corners.map((corner) => state.board[corner]);
      if (owners.includes(opponent)) continue;
      const owned = owners.filter((owner) => owner === player).length;
      potential += [0.04, 0.3, 2.2, 0][owned]! * Math.sqrt(square.points);
    }
    const centrality =
      7 - Math.abs((index % 8) - 3.5) - Math.abs(Math.floor(index / 8) - 3.5);
    const value =
      (wins ? 1_000_000 : 0) -
      (losesNext ? 100_000 : 0) +
      ownPoints * 12 -
      theirBestReply * 10 +
      potential +
      centrality * 0.12;
    if (value > bestValue) {
      bestValue = value;
      bestIndex = index;
    }
  }
  if (bestIndex < 0) throw new EditionRuleError("There are no empty points.");
  return { index: bestIndex };
}

export const edition: EditionDefinition<PrismState> = {
  id: "prism",
  create: createPrism,
  move: playPrism,
  chooseMove: choosePrismMove,
};
