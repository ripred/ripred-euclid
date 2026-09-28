// @vitest-environment jsdom
import { StrictMode, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import type { ExpandedAction } from "./expanded-entry";

let root: Root, host: HTMLDivElement;
let resolvePresence: (state: string) => void;
let resolveSolo: () => void;
let requests: string[];
let mutations: string[];
let initModerator: unknown;
let initReady: Promise<void>;
let liveGamesReady: Promise<void>;
let refreshedPresence: string | undefined;

beforeEach(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  requests = [];
  mutations = [];
  initModerator = undefined;
  initReady = Promise.resolve();
  liveGamesReady = Promise.resolve();
  refreshedPresence = undefined;
  const presence = new Promise<string>((resolve) => {
    resolvePresence = resolve;
  });
  const solo = new Promise<void>((resolve) => {
    resolveSolo = resolve;
  });
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  }));
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, options?: RequestInit) => {
      requests.push(url);
      if (options?.method && options.method !== "GET") mutations.push(url);
      const reply = (data: unknown, status = 200) => ({
        ok: status < 400,
        status,
        json: async () => data,
      });
      if (url === "/api/init") {
        await initReady;
        return reply({
          type: "init",
          username: "player",
          appVersion: "test",
          postId: "post",
          isModerator: initModerator,
        });
      }
      if (url === "/api/challenge-lab/state") return reply({ snapshot: null });
      if (url === "/api/games/list") {
        await liveGamesReady;
        return reply({ games: [] });
      }
      if (url === "/api/h2h/mapping")
        return reply({
          ok: true,
          state: refreshedPresence ?? (await presence),
          gameId: null,
        });
      if (url === "/api/solo/active") {
        await solo;
        return reply({}, 404);
      }
      if (url === "/api/h2h/queue")
        return reply({ ok: true, state: "queued", gameId: null });
      // A failed start must remain a single explicit intent, never an automatic retry loop.
      return reply({ message: "Unavailable" }, 503);
    }),
  );
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
async function mount(
  initialAction: ExpandedAction | null,
  initialMode: "challenge" | "daily" | "weekly" | "spectate" | null = null,
) {
  await act(async () =>
    root.render(
      <StrictMode>
        <App initialAction={initialAction} initialMode={initialMode} />
      </StrictMode>,
    ),
  );
}
const launches = () =>
  requests.filter(
    (url) => url === "/api/h2h/queue" || url === "/api/solo/start",
  );

describe("expanded game launch intents", () => {
  it.each(["solo", "reddit"] as const)(
    "waits for presence and saved-game checks before one %s launch",
    async (action) => {
      await mount(action);
      expect(launches()).toEqual([]);
      await act(async () => resolvePresence("idle"));
      expect(launches()).toEqual([]);
      await act(async () => resolveSolo());
      expect(launches()).toEqual([
        action === "solo" ? "/api/solo/start" : "/api/h2h/queue",
      ]);
    },
  );
  it("does not launch from the ordinary game menu", async () => {
    await mount(null);
    await act(async () => {
      resolvePresence("idle");
      resolveSolo();
    });
    expect(launches()).toEqual([]);
  });
  it.each(["solo", "reddit"] as const)(
    "preserves an existing queue on a %s entry",
    async (action) => {
      await mount(action);
      await act(async () => {
        resolvePresence("queued");
        resolveSolo();
      });
      expect(launches()).toEqual([]);
      expect(host.textContent).toContain("Searching");
    },
  );
});

