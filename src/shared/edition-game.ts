import { EditionRuleError } from "./edition-contract";
import type { EditionDefinition, EditionState } from "./edition-contract";
import { coordinate, squareCatalog } from "./edition-geometry";

export const SIZE = 6;
export const SQUARES = squareCatalog(SIZE);
export const SQUARE_BY_ID = new Map(
  SQUARES.map((square) => [square.id, square]),
);
const squaresAtPoint = Array.from({ length: SIZE * SIZE }, (_, point) =>
  SQUARES.filter((square) => square.corners.includes(point)),
);

export interface RelayPuzzle {
  name: string;
  description: string;
  initial: readonly number[];
  solution: readonly number[];
  goal: number;
  moves: number;
}

function transform(point: number, turns: number, reflect: boolean): number {
  let x = point % SIZE;
  let y = Math.floor(point / SIZE);
  if (reflect) x = SIZE - 1 - x;
  for (let turn = 0; turn < turns; turn++) [x, y] = [SIZE - 1 - y, x];
  return y * SIZE + x;
}

function puzzle(
  name: string,
  description: string,
  initial: number[],
  solution: number[],
  goal: number,
  turns = 0,
  reflect = false,
): RelayPuzzle {
  return {
    name,
    description,
    initial: initial.map((point) => transform(point, turns, reflect)),
    solution: solution.map((point) => transform(point, turns, reflect)),
    goal,
    moves: solution.length,
  };
}

export const PUZZLES: readonly RelayPuzzle[] = [
  puzzle(
    "The meeting point",
    "Two unfinished squares. One corner in common.",
    [12, 0, 2, 16, 4],
    [14],
    2,
  ),
  puzzle(
    "A different angle",
    "A tilted square can hide in plain sight.",
    [12, 0, 2, 7, 9],
    [14],
    2,
    1,
  ),
  puzzle(
    "Set the stage",
    "Place a quiet first point. Let the second connect them.",
    [0, 2, 16, 4],
    [12, 14],
    2,
    0,
    true,
  ),
  puzzle(
    "Three meet",
    "Find the one point that brings three squares together.",
    [12, 0, 2, 16, 4, 7, 9],
    [14],
    3,
    2,
  ),
  puzzle(
    "The hidden thread",
    "Prepare one missing corner, then find the shared finish.",
    [12, 0, 2, 4, 7, 9],
    [16, 14],
    3,
    3,
  ),
  puzzle(
    "Across the board",
    "Three moves. Three squares. Look beyond your nearest neighbors.",
    [0, 3, 13, 2, 8, 4, 17],
    [18, 10, 21],
    3,
  ),
  puzzle(
    "Fourfold",
    "Build toward four squares that all finish in one move.",
    [12, 0, 2, 16, 4, 9],
    [7, 19, 14],
    4,
    1,
  ),
  puzzle(
    "The long relay",
    "Four deliberate points. One final connection.",
    [0, 4, 7, 9, 27, 10, 23],
    [12, 2, 16, 14],
    4,
    0,
    true,
  ),
];

export interface RelayState extends EditionState {
  level: number;
  cells: (0 | 1)[];
  placements: number[];
  completed: string[];
  lastSquares: string[];
  hint: { point: number | null; message: string } | null;
}

export function createRelay(options: unknown = {}): RelayState {
  if (!options || typeof options !== "object" || Array.isArray(options))
    throw new EditionRuleError("Choose a puzzle from the collection.");
  const level = "level" in options ? options.level : 0;
  if (
    typeof level !== "number" ||
    !Number.isInteger(level) ||
    level < 0 ||
    level >= PUZZLES.length
  )
    throw new EditionRuleError("That puzzle is not in the collection.");
  return replay(level, [], 0);
}

