import { describe, expect, it } from "vitest";

import type { BoardPoint, BoardSquare } from "./game/types";
import {
  formatScoreFeedback,
  formatSquareCount,
  gridFootprintBounds,
  scoreFeedbackForMove,
  scoreFeedbackId,
  selectSquareLines,
  squareSignature,
} from "./score-feedback";
import type { SoloMove } from "./solo/session";

const point = (x: number, y: number, width = 8): BoardPoint => ({
  x,
  y,
  index: x < 0 || y < 0 ? -1 : y * width + x,
});

const square = (
  corners: readonly [BoardPoint, BoardPoint, BoardPoint, BoardPoint],
  clr: 1 | 2,
  points = 4,
): BoardSquare => ({
  p1: corners[0],
  p2: corners[1],
  p3: corners[2],
  p4: corners[3],
  points,
  remain: 0,
  clr,
});

const firstSquare = square(
  [point(0, 0), point(1, 0), point(0, 1), point(1, 1)],
  1,
);
const secondSquare = square(
  [point(2, 0), point(3, 0), point(2, 1), point(3, 1)],
  2,
);

const move = (overrides: Partial<SoloMove>): SoloMove => ({
  moveNumber: 1,
  actor: "human",
  player: 0,
  point: point(1, 1),
  pointsScored: 0,
  completedSquares: [],
  washed: [],
  ...overrides,
});

describe("move score feedback", () => {
  it("describes a scoring move and ignores one that scores nothing", () => {
    expect(
      scoreFeedbackForMove(
        "game-one",
        move({
          moveNumber: 8,
          pointsScored: 4,
          completedSquares: [firstSquare],
        }),
        "bbox",
      ),
    ).toEqual(
      expect.objectContaining({
        id: "game-one:8",
        moveCount: 8,
        player: 0,
        pointsScored: 4,
      }),
    );
    expect(
      scoreFeedbackForMove("game-one", move({ moveNumber: 9 }), "bbox"),
    ).toBeNull();
  });

  it("gives each move its own id, so two scoring moves queue separately", () => {
    const human = scoreFeedbackForMove(
      "game-two",
      move({ moveNumber: 8, pointsScored: 4, completedSquares: [firstSquare] }),
      "bbox",
    );
    const euclid = scoreFeedbackForMove(
      "game-two",
      move({
        moveNumber: 9,
        actor: "euclid",
        player: 1,
        point: point(3, 1),
        pointsScored: 4,
        completedSquares: [secondSquare],
      }),
      "bbox",
    );
    expect(human?.id).toBe(scoreFeedbackId("game-two", 8));
    expect(euclid?.id).toBe(scoreFeedbackId("game-two", 9));
    expect(euclid?.player).toBe(1);
  });

  it("copies square data before it is queued", () => {
    const source = square(
      [point(0, 0), point(1, 0), point(0, 1), point(1, 1)],
      1,
    );
    const feedback = scoreFeedbackForMove(
      "game-copy",
      move({ moveNumber: 4, pointsScored: 4, completedSquares: [source] }),
      "bbox",
    );

    source.p1.x = 7;
    expect(feedback?.completedSquares[0]?.p1.x).toBe(0);
  });
});

describe("score presentation geometry and copy", () => {
  it("creates stable signatures regardless of corner ordering", () => {
    const reordered = square(
      [firstSquare.p4, firstSquare.p2, firstSquare.p1, firstSquare.p3],
      1,
    );
    expect(squareSignature(reordered)).toBe(squareSignature(firstSquare));
    expect(scoreFeedbackId("game", 12)).toBe("game:12");
  });

  it("returns footprint bounds only when the rule is Grid Footprint", () => {
    const rotated = square(
      [point(2, 0), point(4, 2), point(2, 4), point(0, 2)],
      1,
      25,
    );
    expect(gridFootprintBounds(rotated, "bbox")).toEqual({
      x: 0,
      y: 0,
      width: 5,
      height: 5,
    });
    expect(gridFootprintBounds(rotated, "true")).toBeNull();
  });

  it("uses singular and plural square copy", () => {
    expect(formatSquareCount(1)).toBe("1 square");
    expect(formatSquareCount(2)).toBe("2 squares");
    expect(
      formatScoreFeedback({
        pointsScored: 8,
        completedSquares: [firstSquare, secondSquare],
      }),
    ).toBe("+8 · 2 squares");
  });

  it("keeps active lines visible and out of the optional historical layer", () => {
    expect(
      selectSquareLines(
        [firstSquare, secondSquare, firstSquare],
        [secondSquare, secondSquare],
        true,
      ),
    ).toEqual({ historical: [firstSquare], active: [secondSquare] });
    expect(
      selectSquareLines([firstSquare, secondSquare], [secondSquare], false),
    ).toEqual({ historical: [], active: [secondSquare] });
  });
});
