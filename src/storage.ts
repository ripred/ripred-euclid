/**
 * Everything Euclid remembers lives in this browser's local storage. Storage
 * can be unavailable (private windows, blocked site data) or hold data from
 * an older version, so every read validates and every access tolerates
 * failure: the game always starts, at worst with defaults.
 */

export const STORAGE_KEYS = {
  game: "euclid.game.v1",
  records: "euclid.records.v1",
  settings: "euclid.settings.v1",
  tutorial: "euclid.tutorial.v1",
  sound: "euclid.sound.v1",
} as const;

type StorageKey = (typeof STORAGE_KEYS)[keyof typeof STORAGE_KEYS];

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

/** Reads JSON and hands it to a validator; anything invalid yields the fallback. */
export function readStored<T>(
  key: StorageKey,
  restore: (value: unknown) => T | null,
  fallback: T,
): T {
  try {
    const raw = storage()?.getItem(key);
    if (raw === null || raw === undefined) return fallback;
    return restore(JSON.parse(raw)) ?? fallback;
  } catch {
    return fallback;
  }
}

export function writeStored(key: StorageKey, value: unknown): void {
  try {
    storage()?.setItem(key, JSON.stringify(value));
  } catch {
    // A full or blocked store must never interrupt play.
  }
}

export function removeStored(key: StorageKey): void {
  try {
    storage()?.removeItem(key);
  } catch {
    // Nothing to clean up when storage is unavailable.
  }
}
