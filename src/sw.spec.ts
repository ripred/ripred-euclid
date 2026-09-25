import { describe, expect, it } from "vitest";

import source from "../public/sw.js?raw";

type Listener = (event: FakeEvent) => void;

interface FakeEvent {
  request?: FakeRequest;
  waitUntil(promise: Promise<unknown>): void;
  respondWith(promise: Promise<unknown>): void;
}

interface FakeRequest {
  url: string;
  method: string;
  mode: string;
}

/** Just enough of a service-worker scope to run public/sw.js. */
function loadWorker({ online }: { online: boolean }) {
  const listeners = new Map<string, Listener>();
  const stores = new Map<string, Map<string, string>>();
  const open = async (name: string) => {
    const store = stores.get(name) ?? new Map<string, string>();
    stores.set(name, store);
    return {
      addAll: async (urls: string[]) =>
        urls.forEach((url) =>
          store.set(new URL(url, ORIGIN).href, `cached ${url}`),
        ),
      put: async (request: FakeRequest, response: { body: string }) => {
        store.set(request.url, response.body);
      },
    };
  };
  const caches = {
    open,
    keys: async () => [...stores.keys()],
    delete: async (name: string) => stores.delete(name),
    match: async (request: FakeRequest | string) => {
      const url =
        typeof request === "string"
          ? new URL(request, ORIGIN).href
          : request.url;
      for (const store of stores.values()) {
        const hit = store.get(url);
        if (hit !== undefined) return { body: hit };
      }
      return undefined;
    },
  };
  const fetch = async (request: FakeRequest) => {
    if (!online) throw new TypeError("offline");
    const body = `network ${request.url}`;
    return { ok: true, type: "basic", body, clone: () => ({ body }) };
  };
  const self = {
    addEventListener: (type: string, listener: Listener) =>
      listeners.set(type, listener),
    skipWaiting: async () => undefined,
    clients: { claim: async () => undefined },
  };
  new Function("self", "caches", "fetch", "location", "Response", source)(
    self,
    caches,
    fetch,
    new URL(ORIGIN),
    { error: () => ({ body: "error" }) },
  );

  const dispatch = async (type: string, request?: FakeRequest) => {
    const pending: Promise<unknown>[] = [];
    let response: Promise<unknown> | undefined;
    listeners.get(type)!({
      ...(request ? { request } : {}),
      waitUntil: (promise) => pending.push(promise),
      respondWith: (promise) => (response = promise),
    });
    await Promise.all(pending);
    return response ? ((await response) as { body: string }) : undefined;
  };
  return { dispatch, stores };
}

const ORIGIN = "https://euclid.example/";
const get = (path: string, mode = "no-cors"): FakeRequest => ({
  url: new URL(path, ORIGIN).href,
  method: "GET",
  mode,
});

describe("offline cache", () => {
  it("stores the game and its icons on install and drops old caches", async () => {
    const worker = loadWorker({ online: true });
    worker.stores.set("euclid-v0", new Map([["old", "stale"]]));
    await worker.dispatch("install");
    await worker.dispatch("activate");
    expect([...worker.stores.keys()]).toEqual(["euclid-v1"]);
    const cached = [...worker.stores.get("euclid-v1")!.keys()];
    expect(cached).toContain(`${ORIGIN}index.html`);
    expect(cached).toContain(`${ORIGIN}icons/icon-512.png`);
  });

  it("prefers the network while online and refreshes the copy", async () => {
    const worker = loadWorker({ online: true });
    await worker.dispatch("install");
    const response = await worker.dispatch("fetch", get("index.html"));
    expect(response?.body).toBe(`network ${ORIGIN}index.html`);
    await Promise.resolve();
    expect(worker.stores.get("euclid-v1")!.get(`${ORIGIN}index.html`)).toBe(
      `network ${ORIGIN}index.html`,
    );
  });

  it("serves the saved game while offline, including for new navigations", async () => {
    const online = loadWorker({ online: true });
    await online.dispatch("install");
    const offline = loadWorker({ online: false });
    offline.stores.set("euclid-v1", online.stores.get("euclid-v1")!);

    expect((await offline.dispatch("fetch", get("index.html")))?.body).toBe(
      "cached ./index.html",
    );
    expect(
      (await offline.dispatch("fetch", get("some/deep/link", "navigate")))
        ?.body,
    ).toBe("cached ./index.html");
    expect((await offline.dispatch("fetch", get("missing.png")))?.body).toBe(
      "error",
    );
  });

  it("leaves other origins and non-GET requests to the browser", async () => {
    const worker = loadWorker({ online: true });
    expect(
      await worker.dispatch("fetch", {
        url: "https://elsewhere.example/x",
        method: "GET",
        mode: "no-cors",
      }),
    ).toBeUndefined();
    expect(
      await worker.dispatch("fetch", { ...get("index.html"), method: "POST" }),
    ).toBeUndefined();
  });
});
