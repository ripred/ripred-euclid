import { isAiDifficulty, type AiDifficulty } from "../shared/game/rules";
import { isRecord } from "../shared/guards";

/**
 * Options and gameplay share this device's practice preferences.
 * Game rules come from the server; these choices only affect difficulty and hints.
 */
export interface PracticePreferences {
  difficulty: AiDifficulty;
  assist: boolean;
}

/** How the square-hints preference is labelled wherever it is offered. */
export const SQUARE_HINTS_COPY = {
  label: "Square hints",
  hint: "Inspect your pieces to see potential square values on highlighted points. Inspect an open point for its combined move score. On touch, tap again to place.",
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
