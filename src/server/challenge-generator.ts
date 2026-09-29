import { squareCatalog, type SquarePattern } from "../shared/game/geometry";
import { seededRandom, shuffled } from "../shared/game/random";
import {
  CHALLENGE_SIZE,
  CHALLENGE_VERSION,
  ChallengeError,
  readChallengeOptions,
  type ChallengeOptions,
  type ChallengePuzzle,
} from "../shared/challenge";

export interface CertifiedChallenge {
  puzzle: ChallengePuzzle;
  seed: string;
  solutions: number[][];
}

export const CHALLENGE_SEARCH_LIMITS = {
  candidates: 256,
  states: 1_000_000,
} as const;
export interface SearchBudget {
  remaining: number;
}
const tick = (budget: SearchBudget) => {
  if (--budget.remaining < 0)
    throw new ChallengeError(
      "search_limit",
      "Certification reached its search limit. Try another seed or simpler settings.",
    );
};

/** Enumerate unions of missing corners, stopping after distinct optimal sets. */
export function solveChallenge(
  initial: readonly number[],
  blocked: readonly number[],
  goal: number,
  maximumMoves: number,
  solutionLimit = 1,
  budget: SearchBudget = { remaining: CHALLENGE_SEARCH_LIMITS.states },
  size = CHALLENGE_SIZE,
): number[][] {
  const occupied = new Set(initial),
    forbidden = new Set(blocked);
  const squares = squareCatalog(size).filter((s) =>
    s.corners.every((p) => !forbidden.has(p)),
  );
  const already = squares.filter((s) =>
    s.corners.every((p) => occupied.has(p)),
  ).length;
  const needed = goal - already;
  if (needed <= 0) return [[]];
  const missing = squares
    .map((s) => s.corners.filter((p) => !occupied.has(p)))
    .filter((p) => p.length > 0 && p.length <= maximumMoves)
    .sort((a, b) => a.length - b.length);
  for (let moves = 1; moves <= maximumMoves; moves++) {
    const candidates = missing.filter((points) => points.length <= moves);
    const found = new Map<string, number[]>();
    const visited = new Set<string>();
    function search(start: number, count: number, union: Set<number>): void {
      tick(budget);
      if (count >= needed) {
        const points = [...union].sort((a, b) => a - b);
        found.set(points.join(","), points);
        return;
      }
      if (
        candidates.length - start < needed - count ||
        found.size >= solutionLimit
      )
        return;
      const key = `${start}:${count}:${[...union].sort((a, b) => a - b).join(",")}`;
      if (visited.has(key)) return;
      visited.add(key);
      for (
        let next = start;
        next < candidates.length && found.size < solutionLimit;
        next++
      ) {
        const combined = new Set([...union, ...candidates[next]!]);
        if (combined.size <= moves) search(next + 1, count + 1, combined);
      }
    }
    search(0, 0, new Set());
    if (found.size) return [...found.values()];
  }
  return [];
}

function fitsGeometry(
  square: SquarePattern,
  geometry: ChallengeOptions["geometry"],
): boolean {
  if (geometry === "aligned") return square.aligned;
  if (geometry === "tilted") return !square.aligned;
  if (geometry === "oblique") return square.oblique;
  return true;
}

/** Construct a witness, then certify the actual board rather than trusting it. */
export function generateChallenge(
  value: unknown,
  fallbackSeed: string,
  limits: { candidates: number; states: number } = CHALLENGE_SEARCH_LIMITS,
): CertifiedChallenge {
  const options = readChallengeOptions(value);
  const seed = options.seed ?? fallbackSeed;
  const random = seededRandom(seed);
  const catalog = squareCatalog(CHALLENGE_SIZE);
  const manual = new Set(options.blockedPoints);
  const eligible = catalog.filter(
    (s) =>
      fitsGeometry(s, options.geometry) &&
      s.corners.every((p) => !manual.has(p)),
  );
  if (eligible.length < options.targetSquares)
    throw new ChallengeError(
      "unavailable",
      "The blocked points leave too few squares with that geometry.",
    );
  const budget = { remaining: limits.states };
  for (let attempt = 0; attempt < limits.candidates; attempt++) {
    tick(budget);
    const anchor = Math.floor(random() * 64);
    const pool = shuffled(
      eligible.filter(
        (s) => !options.sharedCorner || s.corners.includes(anchor),
      ),
      random,
    );
    const family = pool.slice(0, options.targetSquares);
    if (family.length !== options.targetSquares) continue;
    if (
      options.geometry === "mixed" &&
      options.targetSquares > 1 &&
      (!family.some((s) => s.aligned) || !family.some((s) => !s.aligned))
    )
      continue;
    const corners = [...new Set(family.flatMap((s) => [...s.corners]))];
    if (corners.length < options.minimumMoves) continue;
    const removed = shuffled(corners, random).slice(0, options.minimumMoves);
    const initial = corners.filter((p) => !removed.includes(p));
    if (catalog.some((s) => s.corners.every((p) => initial.includes(p))))
      continue;
    const availableBlocks = shuffled(
      Array.from({ length: 64 }, (_, p) => p).filter(
        (p) => !corners.includes(p) && !manual.has(p),
      ),
      random,
    );
    if (availableBlocks.length < options.blockedCount - manual.size) continue;
    const blocked = [
      ...manual,
      ...availableBlocks.slice(0, options.blockedCount - manual.size),
    ].sort((a, b) => a - b);
    const solutions = solveChallenge(
      initial,
      blocked,
      options.targetSquares,
      options.minimumMoves,
      options.multipleSolutions ? 2 : 1,
      budget,
    );
    if (
      !solutions.length ||
      solutions[0]!.length !== options.minimumMoves ||
      (options.multipleSolutions && solutions.length < 2)
    )
      continue;
    return {
      puzzle: {
        version: CHALLENGE_VERSION,
        size: CHALLENGE_SIZE,
        initial: initial.sort((a, b) => a - b),
        blocked,
        minimumMoves: options.minimumMoves,
        targetSquares: options.targetSquares,
      },
      seed,
      solutions,
    };
  }
  throw new ChallengeError(
    "unavailable",
    "No certified puzzle was found for these settings. Try another seed or adjust the geometry, blocks, or counts.",
  );
}
