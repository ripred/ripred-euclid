import { describe, expect, it } from "vitest";
import { hasOnlyKeys, isCountOrNull } from "./guards";

describe("shared guards", () => {
  it("accepts objects whose keys are all allowed, including missing ones", () => {
    expect(hasOnlyKeys({}, [])).toBe(true);
    expect(hasOnlyKeys({ kind: "solo" }, ["kind", "gameId"])).toBe(true);
    expect(hasOnlyKeys({ kind: "solo", gameId: "g" }, ["kind", "gameId"])).toBe(
      true,
    );
  });

  it("rejects any key that is not allowed", () => {
    expect(hasOnlyKeys({ extra: 1 }, [])).toBe(false);
    expect(hasOnlyKeys({ kind: "solo", score: 9 }, ["kind", "gameId"])).toBe(
      false,
    );
  });

  it.each([
    [null, true],
    [0, true],
    [42, true],
    [-1, false],
    [1.5, false],
    [undefined, false],
    ["3", false],
  ])("treats %j as a count or null: %s", (value, expected) => {
    expect(isCountOrNull(value)).toBe(expected);
  });
});