describe("watch lobby navigation", () => {
  const button = (label: string) =>
    Array.from(host.querySelectorAll("button")).find(
      (candidate) => candidate.textContent === label,
    );

  it("returns from an empty lobby and refreshes an existing queue without game mutations", async () => {
    await mount(null);
    await act(async () => {
      resolvePresence("idle");
      resolveSolo();
    });
    const watch = button("Live games");
    expect(watch).toBeTruthy();
    expect(watch!.disabled).toBe(false);
    await act(async () => watch!.click());
    expect(host.textContent).toContain("No live games right now");
    expect(host.querySelector("#euclid-home-title")).toBeNull();

    const mappingReads = requests.filter(
      (url) => url === "/api/h2h/mapping",
    ).length;
    const soloReads = requests.filter(
      (url) => url === "/api/solo/active",
    ).length;
    // Another client can queue this user while the lobby is open. Returning
    // must rediscover that authoritative state without cancelling it.
    refreshedPresence = "queued";
    const back = button("Back to game menu");
    expect(back).toBeTruthy();
    expect(back!.disabled).toBe(false);
    expect(back!.closest(".page-header")).not.toBeNull();
    await act(async () => back!.click());

    expect(host.querySelector("#euclid-home-title")).not.toBeNull();
    expect(host.querySelector("#watch-title")).toBeNull();
    expect(host.textContent).toContain("Searching for another redditor");
    expect(button("Cancel search")).toBeTruthy();
    expect(requests.filter((url) => url === "/api/h2h/mapping")).toHaveLength(
      mappingReads + 1,
    );
    expect(requests.filter((url) => url === "/api/solo/active")).toHaveLength(
      soloReads + 1,
    );
    expect(mutations).toEqual([]);
  });

  it("leaves direct watch entry while loading and ignores the late list response", async () => {
    let resolveLiveGames!: () => void;
    liveGamesReady = new Promise<void>((resolve) => {
      resolveLiveGames = resolve;
    });
    await mount(null, "spectate");
    expect(host.textContent).toContain("Finding live games");
    const listCall = vi
      .mocked(fetch)
      .mock.calls.find(([url]) => url === "/api/games/list");
    const signal = listCall?.[1]?.signal;
    expect(signal?.aborted).toBe(false);
    expect(requests).not.toContain("/api/h2h/mapping");

    const back = button("Back to game menu");
    expect(back).toBeTruthy();
    expect(back!.disabled).toBe(false);
    await act(async () => {
      back!.click();
      resolvePresence("idle");
      resolveSolo();
    });
    expect(signal?.aborted).toBe(true);
    expect(host.querySelector("#euclid-home-title")).not.toBeNull();
    expect(requests).toContain("/api/h2h/mapping");
    expect(requests).toContain("/api/solo/active");

    // The mock deliberately resolves despite cancellation, like a response
    // already in transit when the user navigates away.
    await act(async () => resolveLiveGames());
    expect(host.querySelector("#euclid-home-title")).not.toBeNull();
    expect(host.querySelector("#watch-title")).toBeNull();
    expect(host.textContent).not.toContain("No live games right now");
    expect(mutations).toEqual([]);
  });
});

describe("expanded challenge playground entry", () => {
  it("waits for moderator verification before opening the playground", async () => {
    let resolveInit!: () => void;
    initReady = new Promise<void>((resolve) => {
      resolveInit = resolve;
    });
    initModerator = true;
    await mount(null, "challenge");
    expect(
      requests.filter((url) => url.startsWith("/api/challenge-lab/")),
    ).toEqual([]);
    expect(host.querySelector("#challenge-title")).toBeNull();

    await act(async () => resolveInit());
    expect(host.querySelector("#challenge-title")?.textContent).toBe(
      "Challenge playground",
    );
    expect(requests).toContain("/api/challenge-lab/state");
    expect(requests).not.toContain("/api/challenge-lab/generate");
    expect(launches()).toEqual([]);
  });

  it.each([false, undefined, null, "true"])(
    "blocks direct entry without verified moderator status (%s)",
    async (isModerator) => {
      initModerator = isModerator;
      await mount(null, "challenge");
      expect(host.textContent).toContain("Moderator access required");
      expect(host.querySelector("#challenge-title")).toBeNull();
      expect(
        requests.filter((url) => url.startsWith("/api/challenge-lab/")),
      ).toEqual([]);
      expect(launches()).toEqual([]);

      const back = Array.from(host.querySelectorAll("button")).find(
        (button) => button.textContent === "Back to Euclid",
      );
      expect(back).toBeTruthy();
      await act(async () => back!.click());
      expect(host.textContent).not.toContain("Moderator access required");
      expect(requests).toContain("/api/h2h/mapping");
      expect(launches()).toEqual([]);
    },
  );
});

describe("expanded public competition entry", () => {
  it.each(["daily", "weekly"] as const)(
    "opens %s without requiring moderator status or starting a timer",
    async (period) => {
      initModerator = false;
      await mount(null, period);
      expect(requests).toContain(`/api/competitions/${period}/state`);
      expect(requests).not.toContain(`/api/competitions/${period}/start`);
      expect(requests).not.toContain("/api/challenge-lab/state");
      expect(launches()).toEqual([]);
    },
  );
});
