import { errorMessage } from "../shared/error-message";
import { isRecord } from "../shared/guards";

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
