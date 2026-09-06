import { describe, expect, it } from "vitest";
import {
  edition,
  STONE_LIFETIME,
  TIDE_SQUARES,
  type TideState,
} from "./edition-game";
import { coordinate, squareCatalog } from "./edition-geometry";

function fixture(own: number[], other: number[] = []): TideState {
  const state = edition.create({ target: 90 });
  for (const point of own) {
    state.board[point] = 1;
    state.expires[point] = 12;
  }
  for (const point of other) {
    state.board[point] = 2;
    state.expires[point] = 12;
  }
  return state;
}

describe("Tide square geometry", () => {
  it("matches an independent exhaustive four-point distance oracle", () => {
    const oracle: string[] = [];
    const distance = (a: number, b: number) =>
      ((a % 6) - (b % 6)) ** 2 + (Math.floor(a / 6) - Math.floor(b / 6)) ** 2;
    for (let a = 0; a < 36; a++)
      for (let b = a + 1; b < 36; b++)
        for (let c = b + 1; c < 36; c++)
          for (let d = c + 1; d < 36; d++) {
            const lengths = [
              distance(a, b),
              distance(a, c),
              distance(a, d),
              distance(b, c),
              distance(b, d),
              distance(c, d),
            ].sort((x, y) => x - y);
            if (
              lengths[0]! > 0 &&
              lengths[0] === lengths[1] &&
              lengths[1] === lengths[2] &&
              lengths[2] === lengths[3] &&
              lengths[4] === lengths[5] &&
              lengths[4] === 2 * lengths[0]!
            )
              oracle.push([a, b, c, d].join("-"));
          }
    expect(TIDE_SQUARES.map((square) => square.id).sort()).toEqual(
      oracle.sort(),
    );
    expect(TIDE_SQUARES).toHaveLength(105);
  });
  it("keeps polygons cyclic and scores their inclusive enclosing footprint", () => {
    for (const square of TIDE_SQUARES) {
      const xs = square.corners.map((p) => p % 6),
        ys = square.corners.map((p) => Math.floor(p / 6));
      expect(square.points).toBe(
        (Math.max(...xs) - Math.min(...xs) + 1) *
          (Math.max(...ys) - Math.min(...ys) + 1),
      );
      const crossArea =
        Math.abs(
          square.corners.reduce((sum, p, i) => {
            const q = square.corners[(i + 1) % 4]!;
            return (
              sum + (p % 6) * Math.floor(q / 6) - (q % 6) * Math.floor(p / 6)
            );
          }, 0),
        ) / 2;
      expect(crossArea).toBe(square.area);
    }
    expect(squareCatalog(2)).toHaveLength(1);
    expect(coordinate(0)).toBe("A1");
    expect(coordinate(35)).toBe("F6");
  });
});

