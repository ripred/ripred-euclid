import { describe, expect, it } from "vitest";
import { nearestProjectedPoint } from "./prism-projection";

describe("projected board input", () => {
  const bounds = { left: 15, top: 210, width: 290, height: 270 };
  const points = [
    { x: 50, y: 12 },
    { x: 50, y: 18.5 },
  ];

  it("chooses the closest visible point inside overlapping mobile targets", () => {
    const upper = bounds.top + 0.12 * bounds.height;
    expect(nearestProjectedPoint(points, 160, upper + 7, bounds)).toBe(0);
    expect(nearestProjectedPoint(points, 160, upper + 12, bounds)).toBe(1);
  });

  it("measures screen pixels rather than percentages on a non-square board", () => {
    expect(
      nearestProjectedPoint(
        [
          { x: 10, y: 50 },
          { x: 50, y: 10 },
        ],
        100,
        10,
        { left: 0, top: 0, width: 1000, height: 100 },
      ),
    ).toBe(0);
  });

  it("returns no selection when there are no points", () => {
    expect(nearestProjectedPoint([], 160, 220, bounds)).toBe(-1);
  });
});
