import { describe, expect, it } from "vitest";
import { squareHints } from "./board-geometry";

describe("potential square values", () => {
  it("labels one-move and two-move hints with footprint values", () => {
    const cells = Array<number>(64).fill(0);
    for (const index of [0, 3, 7]) cells[index] = 1;
    expect(squareHints(cells, 8, 8, 0, 1)).toContainEqual({
      index: 24,
      owner: 1,
      strength: "far",
      points: [16],
    });
    expect(squareHints(cells, 8, 8, 0, 1)).toContainEqual({
      index: 56,
      owner: 1,
      strength: "far",
      points: [64],
    });
    cells[24] = 1;
    expect(squareHints(cells, 8, 8, 0, 1)).toContainEqual({
      index: 27,
      owner: 1,
      strength: "near",
      points: [16],
    });
    cells[27] = 2;
    expect(
      squareHints(cells, 8, 8, 0, 1).some((hint) => hint.index === 27),
    ).toBe(false);
  });
});
