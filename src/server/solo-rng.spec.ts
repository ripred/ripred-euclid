import { describe, expect, it } from "vitest";

import { createSoloTurnRng } from "./solo-rng";

function take(seed: string, ordinal: number, count = 8): number[] {
  const rng = createSoloTurnRng(seed, ordinal);
  return Array.from({ length: count }, () => rng());
}

describe("solo turn RNG", () => {
  it("repeats one private seed and turn ordinal exactly", () => {
    expect(take("private-seed", 3)).toEqual(take("private-seed", 3));
  });

  it("separates seeds and AI-turn ordinals", () => {
    expect(take("private-seed", 2)).not.toEqual(take("private-seed", 3));
    expect(take("private-seed", 2)).not.toEqual(take("other-seed", 2));
  });

  it("always returns values in the RandomSource interval", () => {
    for (const value of take("range", 0, 100)) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  it.each([
    ["", 0],
    ["seed", -1],
    ["seed", 1.5],
  ])("rejects invalid derivation input %#", (seed, ordinal) => {
    expect(() => createSoloTurnRng(seed, ordinal)).toThrow();
  });
});
