import { describe, expect, it } from "vitest";
import {
  choosePrismMove,
  completionsAt,
  createPrism,
  playPrism,
  PRISM_SQUARES,
} from "./edition-game";
import { totalSquareScore } from "./scoring";

describe("PRISM rules", () => {
  it("enumerates every unique axis-aligned and rotated square", () => {
    expect(PRISM_SQUARES).toHaveLength(336);
    expect(new Set(PRISM_SQUARES.map((square) => square.id)).size).toBe(336);
    expect(PRISM_SQUARES.reduce((sum, square) => sum + square.points, 0)).toBe(
      totalSquareScore(8, 8, "bbox"),
    );
  });
  it("creates isolated state and validates settings", () => {
    const a = createPrism();
    const b = createPrism({ target: 75 });
    a.board[0] = 1;
    expect(b.board[0]).toBe(0);
    expect(b.target).toBe(75);
    for (const invalid of [1, [], { target: 2 }, { score: 1000 }])
      expect(() => createPrism(invalid)).toThrow();
  });
  it("rejects untrusted, occupied, and out-of-range actions without mutating state", () => {
    const state = playPrism(createPrism(), { index: 0 });
    for (const action of [
      null,
      [],
      { index: -1 },
      { index: 64 },
      { index: 1.2 },
      { index: "1" },
      { index: 0 },
      { index: 1, score: 1000 },
    ])
      expect(() => playPrism(state, action)).toThrow();
    expect(state.revision).toBe(1);
  });
  it("scores four adjacent corners once and alternates turns", () => {
    let state = createPrism();
    for (const index of [0, 63, 1, 62, 8, 61, 9])
      state = playPrism(state, { index });
    expect(state.scores).toEqual([4, 0]);
    expect(state.completed).toHaveLength(1);
    expect(state.turn).toBe(2);
  });
  it("recognizes rotated squares but not rectangles", () => {
    const state = createPrism();
    for (const index of [1, 8, 10]) state.board[index] = 1;
    expect(completionsAt(state.board, 17, 1)[0]?.points).toBe(9);
    state.board.fill(0);
    for (const index of [0, 1, 16]) state.board[index] = 1;
    expect(completionsAt(state.board, 17, 1)).toEqual([]);
  });
  it("credits multiple squares on one point and never advances past a win", () => {
    const state = createPrism({ target: 75 });
    for (const index of [0, 1, 8, 2, 10, 17, 18]) state.board[index] = 1;
    state.scores[0] = 74;
    const next = playPrism(state, { index: 9 });
    expect(next.history[0]?.squares).toBeGreaterThan(1);
    expect(next.winner).toBe(1);
    expect(next.turn).toBe(1);
    expect(() => playPrism(next, { index: 3 })).toThrow();
    expect(() => choosePrismMove(next)).toThrow();
    expect(state.board[9]).toBe(0);
  });
  it("takes an immediate win before blocking the opponent", () => {
    const state = createPrism({ target: 75 });
    for (const index of [0, 1, 8]) state.board[index] = 1;
    for (const index of [63, 62, 55]) state.board[index] = 2;
    state.scores = [74, 74];
    expect(choosePrismMove(state)).toEqual({ index: 9 });
  });
  it("blocks a losing reply when no winning move exists", () => {
    const state = createPrism({ target: 75 });
    for (const index of [63, 62, 55]) state.board[index] = 2;
    state.scores[1] = 74;
    expect(choosePrismMove(state)).toEqual({ index: 54 });
  });
  it("finishes full-board games by score, including a draw", () => {
    const state = createPrism();
    state.board.fill(2);
    state.board[0] = 0;
    state.scores = [0, 0];
    expect(playPrism(state, { index: 0 }).winner).toBe(0);
    state.scores = [10, 20];
    expect(playPrism(state, { index: 0 }).winner).toBe(2);
  });
  it("plays complete deterministic games without invalid or post-terminal moves", () => {
    let state = createPrism();
    while (state.winner === null)
      state = playPrism(state, choosePrismMove(state));
    expect(state.revision).toBeLessThanOrEqual(64);
    expect(state.board.filter(Boolean)).toHaveLength(state.revision);
    expect(state.scores[0]).toBe(
      state.completed
        .filter((square) => square.owner === 1)
        .reduce((sum, square) => sum + square.points, 0),
    );
    expect(state.scores[1]).toBe(
      state.completed
        .filter((square) => square.owner === 2)
        .reduce((sum, square) => sum + square.points, 0),
    );
  });
});
