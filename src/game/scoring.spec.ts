import { describe, expect, it } from "vitest";

import {
  gridFootprintSideSpots,
  recommendedWinTarget,
  scoreGridFootprint,
  scoreSquareCorners,
  scoreTrueArea,
  totalSquareScore,
} from "./scoring";

const adjacentSquare = [
  { x: 0, y: 0 },
  { x: 1, y: 0 },
  { x: 1, y: 1 },
  { x: 0, y: 1 },
];

const straightThreeByThreeSquare = [
  { x: 0, y: 0 },
  { x: 2, y: 0 },
  { x: 2, y: 2 },
  { x: 0, y: 2 },
];

const rotatedThreeByThreeSquare = [
  { x: 1, y: 0 },
  { x: 2, y: 1 },
  { x: 1, y: 2 },
  { x: 0, y: 1 },
];

const supportedEvenSizes = [4, 6, 8, 10, 12, 14, 16] as const;

const expectedSquareBoardTotals = {
  bbox: [156, 1400, 6888, 24156, 68068, 164528, 354960],
  true: [52, 553, 3024, 11385, 33748, 84721, 188224],
} as const;

const expectedSquareBoardTargets = {
  bbox: [5, 30, 150, 526, 1482, 3583, 7730],
  true: [3, 27, 150, 565, 1674, 4202, 9337],
} as const;

describe("Grid Footprint scoring", () => {
  it("counts the occupied grid positions along each side", () => {
    expect(gridFootprintSideSpots(adjacentSquare)).toBe(2);
    expect(scoreGridFootprint(adjacentSquare)).toBe(4);
  });

  it("gives straight and rotated squares in the same footprint the same score", () => {
    expect(scoreGridFootprint(straightThreeByThreeSquare)).toBe(9);
    expect(scoreGridFootprint(rotatedThreeByThreeSquare)).toBe(9);
  });

  it("keeps True Area as the geometric side-squared alternative", () => {
    expect(scoreTrueArea(straightThreeByThreeSquare)).toBe(4);
    expect(scoreTrueArea(rotatedThreeByThreeSquare)).toBe(2);
  });

  it("routes the persisted bbox identifier to Grid Footprint scoring", () => {
    expect(scoreSquareCorners(rotatedThreeByThreeSquare, "bbox")).toBe(9);
    expect(scoreSquareCorners(rotatedThreeByThreeSquare, "true")).toBe(2);
  });
});

describe("board score totals", () => {
  it.each(["bbox", "true"] as const)(
    "calculates every supported square-board total in %s mode",
    (scoring) => {
      supportedEvenSizes.forEach((size, index) => {
        expect(totalSquareScore(size, size, scoring)).toBe(
          expectedSquareBoardTotals[scoring][index],
        );
      });
    },
  );

  it("rejects dimensions that cannot contain a square", () => {
    expect(() => totalSquareScore(1, 4, "bbox")).toThrow(RangeError);
    expect(() => totalSquareScore(4, 1, "bbox")).toThrow(RangeError);
    expect(() => totalSquareScore(4.5, 4, "bbox")).toThrow(RangeError);
  });
});

describe("recommended win targets", () => {
  it.each(["bbox", "true"] as const)(
    "scales every supported square board in %s mode",
    (scoring) => {
      supportedEvenSizes.forEach((size, index) => {
        expect(recommendedWinTarget(size, size, scoring)).toBe(
          expectedSquareBoardTargets[scoring][index],
        );
      });
    },
  );

  it("sets the 4x4 Grid Footprint floor strictly above one square", () => {
    expect(scoreGridFootprint(adjacentSquare)).toBe(4);
    expect(recommendedWinTarget(4, 4, "bbox")).toBe(5);
  });

  it("preserves the 8x8 first-to-150 baseline in both modes", () => {
    expect(recommendedWinTarget(8, 8, "bbox")).toBe(150);
    expect(recommendedWinTarget(8, 8, "true")).toBe(150);
  });

  it("stays above one scoring event and at or below best case", () => {
    for (const width of supportedEvenSizes) {
      for (const height of supportedEvenSizes) {
        for (const scoring of ["bbox", "true"] as const) {
          const target = recommendedWinTarget(width, height, scoring);
          const bestCase = totalSquareScore(width, height, scoring);
          const minimumEvent = scoreSquareCorners(adjacentSquare, scoring);

          expect(target).toBeGreaterThan(minimumEvent);
          expect(target).toBeLessThanOrEqual(bestCase);
        }
      }
    }
  });
});
