// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { PlayerAvatar } from "./PlayerAvatar";
import { RedditAvatar } from "./RedditAvatar";

let root: Root, host: HTMLDivElement;
beforeEach(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div");
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
});

it("falls back after an image fails, and retries when a new image is supplied", async () => {
  await act(async () =>
    root.render(
      <PlayerAvatar name="u/Player" avatar="https://i.redd.it/one.png" />,
    ),
  );
  const image = host.querySelector("img")!;
  expect(image.getAttribute("loading")).toBe("lazy");
  expect(image.hasAttribute("crossorigin")).toBe(false);
  await act(async () => image.dispatchEvent(new Event("error")));
  expect(host.querySelector("img")).toBeNull();
  expect(host.textContent).toBe("P");
  await act(async () =>
    root.render(
      <PlayerAvatar name="u/Player" avatar="https://i.redd.it/two.png" />,
    ),
  );
  expect(host.querySelector("img")?.src).toBe("https://i.redd.it/two.png");
});

it("retrieves a user's avatar from the server and avoids lookups for supplied profile data", async () => {
  const fetcher = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({
      username: "player",
      avatar: "https://i.redd.it/player.png",
    }),
  });
  vi.stubGlobal("fetch", fetcher);
  await act(async () => root.render(<RedditAvatar username="u/Player" />));
  expect(fetcher).toHaveBeenCalledWith(
    "/api/users/player/avatar",
    expect.anything(),
  );
  expect(host.querySelector("img")?.src).toBe("https://i.redd.it/player.png");
  await act(async () =>
    root.render(
      <RedditAvatar
        username="another"
        avatar="https://i.redd.it/supplied.png"
      />,
    ),
  );
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(host.querySelector("img")?.src).toBe("https://i.redd.it/supplied.png");
});

it("discards an earlier user's delayed response after switching names", async () => {
  let deliver!: (value: unknown) => void;
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            deliver = resolve;
          }),
      )
      .mockResolvedValue({
        ok: true,
        json: async () => ({ username: "second", avatar: null }),
      }),
  );
  await act(async () => root.render(<RedditAvatar username="first" />));
  await act(async () => root.render(<RedditAvatar username="second" />));
  await act(async () =>
    deliver({
      ok: true,
      json: async () => ({
        username: "first",
        avatar: "https://i.redd.it/first.png",
      }),
    }),
  );
  expect(host.querySelector("img")).toBeNull();
  expect(host.textContent).toBe("S");
});

it("keeps the initial when the lookup fails", async () => {
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Offline")));
  await act(async () => root.render(<RedditAvatar username="player" />));
  expect(host.textContent).toBe("P");
});
