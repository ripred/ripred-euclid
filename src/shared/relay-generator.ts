import { EditionRuleError } from "./edition-contract";
import {
  SIZE,
  SQUARES,
  SQUARES_AT_POINT,
  solveRelayBoard,
  type RelayPuzzle,
} from "./relay-puzzle";

export type RelayDifficulty = "beginner" | "standard" | "expert";
export interface RelayGeneratorOptions {
  moves: number;
  goal: number;
  difficulty: RelayDifficulty;
  seed: string;
}

export const RELAY_GENERATOR_LIMITS = {
  minMoves: 1,
  maxMoves: 4,
  minGoal: 1,
  maxGoal: 4,
  maxSeedLength: 80,
  maxAttempts: 256,
} as const;

/** A stable local PRNG: identical settings and seed reproduce the same board. */
function randomSource(seed: string): () => number {
  let state = 2166136261;
  for (let index = 0; index < seed.length; index++) {
    state ^= seed.charCodeAt(index);
    state = Math.imul(state, 16777619);
  }
  return () => {
    state += 0x6d2b79f5;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value ^= value + Math.imul(value ^ (value >>> 7), 61 | value);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle<T>(items: readonly T[], random: () => number): T[] {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index--) {
    const other = Math.floor(random() * (index + 1));
    [result[index], result[other]] = [result[other]!, result[index]!];
  }
  return result;
}

export function readRelayGeneratorOptions(
  value: unknown,
): RelayGeneratorOptions {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new EditionRuleError("Choose generator settings.");
  const { moves, goal, difficulty, seed } = value as Record<string, unknown>;
  const limits = RELAY_GENERATOR_LIMITS;
  if (
    typeof moves !== "number" ||
    !Number.isInteger(moves) ||
    moves < limits.minMoves ||
    moves > limits.maxMoves ||
    typeof goal !== "number" ||
    !Number.isInteger(goal) ||
    goal < limits.minGoal ||
    goal > limits.maxGoal
  )
    throw new EditionRuleError(
      `Generated puzzles support ${limits.minMoves}–${limits.maxMoves} moves and ${limits.minGoal}–${limits.maxGoal} squares.`,
    );
  if (
    difficulty !== "beginner" &&
    difficulty !== "standard" &&
    difficulty !== "expert"
  )
    throw new EditionRuleError(
      "Choose beginner, standard, or expert difficulty.",
    );
  if (
    typeof seed !== "string" ||
    !seed.trim() ||
    seed.length > RELAY_GENERATOR_LIMITS.maxSeedLength
  )
    throw new EditionRuleError(
      `Use a nonempty puzzle seed of at most ${limits.maxSeedLength} characters.`,
    );
  return { moves, goal, difficulty, seed };
}

function cellsFor(initial: readonly number[]): number[] {
  const cells = Array<number>(SIZE * SIZE).fill(0);
  for (const point of initial) cells[point] = 1;
  return cells;
}

function hasSquare(cells: readonly number[]): boolean {
  return SQUARES.some((square) =>
    square.corners.every((point) => cells[point] === 1),
  );
}

function tilted(corners: readonly number[]): boolean {
  return new Set(corners.map((point) => point % SIZE)).size > 2;
}

/**
 * Construct fresh square families, remove the requested number of corners, then
 * prove that no shorter solution exists. Difficulty biases geometry and extra
 * starting points; it is not a calibrated human skill rating. Work is bounded.
 */
export function generateRelayPuzzle(
  value: RelayGeneratorOptions,
): RelayPuzzle & { generator: RelayGeneratorOptions } {
  const options = readRelayGeneratorOptions(value);
  const { moves, goal, difficulty, seed } = options;
  const random = randomSource(seed);
  for (
    let attempt = 0;
    attempt < RELAY_GENERATOR_LIMITS.maxAttempts;
    attempt++
  ) {
    const anchor = Math.floor(random() * SIZE * SIZE);
    const pool = shuffle(SQUARES_AT_POINT[anchor] ?? [], random);
    // Prefer clean aligned shapes at the entry level and tilted shapes for experts.
    const family = pool
      .filter((square) => difficulty !== "beginner" || !tilted(square.corners))
      .sort((a, b) =>
        difficulty === "expert"
          ? Number(tilted(b.corners)) - Number(tilted(a.corners))
          : 0,
      )
      .slice(0, goal);
    if (family.length !== goal) continue;
    if (
      difficulty === "expert" &&
      !family.some((square) => tilted(square.corners))
    )
      continue;
    const corners = [...new Set(family.flatMap((square) => square.corners))];
    const removed = new Set([
      anchor,
      ...shuffle(
        corners.filter((point) => point !== anchor),
        random,
      ).slice(0, moves - 1),
    ]);
    if (removed.size !== moves) continue;
    let initial = corners.filter((point) => !removed.has(point));
    const cells = cellsFor(initial);
    if (hasSquare(cells)) continue;
    let solution = solveRelayBoard(cells, goal, moves);
    if (!solution || solution.length !== moves) continue;

    const extraLimit =
      difficulty === "expert" ? 2 : difficulty === "standard" ? 1 : 0;
    let extraPoints = 0;
    const extras = shuffle(
      Array.from({ length: SIZE * SIZE }, (_, point) => point).filter(
        (point) => !corners.includes(point),
      ),
      random,
    );
    for (const point of extras) {
      if (extraPoints >= extraLimit) break;
      const candidate = [...initial, point];
      const candidateCells = cellsFor(candidate);
      if (hasSquare(candidateCells)) continue;
      const candidateSolution = solveRelayBoard(candidateCells, goal, moves);
      if (!candidateSolution || candidateSolution.length !== moves) continue;
      initial = candidate;
      solution = candidateSolution;
      extraPoints++;
    }
    const title = difficulty[0]!.toUpperCase() + difficulty.slice(1);
    return {
      name: `${title} connection`,
      description:
        initial.length === 0
          ? "An empty board: build a square from its four corners."
          : difficulty === "beginner"
            ? "Built from aligned square patterns. Find the missing connections."
            : difficulty === "standard"
              ? "Aligned and tilted patterns can appear, with extra starting points where possible."
              : "Built with tilted patterns and extra starting points where possible. Other routes may also work.",
      initial: initial.sort((a, b) => a - b),
      solution,
      moves,
      goal,
      generator: options,
    };
  }
  throw new EditionRuleError(
    "No puzzle fits these settings within the generation limit. Try another seed or change the move or square count.",
  );
}
