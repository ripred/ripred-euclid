import { describe, expect, it } from "vitest";
import {
  chooseLatticeMove,
  createLattice,
  cubeCatalog,
  cubeProgress,
  moveLattice,
  pointAt,
  pointIndex,
} from "./edition-game";

describe("Lattice cube rules", () => {
  it("enumerates every aligned cube once, at all possible sizes", () => {
    expect(cubeCatalog(3)).toHaveLength(9);
    const cubes = cubeCatalog(4);
    expect(cubes).toHaveLength(36);
    expect(new Set(cubes.map((cube) => cube.id)).size).toBe(36);
    expect(cubes.filter((cube) => cube.side === 1)).toHaveLength(27);
    expect(cubes.filter((cube) => cube.side === 2)).toHaveLength(8);
    expect(cubes.filter((cube) => cube.side === 3)).toHaveLength(1);
    for (const cube of cubes) {
      expect(new Set(cube.corners).size).toBe(8);
      const distances = cube.corners
        .slice(1)
        .map((index) => {
          const p = pointAt(index, 4);
          return (
            (p.x - cube.origin.x) ** 2 +
            (p.y - cube.origin.y) ** 2 +
            (p.z - cube.origin.z) ** 2
          );
        })
        .sort((a, b) => a - b);
      const area = cube.side ** 2;
      expect(distances).toEqual([
        area,
        area,
        area,
        2 * area,
        2 * area,
        2 * area,
        3 * area,
      ]);
    }
  });
  it("round-trips every index and coordinate", () => {
    for (let index = 0; index < 64; index++)
      expect(pointIndex(pointAt(index, 4), 4)).toBe(index);
  });
  it("gives each player an equal, non-scoring foundation", () => {
    for (const size of [3, 4]) {
      const state = createLattice({ size });
      expect(state.board.filter((owner) => owner === 1)).toHaveLength(4);
      expect(state.board.filter((owner) => owner === 2)).toHaveLength(4);
      expect(state.scores).toEqual([0, 0]);
      expect(state.cubes).toEqual([]);
      expect(state.revision).toBe(0);
    }
  });
  it("supports an entirely empty opening", () =>
    expect(
      createLattice({ opening: "empty" }).board.every((owner) => owner === 0),
    ).toBe(true));
  it.each([
    null,
    [],
    "4",
    { size: 5 },
    { size: 4.5 },
    { opening: "free" },
    { computerStyle: "unknown" },
  ])("rejects malformed options %j", (options) =>
    expect(() => createLattice(options)).toThrow(),
  );
  it.each([
    null,
    {},
    { x: 0, y: 0, z: 4 },
    { x: -1, y: 0, z: 0 },
    { x: 0.2, y: 0, z: 0 },
    { x: "0", y: 0, z: 0 },
  ])("rejects illegal coordinate %j", (action) =>
    expect(() =>
      moveLattice(createLattice({ opening: "empty" }), action),
    ).toThrow(),
  );
  it("does not mutate its input and refuses an occupied point", () => {
    const state = createLattice({ opening: "empty" });
    const serialized = JSON.stringify(state);
    const next = moveLattice(state, { x: 0, y: 0, z: 0, score: 100 });
    expect(JSON.stringify(state)).toBe(serialized);
    expect(next.turn).toBe(2);
    expect(next.scores).toEqual([0, 0]);
    expect(next.revision).toBe(1);
    expect(() => moveLattice(next, { x: 0, y: 0, z: 0 })).toThrow("already");
  });
  it.each([1, 2, 3])(
    "awards volume for side %i only on the eighth corner",
    (side) => {
      const state = createLattice({ opening: "empty" });
      const cube = cubeCatalog(4).find((item) => item.side === side)!;
      for (const index of cube.corners.slice(0, 7)) state.board[index] = 1;
      const next = moveLattice(state, pointAt(cube.corners[7]!, 4));
      expect(next.scores).toEqual([side ** 3, 0]);
      expect(next.cubes[0]?.id).toBe(cube.id);
      expect(next.history[0]?.points).toBe(side ** 3);
    },
  );
  it("does not award a cube containing an opponent corner", () => {
    const state = createLattice({ opening: "empty" });
    const cube = cubeCatalog(4)[0]!;
    for (const index of cube.corners.slice(0, 7)) state.board[index] = 1;
    state.board[cube.corners[0]!] = 2;
    expect(moveLattice(state, pointAt(cube.corners[7]!, 4)).scores).toEqual([
      0, 0,
    ]);
  });
  it("does not score a rectangular box even with all eight corners owned", () => {
    const state = createLattice({ opening: "empty" });
    for (const z of [0, 2])
      for (const y of [0, 1])
        for (const x of [0, 1])
          if (x !== 1 || y !== 1 || z !== 2)
            state.board[pointIndex({ x, y, z }, 4)] = 1;
    const next = moveLattice(state, { x: 1, y: 1, z: 2 });
    expect(next.cubes).toEqual([]);
    expect(next.scores).toEqual([0, 0]);
  });
  it("counts only the corners, not an opponent point inside a larger cube", () => {
    const state = createLattice({ opening: "empty" });
    const cube = cubeCatalog(4).find((item) => item.side === 2)!;
    for (const index of cube.corners.slice(0, 7)) state.board[index] = 1;
    state.board[pointIndex({ x: 1, y: 1, z: 1 }, 4)] = 2;
    const next = moveLattice(state, pointAt(cube.corners[7]!, 4));
    expect(next.scores).toEqual([8, 0]);
  });
  it("never scores an already completed cube a second time", () => {
    const state = createLattice({ opening: "empty" });
    const cube = cubeCatalog(4)[0]!;
    for (const index of cube.corners.slice(0, 7)) state.board[index] = 1;
    const completed = moveLattice(state, pointAt(cube.corners[7]!, 4));
    const next = moveLattice(completed, { x: 3, y: 3, z: 3 });
    expect(next.scores).toEqual([1, 0]);
    expect(next.cubes).toHaveLength(1);
  });
  it("scores two cubes sharing the final corner in one move", () => {
    const state = createLattice({ opening: "empty" });
    const cubes = cubeCatalog(4).filter(
      (cube) =>
        cube.side === 1 &&
        ((cube.origin.x === 0 && cube.origin.y === 0 && cube.origin.z === 0) ||
          (cube.origin.x === 1 && cube.origin.y === 1 && cube.origin.z === 1)),
    );
    const last = pointIndex({ x: 1, y: 1, z: 1 }, 4);
    for (const cube of cubes)
      for (const index of cube.corners)
        if (index !== last) state.board[index] = 1;
    const next = moveLattice(state, pointAt(last, 4));
    expect(next.scores[0]).toBe(2);
    expect(next.cubes).toHaveLength(2);
  });
  it("keeps terminal outcome coherent and rejects any subsequent move", () => {
    const state = createLattice({ opening: "empty" });
    state.board.fill(1);
    state.board[63] = 0;
    state.scores = [12, 2];
    const next = moveLattice(state, { x: 3, y: 3, z: 3 });
    expect(next.winner).toBe(1);
    expect(next.turn).toBe(1);
    expect(() => moveLattice(next, { x: 0, y: 0, z: 0 })).toThrow("complete");
    expect(() => chooseLatticeMove(next)).toThrow("result");
  });
  it("declares a tie when a full board has equal scores", () => {
    const state = createLattice({ opening: "empty" });
    state.board = state.board.map((_, index) =>
      pointAt(index, 4).z % 2 === 0 ? 1 : 2,
    );
    state.board[63] = 0;
    expect(moveLattice(state, { x: 3, y: 3, z: 3 }).winner).toBe(0);
  });
  it("ignores blocked cube plans", () => {
    const state = createLattice({ opening: "empty" });
    const cube = cubeCatalog(4)[0]!;
    state.board[cube.corners[0]!] = 2;
    expect(
      cubeProgress(state, 1).some((item) => item.cube.id === cube.id),
    ).toBe(false);
  });
  it("finishes an available cube before speculative construction", () => {
    const state = createLattice({ opening: "empty" });
    const cube = cubeCatalog(4).find((item) => item.side === 3)!;
    for (const index of cube.corners.slice(0, 7)) state.board[index] = 1;
    expect(chooseLatticeMove(state)).toEqual(pointAt(cube.corners[7]!, 4));
  });
  it("blocks an immediate opposing cube", () => {
    const state = createLattice({
      opening: "empty",
      computerStyle: "tactician",
    });
    const cube = cubeCatalog(4).find((item) => item.side === 3)!;
    for (const index of cube.corners.slice(0, 7)) state.board[index] = 2;
    expect(chooseLatticeMove(state)).toEqual(pointAt(cube.corners[7]!, 4));
  });
  it("makes the default foundation opening a productive construction game", () => {
    let state = createLattice();
    while (state.winner === null)
      state = moveLattice(state, chooseLatticeMove(state));
    expect(state.cubes.length).toBeGreaterThan(0);
    expect(state.scores[0]).toBeGreaterThan(0);
    expect(state.scores[1]).toBeGreaterThan(0);
  });
  it.each([3, 4])(
    "plays a full deterministic %i-wide game with bounded legal moves",
    (size) => {
      let state = createLattice({ size });
      while (state.winner === null) {
        expect(state.revision).toBeLessThan(size ** 3);
        const action = chooseLatticeMove(state);
        expect(chooseLatticeMove(state)).toEqual(action);
        state = moveLattice(state, action);
      }
      expect(state.revision).toBe(size ** 3 - 8);
      expect(state.board.includes(0)).toBe(false);
      expect(state.scores[0] + state.scores[1]).toBe(
        state.cubes.reduce((total, cube) => total + cube.volume, 0),
      );
    },
  );
});
