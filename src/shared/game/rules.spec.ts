import { describe, expect, it } from "vitest";

import {
  AI_DIFFICULTIES,
  AI_DIFFICULTY_TO_PLAY_STYLE,
  DEFAULT_PRACTICE_RULES,
  PLAY_STYLES,
  RANKED_SOLO_RULES,
  SOLO_RULES_VERSION,
  STANDARD_BOARD,
  STANDARD_MAX_SCORE,
  STANDARD_WIN_SCORE,
  playStyleForDifficulty,
  validatePracticeRules,
} from "./rules";

describe("solo rules", () => {
  it("pins Ranked solo to the versioned canonical preset", () => {
    expect(RANKED_SOLO_RULES).toEqual({
      rulesVersion: 1,
      mode: "ranked",
      W: 8,
      H: 8,
      winScore: 150,
      humanPlayer: 0,
      firstPlayer: 0,
      difficulty: "tenderfoot",
    });
    expect(RANKED_SOLO_RULES.rulesVersion).toBe(SOLO_RULES_VERSION);
    expect(Object.isFrozen(RANKED_SOLO_RULES)).toBe(true);
  });

  it("keeps every persisted numeric play style mapped to one difficulty", () => {
    expect(AI_DIFFICULTIES).toHaveLength(9);
    expect(new Set(Object.values(AI_DIFFICULTY_TO_PLAY_STYLE)).size).toBe(9);

    for (const difficulty of AI_DIFFICULTIES) {
      const style = playStyleForDifficulty(difficulty);
      expect(Number.isInteger(style)).toBe(true);
    }
    expect(playStyleForDifficulty("brutal")).toBe(PLAY_STYLES.BRUTAL);
  });

  it("places every Practice game on the standard board", () => {
    expect(STANDARD_MAX_SCORE).toBe(6888);
    expect(RANKED_SOLO_RULES).toMatchObject(STANDARD_BOARD);
    expect(
      validatePracticeRules({
        winScore: 20,
        difficulty: "coffee",
        humanPlayer: 1,
        firstPlayer: 1,
      }),
    ).toEqual({
      rulesVersion: SOLO_RULES_VERSION,
      mode: "practice",
      W: 8,
      H: 8,
      winScore: 20,
      difficulty: "coffee",
      humanPlayer: 1,
      firstPlayer: 1,
    });
  });

  it("uses explicit defaults only for optional player-order fields", () => {
    const rules = validatePracticeRules({
      winScore: STANDARD_WIN_SCORE,
      difficulty: "beginner",
    });

    expect(rules.humanPlayer).toBe(DEFAULT_PRACTICE_RULES.humanPlayer);
    expect(rules.firstPlayer).toBe(DEFAULT_PRACTICE_RULES.firstPlayer);
  });

  it.each([{ ranked: true }, { W: 8 }, { H: 8 }, { scoring: "bbox" }])(
    "rejects fields Practice does not configure %#",
    (extra) => {
      expect(() =>
        validatePracticeRules({
          winScore: STANDARD_WIN_SCORE,
          difficulty: "beginner",
          ...extra,
        }),
      ).toThrow("unknown field");
    },
  );

  it.each([
    [{}, "difficulty is not supported"],
    [{ winScore: 10, difficulty: "impossible" }, "difficulty is not supported"],
    [
      { winScore: STANDARD_MAX_SCORE + 1, difficulty: "beginner" },
      `winScore must be an integer from 1 through ${STANDARD_MAX_SCORE}`,
    ],
    [
      { winScore: 10, difficulty: "beginner", firstPlayer: 2 },
      "firstPlayer must be player index",
    ],
  ])("rejects unsupported Practice rules %#", (input, message) => {
    expect(() => validatePracticeRules(input)).toThrow(message);
  });
});
