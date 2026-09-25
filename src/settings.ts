import {
  DEFAULT_PRACTICE_RULES,
  validatePracticeRules,
  type PracticeRules,
  type SoloMode,
} from "./game/rules";
import { recommendedWinTarget, totalSquareScore } from "./game/scoring";

/** The player's choices, remembered in this browser between visits. */

export type ThemePreference = "system" | "light" | "dark";

export type PracticeSettings = Pick<
  PracticeRules,
  "W" | "H" | "scoring" | "winScore" | "difficulty" | "fadeTurns"
>;

export interface Settings {
  soloMode: SoloMode;
  practice: PracticeSettings;
  /** Square hints in Practice. */
  assist: boolean;
  theme: ThemePreference;
}

export const DEFAULT_SETTINGS: Settings = {
  soloMode: "practice",
  practice: {
    W: DEFAULT_PRACTICE_RULES.W,
    H: DEFAULT_PRACTICE_RULES.H,
    scoring: DEFAULT_PRACTICE_RULES.scoring,
    winScore: DEFAULT_PRACTICE_RULES.winScore,
    difficulty: DEFAULT_PRACTICE_RULES.difficulty,
    fadeTurns: DEFAULT_PRACTICE_RULES.fadeTurns,
  },
  assist: false,
  theme: "system",
};

export const THEME_PREFERENCES: readonly ThemePreference[] = [
  "system",
  "light",
  "dark",
];

export function practiceRules(practice: PracticeSettings): PracticeRules {
  return validatePracticeRules({ ...practice });
}

export const bestPossibleScore = (practice: PracticeSettings) =>
  totalSquareScore(practice.W, practice.H, practice.scoring);

export const recommendedScore = (practice: PracticeSettings) =>
  recommendedWinTarget(practice.W, practice.H, practice.scoring);

/**
 * Applies a Practice change. A new board size or scoring rule resets the
 * target to the recommended score for that board; the player can then
 * override it.
 */
export function updatePractice(
  practice: PracticeSettings,
  change: Partial<PracticeSettings>,
): PracticeSettings {
  const next = { ...practice, ...change };
  const boardChanged =
    next.W !== practice.W ||
    next.H !== practice.H ||
    next.scoring !== practice.scoring;
  if (boardChanged && change.winScore === undefined) {
    next.winScore = recommendedScore(next);
  }
  next.winScore = Math.max(
    1,
    Math.min(bestPossibleScore(next), Math.round(next.winScore)),
  );
  return next;
}

export function restoreSettings(value: unknown): Settings | null {
  if (!value || typeof value !== "object") return null;
  const source = value as Record<string, unknown>;
  const practiceSource = source.practice as Record<string, unknown> | undefined;
  let practice: PracticeSettings;
  try {
    const rules = validatePracticeRules({
      W: practiceSource?.W,
      H: practiceSource?.H,
      scoring: practiceSource?.scoring,
      winScore: practiceSource?.winScore,
      difficulty: practiceSource?.difficulty,
      fadeTurns: practiceSource?.fadeTurns,
    });
    practice = {
      W: rules.W,
      H: rules.H,
      scoring: rules.scoring,
      winScore: rules.winScore,
      difficulty: rules.difficulty,
      fadeTurns: rules.fadeTurns,
    };
  } catch {
    practice = DEFAULT_SETTINGS.practice;
  }
  return {
    soloMode: source.soloMode === "ranked" ? "ranked" : "practice",
    practice,
    assist: source.assist === true,
    theme: THEME_PREFERENCES.includes(source.theme as ThemePreference)
      ? (source.theme as ThemePreference)
      : "system",
  };
}
