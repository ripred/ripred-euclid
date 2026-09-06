import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import type {
  EditionSnapshot,
  EditionState,
  EditionWatchSnapshot,
  PlayMode,
} from "../../shared/edition-contract";
import {
  EditionRequestError,
  readSnapshot,
  requestEdition,
  retainBoard,
} from "./edition-api";

type Snapshot = EditionSnapshot<EditionState>;
type WatchSnapshot = EditionWatchSnapshot<EditionState>;
const failureMessage = (failure: unknown) =>
  failure instanceof Error ? failure.message : "Unable to reconnect.";

/** A provider owns one transport. Watching never replaces the player's session. */
export function useEditionSession() {
  const [owner, setOwner] = useState<Snapshot | null>(null);
  const [ownerLoading, setOwnerLoading] = useState(true);
  const [ownerBusy, setOwnerBusy] = useState(false);
  const [ownerError, setOwnerError] = useState<string | null>(null);
  const [watched, setWatched] = useState<WatchSnapshot | null>(null);
  const [watchedId, setWatchedId] = useState<string | null>(null);
  const [watchLoading, setWatchLoading] = useState(false);
  const [watchError, setWatchError] = useState<string | null>(null);
  const ownerRef = useRef<Snapshot | null>(null);
  const ownerRequest = useRef<AbortController | null>(null);
  const watchRequest = useRef<AbortController | null>(null);
  const watchId = useRef<string | null>(null);
  const watchEpoch = useRef(0);
  const unavailable = useRef(false);
  const mounted = useRef(false);

  const adoptOwner = useCallback((snapshot: Snapshot | null) => {
    ownerRef.current = retainBoard(ownerRef.current, snapshot);
    setOwner(ownerRef.current);
  }, []);

  const loadOwner = useCallback(async () => {
    if (!mounted.current || ownerRequest.current) return;
    const controller = new AbortController();
    ownerRequest.current = controller;
    setOwnerBusy(true);
    try {
      const next = readSnapshot(
        await requestEdition("state", controller.signal),
      );
      if (!controller.signal.aborted && mounted.current) {
        adoptOwner(next);
        setOwnerError(null);
      }
    } catch (failure) {
      if (!controller.signal.aborted && mounted.current)
        setOwnerError(failureMessage(failure));
    } finally {
      if (ownerRequest.current === controller) {
        ownerRequest.current = null;
        if (mounted.current) {
          setOwnerBusy(false);
          setOwnerLoading(false);
        }
      }
    }
  }, [adoptOwner]);

  const loadWatched = useCallback(async () => {
    const id = watchId.current;
    if (!mounted.current || !id || watchRequest.current || unavailable.current)
      return;
    const epoch = watchEpoch.current;
    const controller = new AbortController();
    watchRequest.current = controller;
    const isCurrent = () =>
      mounted.current &&
      !controller.signal.aborted &&
      watchId.current === id &&
      watchEpoch.current === epoch;
    try {
      const payload = await requestEdition(
        `watch/${encodeURIComponent(id)}`,
        controller.signal,
      );
      const next = readSnapshot(payload);
      if (
        !next ||
        next.id !== id ||
        !("hostName" in next) ||
        typeof next.hostName !== "string"
      )
        throw new EditionRequestError(
          "The server returned an invalid live game.",
          0,
        );
      if (isCurrent()) {
        setWatched((previous) => retainBoard(previous, next as WatchSnapshot));
        setWatchError(null);
      }
    } catch (failure) {
      if (isCurrent()) {
        if (
          failure instanceof EditionRequestError &&
          [403, 404, 410].includes(failure.status)
        ) {
          unavailable.current = true;
          setWatched(null);
          setWatchError("This game is no longer available to watch.");
        } else {
          setWatchError(
            `${failureMessage(failure)} Retrying; any board shown is the last confirmed state.`,
          );
        }
      }
    } finally {
      if (watchRequest.current === controller) watchRequest.current = null;
      if (isCurrent()) setWatchLoading(false);
    }
  }, []);

  const reload = useCallback(async () => {
    if (watchId.current) {
      unavailable.current = false;
      await loadWatched();
    } else await loadOwner();
  }, [loadOwner, loadWatched]);

  useEffect(() => {
    mounted.current = true;
    void loadOwner();
    const onFocus = () => {
      void reload();
    };
    const onVisibility = () => {
      if (!document.hidden) void reload();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      mounted.current = false;
      ownerRequest.current?.abort();
      ownerRequest.current = null;
      watchRequest.current?.abort();
      watchRequest.current = null;
      watchEpoch.current += 1;
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [loadOwner, reload]);

  useEffect(() => {
    if (!watchedId) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      if (!document.hidden) await loadWatched();
      // Serial polling includes finished puzzles: the host can undo a final move.
      if (!cancelled)
        timer = setTimeout(() => {
          void poll();
        }, 1000);
    };
    void poll();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [watchedId, loadWatched]);

  const watch = useCallback(async (id: string) => {
    if (!id || id === ownerRef.current?.id || id === watchId.current) return;
    // This ref closes the event-to-render gap for every mutation handler.
    watchEpoch.current += 1;
    watchId.current = id;
    watchRequest.current?.abort();
    watchRequest.current = null;
    unavailable.current = false;
    setWatched(null);
    setWatchError(null);
    setWatchLoading(true);
    setWatchedId(id);
  }, []);

  const stopWatching = useCallback(() => {
    watchEpoch.current += 1;
    watchId.current = null;
    watchRequest.current?.abort();
    watchRequest.current = null;
    unavailable.current = false;
    setWatchedId(null);
    setWatched(null);
    setWatchError(null);
    setOwnerLoading(true);
    void loadOwner();
  }, [loadOwner]);

  const submit = useCallback(
    async (intent: object): Promise<boolean> => {
      // Only intents are uploaded, never browser board state, scores, or identity.
      if (
        !mounted.current ||
        watchId.current ||
        ownerRequest.current ||
        ownerLoading
      )
        return false;
      const controller = new AbortController();
      ownerRequest.current = controller;
      const epoch = watchEpoch.current;
      const current = ownerRef.current;
      setOwnerBusy(true);
      setOwnerError(null);
      try {
        const next = readSnapshot(
          await requestEdition("command", controller.signal, {
            ...intent,
            commandId: crypto.randomUUID(),
            expectedId: current?.id,
            expectedRevision: current?.state.revision,
          }),
        );
        if (!next)
          throw new EditionRequestError(
            "The server returned an invalid game.",
            0,
          );
        if (!mounted.current || controller.signal.aborted) return false;
        adoptOwner(next);
        return epoch === watchEpoch.current;
      } catch (failure) {
        if (!mounted.current || controller.signal.aborted) return false;
        // A lost response can still mean a committed move. Reconcile, never replay.
        try {
          const next = readSnapshot(
            await requestEdition("state", controller.signal),
          );
          if (mounted.current && !controller.signal.aborted) adoptOwner(next);
        } catch {
          /* Keep the last confirmed personal board. */
        }
        if (mounted.current && !controller.signal.aborted)
          setOwnerError(failureMessage(failure));
        return false;
      } finally {
        if (ownerRequest.current === controller) {
          ownerRequest.current = null;
          if (mounted.current) {
            setOwnerBusy(false);
            setOwnerLoading(false);
          }
        }
      }
    },
    [adoptOwner, ownerLoading],
  );

  const start = useCallback(
    (options: unknown = {}, mode: PlayMode = "solo") =>
      submit({ kind: "start", options, mode }),
    [submit],
  );
  const move = useCallback(
    (action: unknown) => submit({ kind: "move", action }),
    [submit],
  );
  const setSpectatorsEnabled = useCallback(
    (enabled: boolean) => submit({ kind: "spectators", enabled }),
    [submit],
  );
  const watching = watchedId !== null;
  const shown = watching ? watched : owner;
  return {
    gameId: shown?.id ?? null,
    game: shown?.state ?? null,
    mode: shown?.mode ?? "solo",
    loading: watching ? watchLoading : ownerLoading,
    busy: watching ? watchLoading : ownerBusy,
    error: watching ? watchError : ownerError,
    watching,
    watchedId,
    hostName: watching ? (watched?.hostName ?? null) : null,
    ownerGameId: owner?.id ?? null,
    spectatorsEnabled: owner?.spectatorsEnabled === true,
    start,
    move,
    reload,
    watch,
    stopWatching,
    setSpectatorsEnabled,
  };
}
export const EditionContext = createContext<ReturnType<
  typeof useEditionSession
> | null>(null);

export function useEdition<T extends EditionState>() {
  const session = useContext(EditionContext);
  if (!session) throw new Error("Game controls require an EditionProvider.");
  return { ...session, game: session.game as T | null };
}