/** Reconstructing from the puzzle and placement history makes undo exact. */
function replay(
  level: number,
  placements: number[],
  revision: number,
): RelayState {
  const definition = PUZZLES[level];
  if (!definition)
    throw new EditionRuleError("That puzzle is not in the collection.");
  const cells: RelayState["cells"] = Array.from(
    { length: SIZE * SIZE },
    (_, point) => (definition.initial.includes(point) ? 1 : 0),
  );
  let completed: string[] = [];
  let lastSquares: string[] = [];
  for (const point of placements) {
    cells[point] = 1;
    lastSquares = (squaresAtPoint[point] ?? [])
      .filter((square) => square.corners.every((corner) => cells[corner] === 1))
      .map((square) => square.id);
    completed = [...completed, ...lastSquares];
  }
  const winner =
    lastSquares.length >= definition.goal
      ? 1
      : placements.length >= definition.moves
        ? 0
        : null;
  return {
    revision,
    turn: 1,
    winner,
    level,
    cells,
    placements,
    completed,
    lastSquares,
    hint: null,
  };
}

/**
 * A final point cannot complete a square before it is placed. Search combinations
 * of squares sharing that point, minimizing their missing-corner union. This is
 * bounded by four target squares and three setup placements, not game-tree depth.
 */
export function solveRelay(state: RelayState): number[] | null {
  if (state.winner === 1) return [];
  const definition = PUZZLES[state.level];
  if (!definition) return null;
  const goal = definition.goal;
  const remaining = definition.moves - state.placements.length;
  if (remaining <= 0) return null;
  for (let setupBudget = 0; setupBudget < remaining; setupBudget++) {
    for (let finalPoint = 0; finalPoint < SIZE * SIZE; finalPoint++) {
      if (state.cells[finalPoint] !== 0) continue;
      const candidates = (squaresAtPoint[finalPoint] ?? [])
        .map((square) =>
          square.corners.filter(
            (corner) => corner !== finalPoint && state.cells[corner] === 0,
          ),
        )
        .filter((missing) => missing.length <= setupBudget)
        .sort((a, b) => a.length - b.length);
      if (candidates.length < goal) continue;
      function search(
        index: number,
        count: number,
        missing: Set<number>,
      ): Set<number> | null {
        if (count >= goal) return missing;
        if (candidates.length - index < goal - count) return null;
        for (let next = index; next < candidates.length; next++) {
          const candidate = candidates[next];
          if (!candidate) continue;
          const union = new Set([...missing, ...candidate]);
          if (union.size > setupBudget) continue;
          const result = search(next + 1, count + 1, union);
          if (result) return result;
        }
        return null;
      }
      const setup = search(0, 0, new Set());
      if (setup) return [...setup].sort((a, b) => a - b).concat(finalPoint);
    }
  }
  return null;
}

export function moveRelay(state: RelayState, action: unknown): RelayState {
  if (!action || typeof action !== "object" || Array.isArray(action))
    throw new EditionRuleError("Choose a point or a puzzle action.");
  if ("type" in action && action.type === "undo") {
    if (state.placements.length === 0)
      throw new EditionRuleError("There is no move to undo.");
    return replay(
      state.level,
      state.placements.slice(0, -1),
      state.revision + 1,
    );
  }
  if (state.winner !== null)
    throw new EditionRuleError(
      state.winner === 1
        ? "Puzzle complete. Choose another puzzle or undo."
        : "No moves left. Undo or restart the puzzle.",
    );
  if ("type" in action && action.type === "hint") {
    const solution = solveRelay(state);
    const point = solution?.[0] ?? null;
    return {
      ...state,
      revision: state.revision + 1,
      hint: {
        point,
        message:
          point === null
            ? "No finish fits the moves left. Undo a point and try another route."
            : solution?.length === 1
              ? `Try ${coordinate(point)}. This point connects the squares.`
              : `Try ${coordinate(point)} as a setup point. Keep the final connection open.`,
      },
    };
  }
  if (
    !("point" in action) ||
    typeof action.point !== "number" ||
    !Number.isInteger(action.point) ||
    action.point < 0 ||
    action.point >= SIZE * SIZE
  )
    throw new EditionRuleError("Select a point on the board.");
  if ("type" in action) throw new EditionRuleError("Unknown puzzle action.");
  if (state.cells[action.point] !== 0)
    throw new EditionRuleError("That point is already in place.");
  return replay(
    state.level,
    [...state.placements, action.point],
    state.revision + 1,
  );
}

export const edition: EditionDefinition<RelayState> = {
  id: "relay",
  create: createRelay,
  move: moveRelay,
  chooseMove: (state) => {
    const point = solveRelay(state)?.[0];
    if (point === undefined)
      throw new EditionRuleError("Undo to find another route.");
    return { point };
  },
};
