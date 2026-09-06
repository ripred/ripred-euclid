import { describe, expect, it } from "vitest";
import {
  PUZZLES,
  SIZE,
  SQUARES,
  createRelay,
  moveRelay,
  solveRelay,
} from "./edition-game";

describe("Relay puzzle collection", () => {
  it("provides eight distinct empty-of-squares starting layouts", () => {
    expect(PUZZLES).toHaveLength(8);
    expect(
      new Set(
        PUZZLES.map((puzzle) =>
          [...puzzle.initial].sort((a, b) => a - b).join(","),
        ),
      ).size,
    ).toBe(8);
    for (const [level, puzzle] of PUZZLES.entries()) {
      const state = createRelay({ level });
      expect(state.cells).toHaveLength(SIZE * SIZE);
      expect(state.placements).toEqual([]);
      expect(state.completed).toEqual([]);
      expect(state.winner).toBeNull();
      expect(puzzle.moves).toBe(puzzle.solution.length);
      expect(
        SQUARES.filter((square) =>
          square.corners.every((corner) => state.cells[corner]),
        ),
      ).toHaveLength(0);
      expect(new Set(puzzle.initial).size).toBe(puzzle.initial.length);
      expect(
        puzzle.initial.every((point) => point >= 0 && point < SIZE * SIZE),
      ).toBe(true);
    }
  });

  it.each(PUZZLES.map((puzzle, level) => ({ name: puzzle.name, level })))(
    "solves $name with its verified intended sequence",
    ({ level }) => {
      const puzzle = PUZZLES[level]!;
      let state = createRelay({ level });
      for (const point of puzzle.solution) {
        expect(state.winner).toBeNull();
        const previous = state;
        state = moveRelay(state, { point });
        expect(previous.cells[point]).toBe(0);
      }
      expect(state.winner).toBe(1);
      expect(state.lastSquares.length).toBeGreaterThanOrEqual(puzzle.goal);
      expect(state.revision).toBe(puzzle.moves);
    },
  );

  it("requires all four placements for the collection finale", () => {
    const solution = solveRelay(createRelay({ level: 7 }));
    expect(solution).toHaveLength(4);
  });

  it.each(PUZZLES.map((puzzle, level) => ({ name: puzzle.name, level })))(
    "finds a live solution for $name",
    ({ level }) => {
      let state = createRelay({ level });
      const solution = solveRelay(state);
      expect(solution).not.toBeNull();
      expect(solution!.length).toBeLessThanOrEqual(PUZZLES[level]!.moves);
      for (const point of solution!) {
        if (state.winner !== null) break;
        state = moveRelay(state, { point });
      }
      expect(state.winner).toBe(1);
    },
  );
});

describe("Relay command validation and history", () => {
  it.each([
    null,
    [],
    { level: -1 },
    { level: 8 },
    { level: 0.1 },
    { level: "0" },
    { level: NaN },
  ])("rejects invalid puzzle options %j", (options) => {
    expect(() => createRelay(options)).toThrow();
  });

  it.each([
    null,
    [],
    {},
    { point: -1 },
    { point: 36 },
    { point: 0.5 },
    { point: "14" },
    { point: NaN },
    { type: "change" },
    { type: "change", point: 14 },
  ])("rejects invalid actions %j", (action) => {
    expect(() => moveRelay(createRelay(), action)).toThrow();
  });

  it("rejects occupied points and does not mutate earlier state", () => {
    const state = createRelay();
    const snapshot = JSON.stringify(state);
    expect(() => moveRelay(state, { point: 0 })).toThrow("already");
    moveRelay(state, { point: 14 });
    expect(JSON.stringify(state)).toBe(snapshot);
  });

  it("ends when the move budget is exhausted, not when separate squares add up", () => {
    const state = moveRelay(createRelay(), { point: 35 });
    expect(state.winner).toBe(0);
    expect(state.lastSquares.length).toBeLessThan(2);
    expect(() => moveRelay(state, { point: 14 })).toThrow("No moves left");
  });

  it("undo restores exact points, remaining moves, and the nonterminal state", () => {
    for (const point of [14, 35]) {
      const initial = createRelay();
      const terminal = moveRelay(initial, { point });
      const undo = moveRelay(terminal, { type: "undo" });
      expect(undo).toEqual({ ...initial, revision: 2 });
      expect(terminal.placements).toEqual([point]);
    }
  });

  it("undo removes the newest placement without removing puzzle seeds", () => {
    let state = createRelay({ level: 7 });
    const sequence = PUZZLES[7]!.solution;
    state = moveRelay(state, { point: sequence[0] });
    const oneMove = state;
    state = moveRelay(state, { point: sequence[1] });
    state = moveRelay(state, { type: "undo" });
    expect(state).toEqual({ ...oneMove, revision: 3 });
  });

  it("does not permit hints or placements after winning, but allows undo", () => {
    const state = moveRelay(createRelay(), { point: 14 });
    expect(state.winner).toBe(1);
    expect(() => moveRelay(state, { type: "hint" })).toThrow("complete");
    expect(() => moveRelay(state, { point: 1 })).toThrow("complete");
    expect(moveRelay(state, { type: "undo" }).winner).toBeNull();
    expect(() => moveRelay(createRelay(), { type: "undo" })).toThrow("no move");
  });

  it("keeps hints free, repeatable, server-owned, and revisioned", () => {
    const initial = createRelay({ level: 7 });
    const hint = moveRelay(initial, { type: "hint" });
    expect(hint.placements).toEqual([]);
    expect(hint.cells).toEqual(initial.cells);
    expect(hint.revision).toBe(1);
    expect(hint.hint?.point).not.toBeNull();
    expect(hint.hint?.message).toContain("Try");
    expect(moveRelay(hint, { type: "hint" }).hint).toEqual(hint.hint);
  });

  it("reports no remaining solution honestly after an unhelpful setup", () => {
    const initial = createRelay({ level: 2 });
    const wrong = Array.from({ length: 36 }, (_, point) => point).find(
      (point) => {
        if (initial.cells[point]) return false;
        return solveRelay(moveRelay(initial, { point })) === null;
      },
    );
    expect(wrong).not.toBeUndefined();
    const state = moveRelay(initial, { point: wrong });
    const hint = moveRelay(state, { type: "hint" });
    expect(hint.hint?.point).toBeNull();
    expect(hint.hint?.message).toContain("Undo");
    expect(solveRelay(moveRelay(hint, { type: "undo" }))).not.toBeNull();
  });

  it("can follow repeated state-aware hints to finish every puzzle", () => {
    for (let level = 0; level < PUZZLES.length; level++) {
      let state = createRelay({ level });
      while (state.winner === null) {
        const hint = moveRelay(state, { type: "hint" });
        expect(hint.hint?.point).not.toBeNull();
        state = moveRelay(hint, { point: hint.hint?.point });
      }
      expect(state.winner).toBe(1);
      expect(JSON.parse(JSON.stringify(state))).toEqual(state);
    }
  });
});
