import { describe, expect, it } from "vitest";

import { recommendedWinTarget, totalSquareScore } from "./game/scoring";
import {
  DEFAULT_SETTINGS,
  practiceRules,
  restoreSettings,
  updatePractice,
} from "./settings";

describe("restoring settings", () => {
  it("keeps valid choices", () => {
    const value = {
      soloMode: "ranked",
      practice: {
        W: 10,
        H: 6,
        scoring: "true",
        winScore: 40,
        difficulty: "brutal",
        fadeTurns: 6,
      },
      assist: true,
      theme: "light",
    };
    expect(restoreSettings(value)).toEqual(value);
  });

  it("falls back per field on stale or edited values", () => {
    expect(
      restoreSettings({
        soloMode: "tournament",
        practice: {
          W: 7,
          H: 6,
          scoring: "true",
          winScore: 40,
          difficulty: "x",
        },
        assist: "yes",
        theme: "sepia",
      }),
    ).toEqual({ ...DEFAULT_SETTINGS });
    expect(restoreSettings("nope")).toBeNull();
  });
});

describe("changing Practice", () => {
  it("resets the target to the recommendation when the board changes", () => {
    const next = updatePractice(DEFAULT_SETTINGS.practice, { W: 12 });
    expect(next.W).toBe(12);
    expect(next.winScore).toBe(recommendedWinTarget(12, 8, "bbox"));
  });

  it("keeps an explicit target, clamped to what the board can score", () => {
    const practice = DEFAULT_SETTINGS.practice;
    expect(updatePractice(practice, { winScore: 90 }).winScore).toBe(90);
    expect(updatePractice(practice, { winScore: 0 }).winScore).toBe(1);
    expect(updatePractice(practice, { winScore: 10 ** 9 }).winScore).toBe(
      totalSquareScore(8, 8, "bbox"),
    );
  });

  it("produces rules the engine accepts", () => {
    const rules = practiceRules(
      updatePractice(DEFAULT_SETTINGS.practice, { H: 4 }),
    );
    expect(rules).toMatchObject({ mode: "practice", W: 8, H: 4 });
  });
});
