import type {
  EditionDefinition,
  EditionState,
  EditionWatchSnapshot,
  LiveEditionGame,
} from "./edition-contract";
import type { EditionSession } from "./edition-session";

export const LIVE_IDLE_MS = 10 * 60 * 1000;
export const WATCH_RETENTION_MS = 24 * 60 * 60 * 1000;
export const LIVE_LIST_LIMIT = 50;

export function isEditionGameId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      value,
    )
  );
}

/** A public display label is not a storage identity or an authorization token. */
export function editionHostName(value: unknown): string {
  return typeof value === "string" && /^[a-zA-Z0-9_-]{1,40}$/.test(value)
    ? value
    : "Redditor";
}

export function editionWatchSnapshot<T extends EditionState>(
  definition: EditionDefinition<T>,
  session: EditionSession<T> | null,
  gameId: string,
  now: number,
): EditionWatchSnapshot<T> | null {
  const updatedAt = session?.activity?.updatedAt;
  if (
    !session ||
    !isEditionGameId(gameId) ||
    session.id !== gameId ||
    session.spectatorsEnabled !== true ||
    typeof updatedAt !== "number" ||
    !Number.isFinite(updatedAt) ||
    updatedAt > now ||
    updatedAt <= now - WATCH_RETENTION_MS
  )
    return null;
  return {
    id: session.id,
    mode: session.mode,
    state: definition.spectatorState?.(session.state) ?? session.state,
    hostName: editionHostName(session.activity?.hostName),
    updatedAt,
  };
}

export function editionLiveSummary<T extends EditionState>(
  snapshot: EditionWatchSnapshot<T> | null,
  now: number,
): LiveEditionGame | null {
  if (
    !snapshot ||
    snapshot.state.winner !== null ||
    snapshot.updatedAt <= now - LIVE_IDLE_MS
  )
    return null;
  return {
    id: snapshot.id,
    mode: snapshot.mode,
    hostName: snapshot.hostName,
    updatedAt: snapshot.updatedAt,
    revision: snapshot.state.revision,
  };
}
