import { describe, expect, it } from "vitest";
import { Board, Player } from "../../shared/game/engine";
import { squareCatalog } from "../../shared/game/geometry";
import { scoringPreview, squareHints } from "./board-geometry";

describe("scoring preview", () => {
  it("matches accepted move scores and square counts for both colors and every finishing point", () => {
    for (const owner of [1, 2] as const) {
      for (let index = 0; index < 64; index++) {
        const board = new Board(new Player(), new Player(), { W: 8, H: 8 });
        board.m_turn = owner === 1 ? 0 : 1;
        // Multiple aligned and rotated squares can share the finishing point.
        for (const square of squareCatalog(8, 8)) {
          if (square.corners.includes(index)) {
            for (const corner of square.corners) {
              if (corner !== index) board.m_board[corner] = owner;
            }
          }
        }
        const before = [...board.m_board];
        const preview = scoringPreview(board.m_board, 8, 8, index, owner);
        expect(board.m_board).toEqual(before);
        expect(
          board.placePiece(board.pointAt(index % 8, Math.floor(index / 8))),
        ).toBe(preview.points);
        expect(board.m_players[owner - 1]!.m_squares).toHaveLength(
          preview.squares.length,
        );
      }
    }
  });

  it("excludes occupied points and squares blocked by the opponent", () => {
    const cells = [1, 1, 2, 0];
    expect(scoringPreview(cells, 2, 2, 3, 1).points).toBe(0);
    expect(scoringPreview([1, 1, 1, 2], 2, 2, 3, 1).squares).toEqual([]);
  });
});

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
