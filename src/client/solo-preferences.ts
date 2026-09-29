import { isAiDifficulty, type AiDifficulty } from "../shared/game/rules";
import { isRecord } from "../shared/guards";

/**
 * Options and gameplay share this device's practice preferences.
 * Every game uses the standard board; winning score is session-specific.
 */
export interface PracticePreferences {
  difficulty: AiDifficulty;
  assist: boolean;
}

/** How the square-hints preference is labelled wherever it is offered. */
export const SQUARE_HINTS_COPY = {
  label: "Square hints",
  hint: "Hover or press one of your pieces to see the points that finish a square in one or two moves.",
} as const;

export const DEFAULT_PRACTICE_PREFERENCES: PracticePreferences = {
  difficulty: "beginner",
  assist: false,
};

const PREFERENCES_KEY = "euclid_practice_setup";

/** Every field is checked on its own, so one stale value keeps the rest. */
export function readPracticePreferences(): PracticePreferences {
  const fallback = DEFAULT_PRACTICE_PREFERENCES;
  try {
    const parsed: unknown = JSON.parse(
      window.localStorage.getItem(PREFERENCES_KEY) ?? "null",
    );
    const saved = isRecord(parsed) ? parsed : {};
    return {
      difficulty: isAiDifficulty(saved.difficulty)
        ? saved.difficulty
        : fallback.difficulty,
      assist:
        typeof saved.assist === "boolean" ? saved.assist : fallback.assist,
    };
  } catch {
    return fallback;
  }
}

export function savePracticePreferences(preferences: PracticePreferences) {
  try {
    window.localStorage.setItem(PREFERENCES_KEY, JSON.stringify(preferences));
  } catch {
    // Restricted browser storage must not prevent changing game settings.
  }
}