describe("Tide rules", () => {
  it.each([40, 60, 90])("creates an isolated game to %i points", (target) => {
    const a = edition.create({ target }),
      b = edition.create({ target });
    a.board[0] = 1;
    expect(b.board.every((p) => p === 0)).toBe(true);
    expect(b).toMatchObject({
      target,
      winner: null,
      turn: 1,
      revision: 0,
      moveLimit: 60,
    });
  });
  it.each([0, "60", 150, NaN])("rejects a forged target %s", (target) =>
    expect(() => edition.create({ target })).toThrow(),
  );
  it.each([
    null,
    {},
    { point: -1 },
    { point: 36 },
    { point: 1.5 },
    { point: "1" },
  ])("rejects malformed moves %j", (action) =>
    expect(() => edition.move(edition.create({}), action)).toThrow(),
  );
  it("does not mutate the confirmed board or accept ownership/score claims", () => {
    const before = edition.create({});
    const copy = JSON.stringify(before);
    const next = edition.move(before, {
      point: 14,
      player: 2,
      scores: [900, 900],
      winner: 1,
    });
    expect(JSON.stringify(before)).toBe(copy);
    expect(next.board[14]).toBe(1);
    expect(next.scores).toEqual([0, 0]);
    expect(next.winner).toBeNull();
    expect(() => edition.move(next, { point: 14 })).toThrow(/occupied/);
  });
  it("scores and anchors an upright square", () => {
    const next = edition.move(fixture([0, 1, 6]), { point: 7 });
    expect(next.scores).toEqual([4, 0]);
    expect(next.squares).toHaveLength(1);
    for (const p of [0, 1, 6, 7]) expect(next.anchored[p]).toBe(true);
  });
  it("scores a rotated square", () => {
    const next = edition.move(fixture([1, 6, 8]), { point: 13 });
    expect(next.scores[0]).toBe(9);
    expect(next.squares[0]?.area).toBe(2);
  });
  it("completes multiple squares on the same move without rescoring old ones", () => {
    const next = edition.move(fixture([12, 0, 2, 16, 4]), { point: 14 });
    expect(next.squares).toHaveLength(2);
    expect(next.scores[0]).toBe(18);
    expect(next.history[0]?.squares).toHaveLength(2);
    const after = edition.move({ ...next, turn: 1 }, { point: 35 });
    expect(after.scores[0]).toBe(18);
  });
  it("does not count mixed-owner squares", () => {
    expect(edition.move(fixture([0, 1], [6]), { point: 7 }).squares).toEqual(
      [],
    );
  });
  it("washes an unanchored stone after precisely six personal turns", () => {
    let state = edition.move(edition.create({}), { point: 0 });
    expect(state.expires[0]).toBe(STONE_LIFETIME);
    // Test the two boundary plies without introducing unrelated square completions.
    state = { ...state, revision: 10 };
    const beforeExpiry = edition.move(state, { point: 35 });
    expect(beforeExpiry.board[0]).toBe(1);
    const expired = edition.move(beforeExpiry, { point: 34 });
    expect(expired.board[0]).toBe(0);
    expect(expired.expires[0]).toBe(0);
    expect(expired.history.at(-1)?.washed).toContain(0);
    const replaced = edition.move(expired, { point: 0 });
    expect(replaced.board[0]).toBe(2);
    expect(replaced.expires[0]).toBe(24);
  });
  it("anchors before applying expiration on the same ply", () => {
    const state = { ...fixture([0, 1, 6]), revision: 11 };
    const next = edition.move(state, { point: 7 });
    expect(next.board[0]).toBe(1);
    expect(next.history.at(-1)?.washed).toEqual([]);
    const later = edition.move({ ...next, revision: 20 }, { point: 35 });
    expect(later.board[0]).toBe(1);
    expect(later.scores[0]).toBe(4);
  });
  it("freezes a winning board before expiration or any further move", () => {
    const state = {
      ...fixture([0, 1, 6, 35]),
      revision: 11,
      scores: [86, 0] as [number, number],
    };
    const next = edition.move(state, { point: 7 });
    expect(next.winner).toBe(1);
    expect(next.turn).toBe(1);
    expect(next.board[35]).toBe(1);
    expect(() => edition.move(next, { point: 30 })).toThrow(/settled/);
    expect(() => edition.chooseMove(next)).toThrow(/over/);
  });
  it.each([
    [0, 0, 0],
    [4, 0, 1],
    [0, 9, 2],
  ])("ends thirty rounds by score %i–%i", (a, b, winner) => {
    const state = {
      ...edition.create({}),
      revision: 59,
      scores: [a, b] as [number, number],
    };
    const next = edition.move(state, { point: 0 });
    expect(next.winner).toBe(winner);
  });
  it("checks board fullness after expiration rather than before", () => {
    const state = edition.create({});
    state.board.fill(2);
    state.board[35] = 0;
    state.expires.fill(1);
    const next = edition.move(state, { point: 35 });
    expect(next.winner).toBeNull();
    expect(next.board.filter(Boolean)).toHaveLength(1);
  });
  it("takes a winning move and otherwise blocks an immediate losing move", () => {
    const winning = {
      ...fixture([0, 1, 6]),
      scores: [86, 0] as [number, number],
    };
    expect(edition.chooseMove(winning)).toEqual({ point: 7 });
    const losing = {
      ...fixture([], [0, 1, 6]),
      scores: [0, 86] as [number, number],
    };
    expect(edition.chooseMove(losing)).toEqual({ point: 7 });
  });
  it("finishes a deterministic complete game with real scoring", () => {
    const run = () => {
      let state = edition.create({});
      while (state.winner === null && state.revision < 61)
        state = edition.move(state, edition.chooseMove(state));
      return state;
    };
    const result = run();
    expect(result.winner).not.toBeNull();
    expect(result.revision).toBeLessThanOrEqual(60);
    expect(result.squares.length).toBeGreaterThan(0);
    expect(run()).toEqual(result);
    for (const square of result.squares)
      for (const p of square.corners) {
        expect(result.board[p]).toBe(square.owner);
        expect(result.anchored[p]).toBe(true);
      }
  });
});
