import { EditionRuleError } from "./edition-contract";
import type { EditionDefinition, EditionState } from "./edition-contract";
import { coordinate } from "./edition-geometry";
import {
  generateRelayPuzzle,
  readRelayGeneratorOptions,
} from "./relay-generator";
import {
  SIZE,
  SQUARES,
  SQUARES_AT_POINT as squaresAtPoint,
  solveRelayBoard,
  type RelayPuzzle,
  type RelayPuzzleDefinition,
} from "./relay-puzzle";
export { SIZE, SQUARES, SQUARE_BY_ID } from "./relay-puzzle";
export type { RelayPuzzle, RelayPuzzleDefinition } from "./relay-puzzle";

const CURRENT_RULES_VERSION = 1;

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
    "Complete both squares in two placements. Either order works.",
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
    "Prepare a missing corner, then complete three squares.",
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
    "Build four squares within three placements.",
    [12, 0, 2, 16, 4, 9],
    [7, 19, 14],
    4,
    1,
  ),
  puzzle(
    "The long relay",
    "Four placements to uncover four squares.",
    [0, 4, 7, 9, 27, 10, 23],
    [12, 2, 16, 14],
    4,
    0,
    true,
  ),
];

export interface RelayState extends EditionState {
  /** Absent in sessions created before cumulative goals and generated puzzles. */
  rulesVersion?: number;
  level: number;
  generatedPuzzle?: RelayPuzzleDefinition;
  cells: (0 | 1)[];
  placements: number[];
  completed: string[];
  lastSquares: string[];
  /** Older saved sessions do not include this server-derived guidance yet. */
  canFinish?: boolean;
  hint: {
    point: number | null;
    message: string;
    /** Squares completed along the suggested plan; absent in older hints. */
    squares?: string[];
  } | null;
}

export function createRelay(options: unknown = {}): RelayState {
  if (!options || typeof options !== "object" || Array.isArray(options))
    throw new EditionRuleError("Choose a puzzle from the collection.");
  if ("generator" in options) {
    const settings = options.generator;
    if (!settings || typeof settings !== "object" || Array.isArray(settings))
      throw new EditionRuleError("Choose generator settings.");
    const generated = generateRelayPuzzle(
      readRelayGeneratorOptions({
        ...settings,
        seed:
          "seed" in settings ? settings.seed : globalThis.crypto.randomUUID(),
      }),
    );
    // Retain enough data to resume and restart, without publishing the answer.
    const definition: RelayPuzzleDefinition = {
      name: generated.name,
      description: generated.description,
      initial: generated.initial,
      moves: generated.moves,
      goal: generated.goal,
      generator: generated.generator,
    };
    return replay(0, [], 0, definition);
  }
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

export function relayPuzzle(state: RelayState): RelayPuzzleDefinition {
  const definition = state.generatedPuzzle ?? PUZZLES[state.level];
  if (!definition)
    throw new EditionRuleError("That puzzle is not in the collection.");
  return definition;
}

/** Reconstructing from the puzzle and placement history makes undo exact. */
function replay(
  level: number,
  placements: number[],
  revision: number,
  generatedPuzzle?: RelayPuzzleDefinition,
): RelayState {
  const definition = generatedPuzzle ?? PUZZLES[level];
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
    completed.length >= definition.goal
      ? 1
      : placements.length >= definition.moves
        ? 0
        : null;
  const state: RelayState = {
    rulesVersion: CURRENT_RULES_VERSION,
    revision,
    turn: 1,
    winner,
    level,
    ...(generatedPuzzle ? { generatedPuzzle } : {}),
    cells,
    placements,
    completed,
    lastSquares,
    hint: null,
  };
  return { ...state, canFinish: solveRelay(state) !== null };
}

/**
 * Complete the remaining goal with the smallest union of missing square corners.
 * Squares count across the whole attempt, so no shared finishing point or move
 * order is required. The collection bounds this search to four placements.
 */
export function solveRelay(state: RelayState): number[] | null {
  if (state.winner === 1) return [];
  const definition = relayPuzzle(state);
  return solveRelayBoard(
    state.cells,
    definition.goal - state.completed.length,
    definition.moves - state.placements.length,
  );
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
      state.generatedPuzzle,
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
    const plannedPoints = new Set(solution);
    const squares = SQUARES.filter(
      (square) =>
        square.corners.some((corner) => plannedPoints.has(corner)) &&
        square.corners.every(
          (corner) => state.cells[corner] === 1 || plannedPoints.has(corner),
        ),
    ).map((square) => square.id);
    const nextSquares =
      point === null
        ? 0
        : (squaresAtPoint[point] ?? []).filter((square) =>
            square.corners.every(
              (corner) => corner === point || state.cells[corner] === 1,
            ),
          ).length;
    const needed = relayPuzzle(state).goal - state.completed.length;
    const afterNext = Math.max(0, needed - nextSquares);
    const reward = `${nextSquares} new ${nextSquares === 1 ? "square" : "squares"}`;
    return {
      ...state,
      revision: state.revision + 1,
      canFinish: solution !== null,
      hint: {
        point,
        squares,
        message:
          point === null
            ? "No finish fits the moves left. Undo a point and try another route."
            : nextSquares === 0
              ? `Try ${coordinate(point)} as a setup point toward the ${needed} remaining ${needed === 1 ? "square" : "squares"}.`
              : afterNext === 0
                ? `Try ${coordinate(point)} to complete ${reward} and finish the puzzle.`
                : `Try ${coordinate(point)} to complete ${reward}. ${afterNext} more ${afterNext === 1 ? "square" : "squares"} will remain.`,
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
    state.generatedPuzzle,
  );
}

/** Upgrade persisted rules and guidance without inventing another player move. */
export function reconcileRelay(state: RelayState): RelayState {
  // Persisted state is server-owned; current saves need no repeated search.
  if (state.rulesVersion === CURRENT_RULES_VERSION) return state;
  let reconciled = {
    ...state,
    ...replay(
      state.level,
      [...state.placements],
      state.revision,
      state.generatedPuzzle,
    ),
  };
  if (state.hint && reconciled.winner === null) {
    reconciled = {
      ...moveRelay(reconciled, { type: "hint" }),
      revision: state.revision,
    };
  }
  return JSON.stringify(reconciled) === JSON.stringify(state)
    ? state
    : reconciled;
}

export const edition: EditionDefinition<RelayState> = {
  id: "relay",
  create: createRelay,
  move: moveRelay,
  reconcile: reconcileRelay,
  spectatorState: (state) => {
    const visible = { ...state, hint: null };
    delete visible.canFinish;
    return visible;
  },
  chooseMove: (state) => {
    const point = solveRelay(state)?.[0];
    if (point === undefined)
      throw new EditionRuleError("Undo to find another route.");
    return { point };
  },
};
