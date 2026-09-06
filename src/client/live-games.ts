import { useCallback, useEffect, useRef, useState } from "react";

import type { H2HLiveGameSummary } from "../shared/types/api";
import { errorMessage } from "./error-message";
import { fetchJsonRecord, isRecord } from "./fetch-json";

export const LIVE_GAMES_REFRESH_MS = 30_000;

export type LiveGamesState = {
  games: H2HLiveGameSummary[];
  loading: boolean;
  error: string;
};

const emptyState: LiveGamesState = { games: [], loading: false, error: "" };

function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isLiveGame(value: unknown): value is H2HLiveGameSummary {
  if (!isRecord(value)) return false;
  return (
    typeof value.gameId === "string" &&
    value.gameId.trim() !== "" &&
    Array.isArray(value.playerIds) &&
    value.playerIds.length === 2 &&
    value.playerIds.every((id) => typeof id === "string" && id.trim() !== "") &&
    value.playerIds[0] !== value.playerIds[1] &&
    isRecord(value.names) &&
    Object.values(value.names).every((name) => typeof name === "string") &&
    Array.isArray(value.scores) &&
    value.scores.length === 2 &&
    value.scores.every(isCount) &&
    isCount(value.lastSaved) &&
    isCount(value.revision) &&
    isCount(value.width) &&
    value.width > 0 &&
    isCount(value.height) &&
    value.height > 0 &&
    (value.scoring === "bbox" || value.scoring === "true") &&
    isCount(value.winScore) &&
    value.winScore > 0
  );
}

/** A failed or unreadable request is not evidence that no games are available. */
export async function fetchLiveGames(
  signal?: AbortSignal,
): Promise<H2HLiveGameSummary[]> {
  const payload = await fetchJsonRecord(
    "/api/games/list",
    "Unable to load live games. Try again.",
    signal,
  );
  if (
    !payload ||
    !Array.isArray(payload.games) ||
    !payload.games.every(isLiveGame)
  ) {
    throw new Error("The live-games response could not be read. Try again.");
  }
  return payload.games
    .slice()
    .sort((left, right) => right.lastSaved - left.lastSaved);
}

/** Owns one visible lobby's requests; navigation disposes every callback and timer. */
export function observeLiveGames(onChange: (state: LiveGamesState) => void): {
  refresh: () => void;
  dispose: () => void;
} {
  let state = { ...emptyState };
  let disposed = false;
  let request = 0;
  let controller: AbortController | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let lastStarted = -Infinity;

  const update = (changes: Partial<LiveGamesState>) => {
    state = { ...state, ...changes };
    onChange(state);
  };
  const cancelTimer = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  };
  const schedule = (delay = LIVE_GAMES_REFRESH_MS) => {
    cancelTimer();
    if (!disposed && document.visibilityState !== "hidden") {
      timer = setTimeout(() => void load(), delay);
    }
  };
  const load = async () => {
    if (disposed || controller || document.visibilityState === "hidden") return;
    cancelTimer();
    const currentRequest = ++request;
    controller = new AbortController();
    const signal = controller.signal;
    lastStarted = Date.now();
    update({ loading: true, error: "" });
    try {
      const games = await fetchLiveGames(signal);
      if (!disposed && currentRequest === request) update({ games, error: "" });
    } catch (error) {
      if (!disposed && currentRequest === request && !signal.aborted) {
        update({
          error: errorMessage(error, "Unable to load live games. Try again."),
        });
      }
    } finally {
      if (!disposed && currentRequest === request) {
        controller = null;
        update({ loading: false });
        schedule();
      }
    }
  };
  const cancelRequest = () => {
    ++request;
    controller?.abort();
    controller = null;
    cancelTimer();
  };
  const onVisibilityChange = () => {
    if (document.visibilityState === "hidden") {
      cancelRequest();
      update({ loading: false });
    } else {
      // Rapid tab switching must not turn a passive lobby into a tight poll loop.
      schedule(Math.max(0, LIVE_GAMES_REFRESH_MS - (Date.now() - lastStarted)));
    }
  };

  onChange(state);
  document.addEventListener("visibilitychange", onVisibilityChange);
  void load();
  return {
    refresh: () => void load(),
    dispose: () => {
      disposed = true;
      cancelRequest();
      document.removeEventListener("visibilitychange", onVisibilityChange);
    },
  };
}

export function useLiveGames(
  active: boolean,
): LiveGamesState & { refresh: () => void } {
  const [state, setState] = useState<LiveGamesState>({
    ...emptyState,
    loading: active,
  });
  const refreshRef = useRef<(() => void) | null>(null);
  const refresh = useCallback(() => refreshRef.current?.(), []);

  useEffect(() => {
    if (!active) {
      setState(emptyState);
      return;
    }
    const observer = observeLiveGames(setState);
    refreshRef.current = observer.refresh;
    return () => {
      refreshRef.current = null;
      observer.dispose();
    };
  }, [active]);

  return { ...state, refresh };
}
