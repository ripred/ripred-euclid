import { errorMessage } from "./error-message";

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Share transport handling; each caller still validates its own response fields. */
export async function fetchJsonRecord(
  url: string,
  failureMessage: string,
  signal?: AbortSignal,
): Promise<Record<string, unknown> | null> {
  const response = await fetch(url, signal ? { signal } : undefined);
  const payload: unknown = await response.json().catch(() => null);
  const record = isRecord(payload) ? payload : null;
  if (!response.ok) {
    throw new Error(errorMessage(record?.message, failureMessage));
  }
  return record;
}
