import { describe, expect, it } from "vitest";
import { squareCatalog } from "../shared/game/geometry";
import {
  CHALLENGE_GEOMETRIES,
  DEFAULT_CHALLENGE_OPTIONS,
  readChallengeOptions,
} from "../shared/challenge";
import { generateChallenge, solveChallenge } from "./challenge-generator";

/** Independent oracle: four equal sides and two equal diagonals. */
function oracleSquares(size: number): number[][] {
  const result: number[][] = [];
  for (let a = 0; a < size * size; a++)
    for (let b = a + 1; b < size * size; b++)
      for (let c = b + 1; c < size * size; c++)
        for (let d = c + 1; d < size * size; d++) {
          const points = [a, b, c, d],
            distances: number[] = [];
          for (let i = 0; i < 4; i++)
            for (let j = i + 1; j < 4; j++)
              distances.push(
                ((points[i]! % size) - (points[j]! % size)) ** 2 +
                  (Math.floor(points[i]! / size) -
                    Math.floor(points[j]! / size)) **
                    2,
              );
          distances.sort((x, y) => x - y);
          if (
            distances[0]! > 0 &&
            distances.slice(0, 4).every((n) => n === distances[0]) &&
            distances[4] === 2 * distances[0]! &&
            distances[5] === distances[4]
          )
            result.push(points);
        }
  return result;
}
const independent = oracleSquares(8);

describe("challenge certification", () => {
  it("matches independent 6x6 and 8x8 square catalogs", () => {
    for (const [size, count] of [
      [6, 105],
      [8, 336],
    ] as const) {
      const oracle = size === 8 ? independent : oracleSquares(size);
      expect(oracle).toHaveLength(count);
      expect(
        squareCatalog(size)
          .map((s) => s.id)
          .sort(),
      ).toEqual(oracle.map((s) => s.join("-")).sort());
    }
  });

  const cases = CHALLENGE_GEOMETRIES.flatMap((geometry) =>
    Array.from({ length: 4 }, (_, i) => i + 1).flatMap((minimumMoves) =>
      Array.from({ length: 4 }, (_, i) => ({
        geometry,
        minimumMoves,
        targetSquares: i + 1,
      })),
    ),
  );
  it.each(cases)(
    "certifies $geometry, $minimumMoves moves, $targetSquares squares",
    (config) => {
      const options = {
        ...DEFAULT_CHALLENGE_OPTIONS,
        ...config,
        blockedCount: 3,
        blockedPoints: [63],
        seed: `matrix-${config.geometry}-${config.minimumMoves}-${config.targetSquares}`,
      };
      const generated = generateChallenge(options, "unused");
      expect(generateChallenge(options, "different")).toEqual(generated);
      const { puzzle, solutions } = generated;
      expect(puzzle.blocked).toHaveLength(3);
      expect(puzzle.blocked).toContain(63);
      expect(puzzle.initial.some((p) => puzzle.blocked.includes(p))).toBe(
        false,
      );
      expect(
        independent.filter((s) => s.every((p) => puzzle.initial.includes(p))),
      ).toHaveLength(0);
      expect(solutions[0]).toHaveLength(config.minimumMoves);
      const occupied = new Set([...puzzle.initial, ...solutions[0]!]);
      expect(
        independent.filter((s) => s.every((p) => occupied.has(p))).length,
      ).toBeGreaterThanOrEqual(config.targetSquares);
      expect(solutions[0]!.some((p) => puzzle.blocked.includes(p))).toBe(false);
    },
  );

  it.each([2, 3, 4])(
    "has no shorter placement subset for a %i-move puzzle",
    (minimumMoves) => {
      const { puzzle } = generateChallenge(
        {
          ...DEFAULT_CHALLENGE_OPTIONS,
          minimumMoves,
          seed: `oracle-${minimumMoves}`,
        },
        "unused",
      );
      const occupied = new Set(puzzle.initial);
      const squares = independent.filter(
        (s) => !s.some((p) => puzzle.blocked.includes(p)),
      );
      const empty = Array.from({ length: 64 }, (_, p) => p).filter(
        (p) => !occupied.has(p) && !puzzle.blocked.includes(p),
      );
      function hasWin(start: number, left: number): boolean {
        if (
          squares.filter((s) => s.every((p) => occupied.has(p))).length >=
          puzzle.targetSquares
        )
          return true;
        if (!left) return false;
        for (let i = start; i < empty.length; i++) {
          const point = empty[i]!;
          occupied.add(point);
          const win = hasWin(i + 1, left - 1);
          occupied.delete(point);
          if (win) return true;
        }
        return false;
      }
      expect(hasWin(0, minimumMoves - 1)).toBe(false);
    },
  );

  it("certifies distinct optimal point sets, not move permutations", () => {
    const generated = generateChallenge(
      {
        ...DEFAULT_CHALLENGE_OPTIONS,
        minimumMoves: 4,
        targetSquares: 1,
        multipleSolutions: true,
        seed: "multiple",
      },
      "unused",
    );
    expect(generated.solutions).toHaveLength(2);
    expect(new Set(generated.solutions.map((s) => s.join(","))).size).toBe(2);
    const allButSquare = Array.from({ length: 64 }, (_, p) => p).filter(
      (p) => ![0, 1, 8, 9].includes(p),
    );
    expect(solveChallenge([], allButSquare, 1, 4, 2)).toEqual([[0, 1, 8, 9]]);
  });

  it("permits blocked edge/interior points, but never blocked corners", () => {
    expect(solveChallenge([0, 2, 16], [1, 9], 1, 1)).toContainEqual([18]);
    expect(solveChallenge([0, 2, 16], [18], 1, 1)).toEqual([]);
  });

  it("rejects invalid settings, impossible masks, and exhausted work", () => {
    for (const value of [0, 5, 1.5, NaN, "2"])
      expect(() =>
        readChallengeOptions({
          ...DEFAULT_CHALLENGE_OPTIONS,
          minimumMoves: value,
        }),
      ).toThrow();
    expect(() =>
      readChallengeOptions({
        ...DEFAULT_CHALLENGE_OPTIONS,
        blockedPoints: [3],
      }),
    ).toThrow();
    expect(() =>
      readChallengeOptions({
        ...DEFAULT_CHALLENGE_OPTIONS,
        blockedCount: 2,
        blockedPoints: [3, 3],
      }),
    ).toThrow();
    expect(() =>
      generateChallenge(
        {
          ...DEFAULT_CHALLENGE_OPTIONS,
          blockedCount: 60,
          blockedPoints: Array.from({ length: 60 }, (_, i) => i + 4),
        },
        "impossible",
      ),
    ).toThrow(/too few/);
    expect(() =>
      generateChallenge(DEFAULT_CHALLENGE_OPTIONS, "budget", {
        candidates: 256,
        states: 0,
      }),
    ).toThrow(/search limit/);
  });
});
