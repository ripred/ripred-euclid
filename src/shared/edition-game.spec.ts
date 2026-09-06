import { describe, expect, it } from "vitest";
import {
  PUZZLES,
  SIZE,
  SQUARES,
  createRelay,
  moveRelay,
  solveRelay,
} from "./edition-game";

function permutations(points: readonly number[]): number[][] {
  if (points.length === 0) return [[]];
  return points.flatMap((point, index) =>
    permutations(points.filter((_, other) => other !== index)).map((rest) => [
      point,
      ...rest,
    ]),
  );
}

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
      expect(state.canFinish).toBe(true);
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
      expect(state.canFinish).toBe(true);
      expect(state.completed.length).toBeGreaterThanOrEqual(puzzle.goal);
      expect(state.revision).toBe(puzzle.moves);
    },
  );

  it("requires all four placements for the collection finale", () => {
    const solution = solveRelay(createRelay({ level: 7 }));
    expect(solution).toHaveLength(4);
  });

  it.each(
    PUZZLES.flatMap((puzzle, level) =>
      permutations(puzzle.solution).map((order) => ({
        name: puzzle.name,
        level,
        order,
      })),
    ),
  )(
    "solves $name when its points are placed in order $order",
    ({ level, order }) => {
      let state = createRelay({ level });
      for (const point of order) {
        expect(state.winner).toBeNull();
        state = moveRelay(state, { point });
        expect(state.canFinish).toBe(true);
      }
      expect(state.winner).toBe(1);
      expect(state.completed.length).toBeGreaterThanOrEqual(
        PUZZLES[level]!.goal,
      );
      expect(new Set(state.completed).size).toBe(state.completed.length);
    },
  );

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

  it("ends unsuccessfully only when the move budget runs out below the goal", () => {
    const state = moveRelay(createRelay(), { point: 35 });
    expect(state.winner).toBe(0);
    expect(state.canFinish).toBe(false);
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
    expect(hint.canFinish).toBe(true);
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
    expect(hint.hint?.squares).toEqual([]);
    expect(hint.hint?.message).toContain("Undo");
    expect(state.canFinish).toBe(false);
    expect(hint.canFinish).toBe(false);
    expect(solveRelay(moveRelay(hint, { type: "undo" }))).not.toBeNull();
  });

  it.each(PUZZLES.map((puzzle, level) => ({ name: puzzle.name, level })))(
    "outlines every new square in the full hint plan at each step of $name",
    ({ level }) => {
      let state = createRelay({ level });
      while (state.winner === null) {
        const plan = solveRelay(state)!;
        const hint = moveRelay(state, { type: "hint" });
        expect(hint.hint?.point).toBe(plan[0]);
        expect(hint.canFinish).toBe(true);
        expect(hint.placements).toEqual(state.placements);
        expect(hint.cells).toEqual(state.cells);
        const hintedSquares = hint.hint?.squares ?? [];
        expect(hintedSquares.length).toBeGreaterThanOrEqual(
          PUZZLES[level]!.goal - state.completed.length,
        );
        // Outlines cover the whole remaining plan, not just its next placement.
        const finish = plan.reduce(
          (current, point) => moveRelay(current, { point }),
          state,
        );
        expect(finish.winner).toBe(1);
        expect([...hintedSquares].sort()).toEqual(
          finish.completed.filter((id) => !state.completed.includes(id)).sort(),
        );
        expect(hintedSquares.some((id) => state.completed.includes(id))).toBe(
          false,
        );
        for (const id of hintedSquares) {
          const square = SQUARES.find((candidate) => candidate.id === id)!;
          expect(square.corners.some((corner) => plan.includes(corner))).toBe(
            true,
          );
          expect(
            square.corners.every(
              (corner) => state.cells[corner] === 1 || plan.includes(corner),
            ),
          ).toBe(true);
        }
        state = moveRelay(hint, { point: hint.hint?.point });
        expect(state.hint).toBeNull();
      }
      expect(state.winner).toBe(1);
      expect(state.canFinish).toBe(true);
      expect(JSON.parse(JSON.stringify(state))).toEqual(state);
    },
  );

  it("wins puzzle three with F3 then D3 or D3 then F3", () => {
    const initial = createRelay({ level: 2 });
    const setup = moveRelay(initial, { point: 17 });
    expect(setup.lastSquares).toEqual([]);
    expect(setup.canFinish).toBe(true);
    const win = moveRelay(setup, { point: 15 });
    expect(win.lastSquares).toEqual(["1-3-13-15", "3-5-15-17"]);
    expect(win.winner).toBe(1);
    expect(win.canFinish).toBe(true);

    const firstSquare = moveRelay(initial, { point: 15 });
    expect(firstSquare.lastSquares).toEqual(["1-3-13-15"]);
    expect(firstSquare.winner).toBeNull();
    expect(firstSquare.canFinish).toBe(true);
    const hint = moveRelay(firstSquare, { type: "hint" });
    expect(hint.hint?.point).toBe(17);
    expect(hint.hint?.squares).toEqual(["3-5-15-17"]);
    expect(hint.hint?.message).toContain("finish the puzzle");
    expect(hint.canFinish).toBe(true);
    expect(hint.placements).toEqual([15]);

    const separateFinish = moveRelay(hint, { point: 17 });
    expect(separateFinish.completed).toEqual(win.completed);
    expect(separateFinish.lastSquares).toEqual(["3-5-15-17"]);
    expect(separateFinish.winner).toBe(1);
    expect(separateFinish.canFinish).toBe(true);
  });

  it("hints one square at a time without re-counting completed squares", () => {
    const initial = createRelay({ level: 2 });
    const setupHint = moveRelay(initial, { type: "hint" });
    expect(setupHint.hint?.point).toBe(15);
    expect(setupHint.hint?.message).toContain("D3 to complete 1 new square");
    expect(setupHint.hint?.message).toContain("1 more square will remain");
    expect(setupHint.hint?.squares).toEqual(["1-3-13-15", "3-5-15-17"]);
    expect(setupHint.placements).toEqual([]);

    const setup = moveRelay(setupHint, { point: 15 });
    const finalHint = moveRelay(setup, { type: "hint" });
    expect(finalHint.hint?.point).toBe(17);
    expect(finalHint.hint?.message).toContain("F3 to complete 1 new square");
    expect(finalHint.hint?.message).toContain("finish the puzzle");
    expect(finalHint.hint?.squares).toEqual(["3-5-15-17"]);
    expect(finalHint.placements).toEqual([15]);
  });

  it("explains when the next suggested placement is only a setup", () => {
    const state = moveRelay(createRelay({ level: 7 }), { point: 2 });
    const hint = moveRelay(state, { type: "hint" });
    expect(hint.hint?.point).toBe(3);
    expect(hint.hint?.message).toContain("D1 as a setup point");
    expect(hint.hint?.message).toContain("3 remaining squares");
    expect(moveRelay(hint, { point: 3 }).lastSquares).toEqual([]);
  });

  it("reports a possible puzzle-three finish only when a winning final move exists", () => {
    const initial = createRelay({ level: 2 });
    const points = Array.from({ length: SIZE * SIZE }, (_, point) => point);
    for (const first of points) {
      if (initial.cells[first] !== 0) continue;
      const setup = moveRelay(initial, { point: first });
      const finishes = points.filter(
        (point) =>
          setup.cells[point] === 0 && moveRelay(setup, { point }).winner === 1,
      );
      expect(finishes).toEqual(first === 17 ? [15] : first === 15 ? [17] : []);
      expect(setup.canFinish).toBe(finishes.length > 0);
    }
  });

  it("undo restores a possible finish and clears dead-end hint guidance", () => {
    const initial = createRelay({ level: 2 });
    const unhelpfulPoint = moveRelay(initial, { point: 6 });
    const hint = moveRelay(unhelpfulPoint, { type: "hint" });
    expect(hint.canFinish).toBe(false);
    expect(hint.hint?.point).toBeNull();
    expect(hint.hint?.squares).toEqual([]);
    expect(hint.hint?.message).toContain("Undo");
    const restored = moveRelay(hint, { type: "undo" });
    expect(restored).toEqual({ ...initial, revision: 3 });
    expect(restored.canFinish).toBe(true);
    expect(restored.hint).toBeNull();
    expect(moveRelay(restored, { type: "hint" }).hint?.point).toBe(15);
  });

  it("upgrades old saved guidance from board state without trusting cached flags", () => {
    const legacy = createRelay({ level: 2 });
    delete legacy.canFinish;
    legacy.hint = { point: 17, message: "Try F3 as a setup point." };
    const refreshed = moveRelay(legacy, { type: "hint" });
    expect(refreshed.canFinish).toBe(true);
    expect(refreshed.hint?.squares).toHaveLength(2);
    expect(legacy.canFinish).toBeUndefined();
    expect(legacy.hint.squares).toBeUndefined();

    const staleGuidance = { ...legacy, canFinish: false };
    expect(moveRelay(staleGuidance, { type: "hint" }).canFinish).toBe(true);
    const deadEnd = moveRelay(staleGuidance, { point: 6 });
    expect(deadEnd.canFinish).toBe(false);
    expect(deadEnd.hint).toBeNull();
    expect(moveRelay(deadEnd, { type: "undo" }).canFinish).toBe(true);
  });
});
