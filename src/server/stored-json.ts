import { isStringArray } from "../shared/guards";

/*
 * Reading JSON text, usually values the server stored. A missing value reads
 * as undefined; `malformed` decides what unreadable text means to the caller.
 */
export function parseJson(
  raw: string | null | undefined,
  malformed: () => unknown = () => undefined,
): unknown {
  if (!raw) return undefined;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return malformed();
  }
}

/** A stored list of strings; missing or unreadable lists read as empty. */
export function readStringList(raw: string | null | undefined): string[] {
  const parsed = parseJson(raw);
  return isStringArray(parsed) ? parsed : [];
}

/** Distinct non-empty strings, in first-seen order. */
export function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values.filter((value) => value.length > 0))];
}
