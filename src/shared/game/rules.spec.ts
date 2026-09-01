import { describe, expect, it } from "vitest";

import {
  AI_DIFFICULTIES,
  AI_DIFFICULTY_TO_PLAY_STYLE,
  DEFAULT_PRACTICE_RULES,
  PLAY_STYLES,
  RANKED_SOLO_RULES,
  SOLO_RULES_VERSION,
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
      scoring: "bbox",
      winScore: 150,
      humanPlayer: 0,
      firstPlayer: 0,
      difficulty: "brutal",
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

  it("canonicalizes a supported Practice configuration", () => {
    expect(
      validatePracticeRules({
        W: 6,
        H: 10,
        scoring: "true",
        winScore: 20,
        difficulty: "coffee",
        humanPlayer: 1,
        firstPlayer: 1,
      }),
    ).toEqual({
      rulesVersion: SOLO_RULES_VERSION,
      mode: "practice",
      W: 6,
      H: 10,
      scoring: "true",
      winScore: 20,
      difficulty: "coffee",
      humanPlayer: 1,
      firstPlayer: 1,
    });
  });

  it("uses explicit defaults only for optional player-order fields", () => {
    const rules = validatePracticeRules({
      W: 8,
      H: 8,
      scoring: "bbox",
      winScore: 150,
      difficulty: "beginner",
    });

    expect(rules.humanPlayer).toBe(DEFAULT_PRACTICE_RULES.humanPlayer);
    expect(rules.firstPlayer).toBe(DEFAULT_PRACTICE_RULES.firstPlayer);
  });

  it("rejects unknown Practice fields instead of silently ignoring them", () => {
    expect(() =>
      validatePracticeRules({
        W: 8,
        H: 8,
        scoring: "bbox",
        winScore: 150,
        difficulty: "beginner",
        ranked: true,
      }),
    ).toThrow('unknown field "ranked"');
  });

  it.each([
    [{}, "W must be an even integer"],
    [
      {
        W: 5,
        H: 8,
        scoring: "bbox",
        winScore: 10,
        difficulty: "beginner",
      },
      "W must be an even integer",
    ],
    [
      {
        W: 8,
        H: 18,
        scoring: "bbox",
        winScore: 10,
        difficulty: "beginner",
      },
      "H must be an even integer",
    ],
    [
      {
        W: 8,
        H: 8,
        scoring: "diagonal",
        winScore: 10,
        difficulty: "beginner",
      },
      "scoring must be",
    ],
    [
      {
        W: 8,
        H: 8,
        scoring: "bbox",
        winScore: 10,
        difficulty: "impossible",
      },
      "difficulty is not supported",
    ],
    [
      {
        W: 4,
        H: 4,
        scoring: "bbox",
        winScore: Number.MAX_SAFE_INTEGER,
        difficulty: "beginner",
      },
      "winScore must be an integer",
    ],
    [
      {
        W: 8,
        H: 8,
        scoring: "bbox",
        winScore: 10,
        difficulty: "beginner",
        firstPlayer: 2,
      },
      "firstPlayer must be player index",
    ],
  ])("rejects unsupported Practice rules %#", (input, message) => {
    expect(() => validatePracticeRules(input)).toThrow(message);
  });
});
