import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  EditionRequestError,
  readSnapshot,
  requestEdition,
  retainBoard,
} from "./edition-api";

beforeEach(() => {
  vi.stubGlobal("window", globalThis);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const board = () => ({
  id: "game-one",
  mode: "solo" as const,
  state: { revision: 1, turn: 1 as const, winner: null },
});

describe("confirmed spectator boards", () => {
  it("keeps the board reference when only sharing metadata changes", () => {
    const previous = { ...board(), spectatorsEnabled: false };
    const next = { ...board(), spectatorsEnabled: true };
    const merged = retainBoard(previous, next);
    expect(merged?.state).toBe(previous.state);
    expect(merged?.spectatorsEnabled).toBe(true);
  });
  it("replaces boards on new moves, new games, and same-revision rule corrections", () => {
    const previous = board();
    const changed = [
      { ...board(), id: "another-game" },
      { ...board(), state: { ...board().state, revision: 2 } },
      { ...board(), state: { ...board().state, winner: 1 as const } },
    ];
    for (const next of changed)
      expect(retainBoard(previous, next)?.state).toBe(next.state);
  });
  it("clears a revoked view and accepts the first snapshot", () => {
    const next = board();
    expect(retainBoard(next, null)).toBeNull();
    expect(retainBoard(null, next)).toBe(next);
  });
  it("checks transport structure before a renderer sees a snapshot", () => {
    expect(readSnapshot(board())).toEqual(board());
    expect(readSnapshot(null)).toBeNull();
    for (const value of [
      [],
      false,
      {},
      { ...board(), state: null },
      { ...board(), mode: "other" },
    ])
      expect(() => readSnapshot(value)).toThrow(EditionRequestError);
  });
});

describe("edition HTTP transport", () => {
  it("uses non-cached read-only requests for watching", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify(board())));
    vi.stubGlobal("fetch", fetch);
    const value = await requestEdition(
      "watch/game-one",
      new AbortController().signal,
    );
    expect(value).toEqual(board());
    expect(fetch).toHaveBeenCalledWith(
      "/api/edition/watch/game-one",
      expect.objectContaining({ method: "GET", cache: "no-store" }),
    );
    expect(fetch.mock.calls[0]?.[1]).not.toHaveProperty("body");
  });
  it("sends only the supplied command intent", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response("null"));
    vi.stubGlobal("fetch", fetch);
    const intent = { kind: "spectators", enabled: true };
    await requestEdition("command", new AbortController().signal, intent);
    expect(fetch).toHaveBeenCalledWith(
      "/api/edition/command",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify(intent),
        headers: { "Content-Type": "application/json" },
      }),
    );
  });
  it("preserves status codes for withdrawn games without pretending the read succeeded", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response('{"error":"Unavailable"}', { status: 404 }),
        ),
    );
    await expect(
      requestEdition("watch/game-one", new AbortController().signal),
    ).rejects.toMatchObject({ status: 404, message: "Unavailable" });
  });
  it("bounds stalled reads and distinguishes a timeout from leaving a view", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_url: string, options: RequestInit) =>
          new Promise((_resolve, reject) => {
            options.signal?.addEventListener("abort", () =>
              reject(new DOMException("Aborted", "AbortError")),
            );
          }),
      ),
    );
    const pending = requestEdition("live", new AbortController().signal);
    const result = expect(pending).rejects.toMatchObject({
      status: 0,
      message: "Connection timed out. Please reconnect.",
    });
    await vi.advanceTimersByTimeAsync(20000);
    await result;
    const controller = new AbortController();
    const cancelled = requestEdition("live", controller.signal);
    const cancellation = expect(cancelled).rejects.toMatchObject({
      name: "AbortError",
    });
    controller.abort();
    await cancellation;
    expect(vi.getTimerCount()).toBe(0);
  });
  it("reports an unreadable response and releases its deadline timer", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response("<html>Unavailable</html>", { status: 503 }),
        ),
    );
    await expect(
      requestEdition("live", new AbortController().signal),
    ).rejects.toMatchObject({ status: 503 });
    expect(vi.getTimerCount()).toBe(0);
  });
});
