/*
 * Runtime checks for untrusted values, shared by the browser and the server.
 * Callers decide what a failed check means, so each keeps its own error.
 */

/** A plain object read from untrusted JSON: not null and not an array. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A non-negative safe integer: counts, revisions, timestamps and indices. */
export function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

/** A count, or null where a value is not known yet. */
export const isCountOrNull = (value: unknown): value is number | null =>
  value === null || isCount(value);

/** The value when it is a count, otherwise null. */
export const asCount = (value: unknown): number | null =>
  isCount(value) ? value : null;

/** A string with at least one visible character. */
export function isNonBlankString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export const MAX_IDENTIFIER_LENGTH = 256;

/** A stored identifier: 1 to 256 characters with no surrounding spaces. */
export function isCanonicalIdentifier(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length >= 1 &&
    value.length <= MAX_IDENTIFIER_LENGTH &&
    value.trim() === value
  );
}

/** True when every key is one of `keys`; missing keys are allowed. */
export const hasOnlyKeys = (
  value: Record<string, unknown>,
  keys: readonly string[],
): boolean => Object.keys(value).every((key) => keys.includes(key));

export function isStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.every((item) => typeof item === "string")
  );
}
