import type { H2HMappingResponse } from "../shared/types/api";

export type HomeQueueOperation = "join" | "cancel";

export interface QueueRecoveryDecision {
  action: "enter" | "poll" | "idle";
  operationCompleted: boolean;
  clearActionError: boolean;
  status: string;
}

/**
 * Resolves a failed queue command from a fresh authoritative presence read.
 * Transport success is deliberately ignored; only the observed server state
 * decides whether the requested join or cancellation completed.
 */
export function resolveQueueRecovery(
  operation: HomeQueueOperation,
  state: H2HMappingResponse["state"],
): QueueRecoveryDecision {
  const operationCompleted =
    operation === "join" ? state !== "idle" : state === "idle";

  return {
    action: state === "active" ? "enter" : state === "queued" ? "poll" : "idle",
    operationCompleted,
    clearActionError: operationCompleted,
    status:
      state === "queued"
        ? "Searching for another redditor…"
        : operation === "cancel" && state === "idle"
          ? "Search canceled."
          : "",
  };
}

export interface H2HRequestIdentity {
  session: number;
  gameId?: string;
}

/** Prevents an invalidated request from mutating a newer route or game. */
export function isCurrentH2HRequest(
  request: H2HRequestIdentity,
  currentSession: number,
  currentGameId?: string | null,
): boolean {
  return (
    request.session === currentSession &&
    (request.gameId === undefined || request.gameId === currentGameId)
  );
}
