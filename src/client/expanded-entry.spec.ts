import { describe, expect, it } from "vitest";
import { expandedInitialMode } from "./expanded-entry";

describe("expanded entry selection", () => {
  it.each([
    ["watch", "spectate"],
    ["leaderboard", "rankings"],
    ["game", null],
    [undefined, null],
    ["unknown", null],
  ] as const)("maps %s to its local screen", (entry, expected) => {
    expect(expandedInitialMode(entry)).toBe(expected);
  });
});
