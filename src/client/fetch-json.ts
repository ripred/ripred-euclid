import { errorMessage } from "../shared/error-message";
import { isRecord } from "../shared/guards";

/** Preserve a rejected command's status so callers can reconcile or retry safely. */
export class JsonRequestError extends Error {
  override readonly name = "JsonRequestError";
  constructor(
    message: string,
    readonly status: number,
    readonly payload: Record<string, unknown> | null,
  ) {
    super(message);
  }
}

/** Share transport handling; each caller still validates its own response fields. */
export async function fetchJsonRecord(
  url: string,
  failureMessage: string,
  init?: RequestInit,
): Promise<Record<string, unknown> | null> {
  const response = await fetch(url, init);
  const payload: unknown = await response.json().catch(() => null);
  const record = isRecord(payload) ? payload : null;
  if (!response.ok) {
    throw new JsonRequestError(
      errorMessage(record?.message, failureMessage),
      response.status,
      record,
    );
  }
  return record;
}
