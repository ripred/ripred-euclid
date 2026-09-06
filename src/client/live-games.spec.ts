import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { H2HLiveGameSummary } from "../shared/types/api";
import {
  fetchLiveGames,
  LIVE_GAMES_REFRESH_MS,
  observeLiveGames,
  type LiveGamesState,
} from "./live-games";

const fetchMock = vi.fn<typeof fetch>();
const disposers: Array<() => void> = [];

class VisibleDocument extends EventTarget {
  visibilityState: DocumentVisibilityState = "visible";

  setVisibility(value: DocumentVisibilityState) {
    this.visibilityState = value;
    this.dispatchEvent(new Event("visibilitychange"));
  }
}

let documentMock: VisibleDocument;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(10_000);
  fetchMock.mockReset();
  documentMock = new VisibleDocument();
  vi.stubGlobal("document", documentMock);
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const game: H2HLiveGameSummary = {
  gameId: "game-1",
  playerIds: ["first", "second"],
  names: { second: "Second player", first: "First player" },
  scores: [4, 0],
  lastSaved: 1_000,
  revision: 7,
  width: 8,
  height: 8,
  scoring: "bbox",
  winScore: 150,
};

function response(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function deferredResponse() {
  let resolve!: (value: Response) => void;
  const promise = new Promise<Response>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function observe() {
  const changes: LiveGamesState[] = [];
  const observer = observeLiveGames((state) => changes.push(state));
  disposers.push(observer.dispose);
  return { ...observer, changes, latest: () => changes.at(-1) };
}

describe("live-game requests", () => {
  it("preserves ordered player identities and canonical fields while sorting newest first", async () => {
    const newer = { ...game, gameId: "newer", lastSaved: 2_000 };
    fetchMock.mockResolvedValue(response({ games: [game, newer] }));
    await expect(fetchLiveGames()).resolves.toEqual([newer, game]);
  });

  it("accepts an explicitly empty successful list", async () => {
    fetchMock.mockResolvedValue(response({ games: [] }));
    await expect(fetchLiveGames()).resolves.toEqual([]);
  });

  it("does not interpret an HTTP failure as an empty lobby", async () => {
    fetchMock.mockResolvedValue(
      response({ games: [], message: "Try later" }, 503),
    );
    await expect(fetchLiveGames()).rejects.toThrow("Try later");
  });

  it("gives an actionable error for a non-JSON HTTP failure", async () => {
    fetchMock.mockResolvedValue(new Response("Unavailable", { status: 502 }));
    await expect(fetchLiveGames()).rejects.toThrow(
      "Unable to load live games. Try again.",
    );
  });

  it.each([
    null,
    {},
    { games: {} },
    { games: [null] },
    { games: [{ ...game, playerIds: ["first"] }] },
    { games: [{ ...game, playerIds: ["first", "first"] }] },
    { games: [{ ...game, playerIds: ["", "second"] }] },
    { games: [{ ...game, scores: [0] }] },
    { games: [{ ...game, scores: [-1, 0] }] },
    { games: [{ ...game, names: { first: 15 } }] },
    { games: [{ ...game, lastSaved: "1000" }] },
    { games: [{ ...game, scoring: "unknown" }] },
    { games: [{ ...game, width: 0 }] },
    { games: [{ ...game, height: 1.5 }] },
    { games: [{ ...game, winScore: 0 }] },
    { games: [{ ...game, revision: -1 }] },
  ])("rejects malformed successful data", async (payload) => {
    fetchMock.mockResolvedValue(response(payload));
    await expect(fetchLiveGames()).rejects.toThrow(
      "The live-games response could not be read. Try again.",
    );
  });

  it("passes the owner's cancellation signal to fetch", async () => {
    const controller = new AbortController();
    fetchMock.mockResolvedValue(response({ games: [] }));
    await fetchLiveGames(controller.signal);
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith("/api/games/list", {
      signal: controller.signal,
    });
  });
});

describe("visible lobby request lifecycle", () => {
  it("refreshes conservatively without overlapping a slow request", async () => {
    const pending = deferredResponse();
    fetchMock
      .mockReturnValueOnce(pending.promise)
      .mockResolvedValue(response({ games: [game] }));
    const lobby = observe();
    expect(lobby.latest()?.loading).toBe(true);
    lobby.refresh();
    await vi.advanceTimersByTimeAsync(LIVE_GAMES_REFRESH_MS * 2);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    pending.resolve(response({ games: [game] }));
    await vi.advanceTimersByTimeAsync(0);
    expect(lobby.latest()).toEqual({
      games: [game],
      loading: false,
      error: "",
    });
    await vi.advanceTimersByTimeAsync(LIVE_GAMES_REFRESH_MS - 1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("retains known games with an explicit failure and permits a manual retry", async () => {
    fetchMock
      .mockResolvedValueOnce(response({ games: [game] }))
      .mockResolvedValueOnce(
        response({ message: "Temporarily unavailable" }, 503),
      )
      .mockResolvedValueOnce(response({ games: [] }));
    const lobby = observe();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(LIVE_GAMES_REFRESH_MS);
    expect(lobby.latest()).toEqual({
      games: [game],
      loading: false,
      error: "Temporarily unavailable",
    });
    await vi.advanceTimersByTimeAsync(LIVE_GAMES_REFRESH_MS - 1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    lobby.refresh();
    await vi.advanceTimersByTimeAsync(0);
    expect(lobby.latest()).toEqual({ games: [], loading: false, error: "" });
  });

  it("does no initial or interval work while hidden", async () => {
    documentMock.setVisibility("hidden");
    fetchMock.mockResolvedValue(response({ games: [] }));
    observe();
    await vi.advanceTimersByTimeAsync(LIVE_GAMES_REFRESH_MS * 2);
    expect(fetchMock).not.toHaveBeenCalled();
    documentMock.setVisibility("visible");
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    documentMock.setVisibility("hidden");
    await vi.advanceTimersByTimeAsync(LIVE_GAMES_REFRESH_MS * 2);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("aborts hidden requests and ignores their late responses after returning", async () => {
    const first = deferredResponse();
    fetchMock
      .mockReturnValueOnce(first.promise)
      .mockResolvedValue(response({ games: [] }));
    const lobby = observe();
    const signal = fetchMock.mock.calls[0]?.[1]?.signal;
    documentMock.setVisibility("hidden");
    expect(signal?.aborted).toBe(true);
    documentMock.setVisibility("visible");
    await vi.advanceTimersByTimeAsync(LIVE_GAMES_REFRESH_MS);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    first.resolve(response({ games: [game] }));
    await vi.advanceTimersByTimeAsync(0);
    expect(lobby.latest()).toEqual({ games: [], loading: false, error: "" });
  });

  it("does not turn rapid visibility toggling into repeated requests", async () => {
    fetchMock.mockResolvedValue(response({ games: [] }));
    observe();
    await vi.advanceTimersByTimeAsync(0);
    for (let index = 0; index < 5; index++) {
      documentMock.setVisibility("hidden");
      documentMock.setVisibility("visible");
      await vi.advanceTimersByTimeAsync(1_000);
    }
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(LIVE_GAMES_REFRESH_MS - 5_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("cancels all work on navigation and rejects an uncancellable late result", async () => {
    const pending = deferredResponse();
    fetchMock.mockReturnValue(pending.promise);
    const lobby = observe();
    const signal = fetchMock.mock.calls[0]?.[1]?.signal;
    lobby.dispose();
    expect(signal?.aborted).toBe(true);
    const changesBeforeLateResult = lobby.changes.length;
    pending.resolve(response({ games: [game] }));
    lobby.refresh();
    documentMock.setVisibility("hidden");
    documentMock.setVisibility("visible");
    await vi.advanceTimersByTimeAsync(LIVE_GAMES_REFRESH_MS * 3);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(lobby.changes).toHaveLength(changesBeforeLateResult);
    expect(vi.getTimerCount()).toBe(0);
  });
});
