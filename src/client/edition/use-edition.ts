import { useCallback, useEffect, useRef, useState } from "react";
import type {
  EditionSnapshot,
  EditionState,
  PlayMode,
} from "../../shared/edition-contract";

/** No board or score is uploaded: only a move intent tied to the displayed revision. */
export function useEdition<T extends EditionState>() {
  const [snapshot, setSnapshot] = useState<EditionSnapshot<T> | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const current = useRef<EditionSnapshot<T> | null>(null);
  const locked = useRef(false);
  const mounted = useRef(false);
  const adopt = useCallback((next: EditionSnapshot<T> | null) => {
    current.current = next;
    if (mounted.current) setSnapshot(next);
  }, []);
  const request = useCallback(
    async (body?: object): Promise<EditionSnapshot<T> | null> => {
      // AbortController also works in browsers predating AbortSignal.timeout.
      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), 20000);
      try {
        const response = await fetch(
          `/api/edition/${body ? "command" : "state"}`,
          {
            method: body ? "POST" : "GET",
            cache: "no-store",
            ...(body
              ? {
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify(body),
                }
              : {}),
            signal: controller.signal,
          },
        );
        let payload: unknown;
        try {
          payload = await response.json();
        } catch {
          throw new Error(
            response.status >= 500
              ? "The game service is temporarily unavailable. Please reconnect."
              : "The server returned an unreadable response. Please reconnect.",
          );
        }
        if (!response.ok) {
          const message =
            payload && typeof payload === "object" && "error" in payload
              ? String(payload.error)
              : "The server could not confirm that move.";
          throw new Error(message);
        }
        if (
          payload !== null &&
          (typeof payload !== "object" ||
            !("state" in payload) ||
            !("id" in payload))
        )
          throw new Error("The server returned an invalid game.");
        return payload as EditionSnapshot<T> | null;
      } finally {
        window.clearTimeout(timeout);
      }
    },
    [],
  );
  const reload = useCallback(async () => {
    if (locked.current) return;
    locked.current = true;
    setBusy(true);
    try {
      adopt(await request());
      setError(null);
    } catch (failure) {
      if (mounted.current)
        setError(
          failure instanceof Error ? failure.message : "Unable to reconnect.",
        );
    } finally {
      locked.current = false;
      if (mounted.current) {
        setBusy(false);
        setLoading(false);
      }
    }
  }, [adopt, request]);
  useEffect(() => {
    mounted.current = true;
    void reload();
    const onFocus = () => {
      void reload();
    };
    window.addEventListener("focus", onFocus);
    return () => {
      mounted.current = false;
      window.removeEventListener("focus", onFocus);
    };
  }, [reload]);
  const submit = useCallback(
    async (intent: object): Promise<boolean> => {
      // The ref closes the gap before React renders the disabled state. No input queue.
      if (locked.current) return false;
      locked.current = true;
      setBusy(true);
      setError(null);
      const shown = current.current;
      try {
        adopt(
          await request({
            ...intent,
            commandId: crypto.randomUUID(),
            expectedId: shown?.id,
            expectedRevision: shown?.state.revision,
          }),
        );
        return true;
      } catch (failure) {
        // A lost response can still mean a committed move. Reconcile, never replay it.
        try {
          adopt(await request());
        } catch {
          /* Keep the last confirmed board visible. */
        }
        if (mounted.current)
          setError(
            failure instanceof Error
              ? failure.message
              : "Move not confirmed. Please reconnect.",
          );
        return false;
      } finally {
        locked.current = false;
        if (mounted.current) {
          setBusy(false);
          setLoading(false);
        }
      }
    },
    [adopt, request],
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
  return {
    game: snapshot?.state ?? null,
    mode: snapshot?.mode ?? "solo",
    loading,
    busy,
    error,
    start,
    move,
    reload,
  };
}
