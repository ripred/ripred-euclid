import { describe, expect, it } from "vitest";

import {
  gridFootprintSideSpots,
  scoreGridFootprint,
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

const expectedSquareBoardTotals = [
  156, 1400, 6888, 24156, 68068, 164528, 354960,
] as const;

describe("Grid Footprint scoring", () => {
  it("counts the occupied grid positions along each side", () => {
    expect(gridFootprintSideSpots(adjacentSquare)).toBe(2);
    expect(scoreGridFootprint(adjacentSquare)).toBe(4);
  });

  it("gives straight and rotated squares in the same footprint the same score", () => {
    expect(scoreGridFootprint(straightThreeByThreeSquare)).toBe(9);
    expect(scoreGridFootprint(rotatedThreeByThreeSquare)).toBe(9);
  });
});

describe("board score totals", () => {
  it("calculates every square-board total", () => {
    supportedEvenSizes.forEach((size, index) => {
      expect(totalSquareScore(size, size)).toBe(
        expectedSquareBoardTotals[index],
      );
    });
  });

  it("rejects dimensions that cannot contain a square", () => {
    expect(() => totalSquareScore(1, 4)).toThrow(RangeError);
    expect(() => totalSquareScore(4, 1)).toThrow(RangeError);
    expect(() => totalSquareScore(4.5, 4)).toThrow(RangeError);
  });
});
