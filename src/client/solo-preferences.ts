import { isAiDifficulty, type AiDifficulty } from "../shared/game/rules";

const DIFFICULTY_KEY = "euclid_practice_difficulty";

export function readPracticeDifficulty(): AiDifficulty {
  try {
    const value = window.localStorage.getItem(DIFFICULTY_KEY);
    return isAiDifficulty(value) ? value : "beginner";
  } catch {
    return "beginner";
  }
}

export function savePracticeDifficulty(value: AiDifficulty): void {
  try {
    window.localStorage.setItem(DIFFICULTY_KEY, value);
  } catch {
    // Restricted browser storage must not prevent changing game settings.
  }
}
