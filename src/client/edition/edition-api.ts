import type {
  EditionSnapshot,
  EditionState,
} from "../../shared/edition-contract";

export class EditionRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/** One bounded, cancellable transport for owner commands and spectator reads. */
export async function requestEdition(
  path: string,
  signal: AbortSignal,
  body?: object,
): Promise<unknown> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal.addEventListener("abort", abort, { once: true });
  if (signal.aborted) abort();
  const timeout = window.setTimeout(abort, 20000);
  try {
    const response = await fetch(`/api/edition/${path}`, {
      method: body ? "POST" : "GET",
      cache: "no-store",
      signal: controller.signal,
      ...(body
        ? {
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          }
        : {}),
    });
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new EditionRequestError(
        "The game service returned an unreadable response. Please reconnect.",
        response.status,
      );
    }
    if (!response.ok)
      throw new EditionRequestError(
        payload && typeof payload === "object" && "error" in payload
          ? String(payload.error)
          : "The game service is temporarily unavailable. Please reconnect.",
        response.status,
      );
    return payload;
  } catch (failure) {
    if (controller.signal.aborted && !signal.aborted)
      throw new EditionRequestError(
        "Connection timed out. Please reconnect.",
        0,
      );
    throw failure;
  } finally {
    window.clearTimeout(timeout);
    signal.removeEventListener("abort", abort);
  }
}

export function readSnapshot(
  value: unknown,
): EditionSnapshot<EditionState> | null {
  if (value === null) return null;
  if (
    typeof value !== "object" ||
    !("id" in value) ||
    typeof value.id !== "string" ||
    !("mode" in value) ||
    !["solo", "duel", "puzzle"].includes(String(value.mode)) ||
    !("state" in value) ||
    !value.state ||
    typeof value.state !== "object" ||
    !("revision" in value.state) ||
    !Number.isInteger(value.state.revision)
  )
    throw new EditionRequestError("The server returned an invalid game.", 0);
  return value as EditionSnapshot<EditionState>;
}

/** Polling metadata must not restart board animations or clear point selection. */
export function retainBoard<T extends EditionSnapshot<EditionState>>(
  previous: T | null,
  next: T | null,
): T | null {
  if (
    previous &&
    next &&
    previous.id === next.id &&
    previous.state.revision === next.state.revision &&
    JSON.stringify(previous.state) === JSON.stringify(next.state)
  )
    return { ...next, state: previous.state };
  return next;
}
