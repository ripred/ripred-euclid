import { describe, expect, it } from "vitest";
import { expandedInitialMode, expandedInitialAction } from "./expanded-entry";

describe("expanded entry selection", () => {
  it.each(["solo", "reddit"] as const)(
    "preserves an explicit %s launch intent",
    (entry) => {
      expect(expandedInitialMode(entry)).toBeNull();
      expect(expandedInitialAction(entry)).toBe(entry);
    },
  );
  it.each(["game", "watch", "leaderboard", "unknown", undefined])(
    "does not auto-start from %s",
    (entry) => {
      expect(expandedInitialAction(entry)).toBeNull();
    },
  );
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
