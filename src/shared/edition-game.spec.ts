import { describe, expect, it } from "vitest";
import {
  POINTS,
  TRIANGLES,
  TRIANGLE_BY_ID,
  TARGET,
  createWeave,
  chooseWeaveMove,
  distanceSquared,
  moveWeave,
  sharesEdge,
  type WeaveState,
} from "./edition-game";

function withPoints(
  one: number[],
  two: number[] = [],
  turn: 1 | 2 = 1,
): WeaveState {
  const game = createWeave();
  one.forEach((point) => {
    game.cells[point] = 1;
  });
  two.forEach((point) => {
    game.cells[point] = 2;
  });
  game.turn = turn;
  return game;
}

describe("Weave triangular geometry", () => {
  it("has seven rows with 28 distinct, named points", () => {
    expect(POINTS).toHaveLength(28);
    expect(new Set(POINTS.map((point) => point.label)).size).toBe(28);
    expect(POINTS[0]?.label).toBe("A1");
    expect(POINTS[27]?.label).toBe("G7");
  });

  it("matches an independent Euclidean equilateral-triangle oracle", () => {
    const expected: string[] = [];
    const squared = (a: number, b: number) => {
      const first = POINTS[a]!;
      const second = POINTS[b]!;
      return ((first.x - second.x) ** 2 + (first.y - second.y) ** 2) / 140 ** 2;
    };
    for (let a = 0; a < 28; a++)
      for (let b = a + 1; b < 28; b++)
        for (let c = b + 1; c < 28; c++) {
          if (
            Math.abs(squared(a, b) - squared(a, c)) < 1e-8 &&
            Math.abs(squared(a, b) - squared(b, c)) < 1e-8
          )
            expected.push(`${a}-${b}-${c}`);
        }
    expect(TRIANGLES.map((triangle) => triangle.id)).toEqual(expected);
    expect(new Set(expected).size).toBe(TRIANGLES.length);
    for (const triangle of TRIANGLES)
      expect(triangle.area).toBeCloseTo(
        squared(triangle.corners[0], triangle.corners[1]),
      );
  });

  it("includes tilted and inverted triangles and preserves exact area", () => {
    expect(TRIANGLE_BY_ID.get("1-5-7")?.area).toBe(3);
    expect(TRIANGLE_BY_ID.get("1-2-4")?.area).toBe(1);
    expect(TRIANGLE_BY_ID.get("0-21-27")?.area).toBe(36);
    expect(distanceSquared(POINTS[1]!, POINTS[5]!)).toBe(3);
  });

  it("links only full identical edges, never partial edges or one corner", () => {
    const small = TRIANGLE_BY_ID.get("0-1-2")!;
    expect(sharesEdge(small, TRIANGLE_BY_ID.get("1-2-4")!)).toBe(true);
    expect(sharesEdge(small, TRIANGLE_BY_ID.get("0-3-5")!)).toBe(false);
    expect(sharesEdge(small, small)).toBe(false);
  });
});

describe("Weave moves and scoring", () => {
  it("starts empty and does not mutate the previous state", () => {
    const before = createWeave();
    const after = moveWeave(before, { point: 0 });
    expect(before).toEqual(createWeave());
    expect(after.cells[0]).toBe(1);
    expect(after.turn).toBe(2);
    expect(after.revision).toBe(1);
    expect(after.scores).toEqual([0, 0]);
  });

  it.each([
    null,
    {},
    { point: -1 },
    { point: 28 },
    { point: 0.5 },
    { point: "0" },
    { point: NaN },
    { point: Infinity },
  ])("rejects malformed placement %j", (action) => {
    expect(() => moveWeave(createWeave(), action)).toThrow();
  });

  it("rejects occupied points and terminal moves", () => {
    const game = moveWeave(createWeave(), { point: 0 });
    expect(() => moveWeave(game, { point: 0 })).toThrow("already claimed");
    game.winner = 1;
    expect(() => moveWeave(game, { point: 1 })).toThrow("complete");
  });

  it("scores a tilted triangle, but an opponent corner blocks it", () => {
    expect(moveWeave(withPoints([1, 5]), { point: 7 }).lastMove?.area).toBe(3);
    expect(moveWeave(withPoints([1], [5]), { point: 7 }).scores).toEqual([
      0, 0,
    ]);
  });

  it("scores the exact newly linked pair once", () => {
    const game = withPoints([0, 1, 2]);
    game.claims = [{ id: "0-1-2", player: 1, revision: 1 }];
    game.scores = [1, 0];
    const next = moveWeave(game, { point: 4 });
    expect(next.lastMove).toMatchObject({
      area: 1,
      links: 1,
      points: 3,
      triangles: ["1-2-4"],
    });
    expect(next.scores).toEqual([4, 0]);
    expect(next.claims).toHaveLength(2);
    const later = moveWeave({ ...next, turn: 1 }, { point: 27 });
    expect(later.lastMove?.links).toBe(0);
    expect(later.scores).toEqual([4, 0]);
  });

  it("awards one link when two adjacent triangles finish simultaneously", () => {
    const next = moveWeave(withPoints([0, 2, 4]), { point: 1 });
    expect(next.lastMove).toMatchObject({ area: 2, links: 1, points: 4 });
    expect(next.lastMove?.triangles).toHaveLength(2);
  });

  it("wins on the scoring move and never advances the terminal turn", () => {
    const next = moveWeave(withPoints([0, 21]), { point: 27 });
    expect(next.scores[0]).toBeGreaterThanOrEqual(TARGET);
    expect(next.winner).toBe(1);
    expect(next.turn).toBe(1);
    expect(() => chooseWeaveMove(next)).toThrow("finished");
  });

  it("uses the higher score or a tie on a full board", () => {
    for (const [scores, winner] of [
      [[20, 21], 2],
      [[21, 20], 1],
      [[20, 20], 0],
    ] as const) {
      const game = createWeave();
      game.cells.fill(2);
      game.cells[0] = 0;
      game.scores = [...scores];
      const next = moveWeave(game, { point: 0 });
      expect(next.winner).toBe(winner);
    }
  });

  it("round-trips complete state through JSON", () => {
    const next = moveWeave(withPoints([0, 2, 4]), { point: 1 });
    expect(JSON.parse(JSON.stringify(next))).toEqual(next);
  });
});

describe("Weave tactical opponent", () => {
  it("takes an immediate win", () => {
    expect(chooseWeaveMove(withPoints([], [0, 21], 2))).toEqual({ point: 27 });
  });

  it("blocks an immediate opponent win when no own win exists", () => {
    expect(chooseWeaveMove(withPoints([0, 21], [], 2))).toEqual({ point: 27 });
  });

  it("plays an entire legal game deterministically without post-result moves", () => {
    let game = createWeave();
    const seen = new Set<number>();
    while (game.winner === null) {
      const action = chooseWeaveMove(game);
      expect(chooseWeaveMove(game)).toEqual(action);
      expect(seen.has(action.point)).toBe(false);
      seen.add(action.point);
      game = moveWeave(game, action);
      expect(game.revision).toBe(seen.size);
      expect(
        game.claims.every((claim) =>
          TRIANGLE_BY_ID.get(claim.id)?.corners.every(
            (corner) => game.cells[corner] === claim.player,
          ),
        ),
      ).toBe(true);
      expect(seen.size).toBeLessThanOrEqual(28);
    }
    expect(game.winner).not.toBeNull();
  });
});
