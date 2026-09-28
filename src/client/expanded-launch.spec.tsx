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
let initModerator: unknown;
let initReady: Promise<void>;

beforeEach(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  requests = [];
  initModerator = undefined;
  initReady = Promise.resolve();
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
    vi.fn(async (url: string) => {
      requests.push(url);
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
      if (url === "/api/h2h/mapping")
        return reply({ ok: true, state: await presence, gameId: null });
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
  initialMode: "challenge" | "daily" | "weekly" | null = null,
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
