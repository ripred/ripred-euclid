import { squareCatalog } from "./edition-geometry";
import type { RelayGeneratorOptions } from "./relay-generator";

export const SIZE = 6;
export const SQUARES = squareCatalog(SIZE);
export const SQUARE_BY_ID = new Map(
  SQUARES.map((square) => [square.id, square]),
);
export const SQUARES_AT_POINT = Array.from(
  { length: SIZE * SIZE },
  (_, point) => SQUARES.filter((square) => square.corners.includes(point)),
);

/** Public puzzle data contains no solution witness. */
export interface RelayPuzzleDefinition {
  name: string;
  description: string;
  initial: readonly number[];
  goal: number;
  moves: number;
  generator?: RelayGeneratorOptions;
}

export interface RelayPuzzle extends RelayPuzzleDefinition {
  solution: readonly number[];
}

/** Exact bounded search shared by hinting and generator certification. */
export function solveRelayBoard(
  cells: readonly number[],
  needed: number,
  remaining: number,
): number[] | null {
  if (needed <= 0) return [];
  if (remaining <= 0) return null;
  const unfinished = SQUARES.map((square) =>
    square.corners.filter((corner) => cells[corner] === 0),
  )
    .filter((missing) => missing.length > 0 && missing.length <= remaining)
    .sort((a, b) => a.length - b.length);
  for (let budget = 1; budget <= remaining; budget++) {
    const candidates = unfinished.filter((missing) => missing.length <= budget);
    if (candidates.length < needed) continue;
    function search(
      index: number,
      count: number,
      missing: Set<number>,
    ): Set<number> | null {
      if (count >= needed) return missing;
      if (candidates.length - index < needed - count) return null;
      for (let next = index; next < candidates.length; next++) {
        const candidate = candidates[next];
        if (!candidate) continue;
        const union = new Set([...missing, ...candidate]);
        if (union.size > budget) continue;
        const result = search(next + 1, count + 1, union);
        if (result) return result;
      }
      return null;
    }
    const solution = search(0, 0, new Set());
    if (solution) return [...solution].sort((a, b) => a - b);
  }
  return null;
}
