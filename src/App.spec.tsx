// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "./App";
import { STORAGE_KEYS } from "./storage";

let root: Root;
let host: HTMLDivElement;

const button = (label: string) =>
  [...host.querySelectorAll("button")].find(
    (item) =>
      item.textContent?.trim() === label ||
      item.getAttribute("aria-label") === label,
  );

async function click(target: Element | null | undefined) {
  expect(target).toBeTruthy();
  await act(async () => {
    target!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

async function mount() {
  root = createRoot(host);
  await act(async () => root.render(<App />));
}

async function remount() {
  await act(async () => root.unmount());
  await mount();
}

const occupied = () =>
  [...host.querySelectorAll(".game__cell")].filter(
    (cell) => !cell.getAttribute("aria-label")?.endsWith("open"),
  ).length;

const stored = (key: string) => JSON.parse(localStorage.getItem(key) ?? "null");

beforeEach(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers();
  localStorage.clear();
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query.includes("dark"),
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  host = document.createElement("div");
  document.body.append(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("playing Euclid", () => {
  it("teaches first, then answers the player's move after a pause", async () => {
    await mount();
    await click(button("Play Euclid"));
    expect(host.textContent).toContain("How to play Euclid");
    await click(button("Start playing"));
    expect(stored(STORAGE_KEYS.tutorial)).toBe(true);

    await click(host.querySelector('.game__cell[data-index="27"]'));
    expect(occupied()).toBe(1);
    expect(host.querySelector(".game__status")?.textContent).toContain(
      "Euclid is thinking",
    );
    await advance(800);
    expect(occupied()).toBe(2);
    expect(host.querySelector(".game__status")?.textContent).toContain(
      "Your move",
    );
    expect(stored(STORAGE_KEYS.game).moves).toHaveLength(2);
  });

  it("resumes a saved game after the page reloads", async () => {
    await mount();
    await click(button("Play Euclid"));
    await click(button("Start playing"));
    await click(host.querySelector('.game__cell[data-index="0"]'));
    await advance(800);

    await remount();
    expect(host.textContent).toContain("Continue Practice game");
    await click(button("Continue"));
    expect(occupied()).toBe(2);
    // The tutorial is shown once per device, not once per game.
    expect(host.textContent).not.toContain("How to play Euclid");
  });

  it("asks before a Ranked forfeit, then records the loss", async () => {
    localStorage.setItem(STORAGE_KEYS.tutorial, "true");
    await mount();
    await click(button("Ranked"));
    await click(button("Play Euclid"));
    expect(button("Cancel Ranked")).toBeTruthy();
    await click(host.querySelector('.game__cell[data-index="9"]'));
    await advance(800);

    await click(button("Abandon Ranked"));
    expect(host.textContent).toContain("Forfeit this Ranked game?");
    await click(button("Keep playing"));
    expect(host.textContent).not.toContain("Forfeit this Ranked game?");

    await click(button("Abandon Ranked"));
    await click(button("Forfeit"));
    expect(host.textContent).toContain("Ranked game forfeited");
    expect(host.textContent).toContain("Rating 1200 → 1197");
    expect(stored(STORAGE_KEYS.records).ranked).toMatchObject({
      rating: 1197,
      losses: 1,
    });
    expect(localStorage.getItem(STORAGE_KEYS.game)).toBeNull();
  });

  it("washes away stones that fade, with the rule shown in the game", async () => {
    localStorage.setItem(STORAGE_KEYS.tutorial, "true");
    localStorage.setItem(
      STORAGE_KEYS.settings,
      JSON.stringify({
        soloMode: "practice",
        practice: {
          W: 8,
          H: 8,
          scoring: "bbox",
          winScore: 150,
          difficulty: "doofus",
          fadeTurns: 4,
        },
        assist: false,
        theme: "system",
      }),
    );
    await mount();
    expect(host.textContent).toContain("stones fade after 4 turns");
    await click(button("Play Euclid"));
    expect(host.querySelector(".game__fade")?.textContent).toBe(
      "Stones fade after 4 turns",
    );

    // Four turns on scattered points, skipping any Euclid has taken.
    const cell = (index: number) =>
      host.querySelector(`.game__cell[data-index="${index}"]`);
    const open = (index: number) =>
      cell(index)?.getAttribute("aria-label")?.endsWith("open");
    const scattered = [0, 27, 45, 62, 7, 56, 38, 12, 49];
    let last = -1;
    for (let turn = 0; turn < 4; turn++) {
      last = scattered.find(open)!;
      await click(cell(last));
      await advance(800);
    }
    // After four of its owner's turns the first stone is gone.
    expect(cell(0)?.getAttribute("aria-label")).toBe("A1, open");
    expect(cell(last)?.getAttribute("aria-label")).toContain(
      "lasts 3 more turns",
    );
  });

  it("resets the records only after confirmation", async () => {
    localStorage.setItem(
      STORAGE_KEYS.records,
      JSON.stringify({
        ranked: {
          games: 1,
          wins: 1,
          losses: 0,
          draws: 0,
          rating: 1229,
          best: 1229,
        },
        practice: { games: 0, wins: 0, losses: 0, draws: 0 },
      }),
    );
    await mount();
    expect(host.textContent).toContain("1,229");
    await click(button("Options"));
    await click(button("Reset records"));
    await click(button("Keep records"));
    expect(stored(STORAGE_KEYS.records).ranked.rating).toBe(1229);

    await click(button("Reset records"));
    await click(host.querySelector(".confirm-dialog .btn--primary"));
    expect(stored(STORAGE_KEYS.records).ranked.rating).toBe(1200);
    expect(button("Reset records")).toBeUndefined();
  });
});
