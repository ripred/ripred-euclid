// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { HomeScreen } from "../home-screen";
import { getHomeRecordPresentations } from "../home-ui";
import { SplashCarousel } from "../splash-carousel";

function cssRule(file: string, selector: string): string {
  const css = readFileSync(new URL(file, import.meta.url), "utf8");
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = css.match(new RegExp(`^${escaped}\\s*\\{([^}]*)\\}`, "m"));
  expect(match, `${file}: ${selector}`).not.toBeNull();
  return match![1]!;
}

describe("semantic interface accents", () => {
  it.each([
    [
      "./base.css",
      ".btn--primary",
      [
        "--accent-button-top",
        "--accent-button-bottom",
        "--accent-button-lip",
        "--accent-on-color",
      ],
    ],
    ["./base.css", ".switch input:checked", ["--control-accent"]],
    ["./base.css", ".switch input:checked::after", ["--control-on-accent"]],
    [
      "../ui/difficulty-slider.css",
      ".difficulty-slider__label output",
      ["--accent-text"],
    ],
    [
      "../ui/difficulty-slider.css",
      ".difficulty-slider__slider::-webkit-slider-thumb",
      ["--control-accent"],
    ],
    [
      "../ui/difficulty-slider.css",
      ".difficulty-slider__slider::-moz-range-thumb",
      ["--control-accent"],
    ],
    [
      "../ui/difficulty-slider.css",
      '.difficulty-slider__ticks [data-selected="true"]',
      ["--accent-text"],
    ],
    [
      "../preview.css",
      '.preview-lessons [data-state="current"] .preview-lessons__mark',
      ["--control-accent", "--accent-text"],
    ],
    [
      "../preview.css",
      ".preview__progress-bar span",
      ["--accent", "--accent-gradient-end"],
    ],
    [
      "../preview.css",
      ".preview-steps__pip--done",
      ["--accent", "--accent-line"],
    ],
    [
      "../splash-carousel.css",
      ".splash-dots [aria-current] span",
      ["--control-accent"],
    ],
    ["../splash-carousel.css", ".splash-scene", ["--accent", "--accent-text"]],
    ["../home-screen.css", ".home-solo", ["--accent"]],
    ["../home-screen.css", ".home-challenge", ["--accent"]],
    ["../home-screen.css", ".home-continue", ["--action-highlight"]],
    ["../setup-screen.css", ".setup-facts li::before", ["--accent-token"]],
    [
      "../share-replay.css",
      ".replay__progress span",
      ["--accent", "--accent-gradient-end"],
    ],
  ] as const)("uses interface tokens in %s %s", (file, selector, tokens) => {
    const rule = cssRule(file, selector);
    for (const token of tokens) expect(rule).toContain(`var(${token})`);
    expect(rule).not.toMatch(
      /var\(--(?:red|blue|token-red|token-blue|piece-red|piece-blue|button-red|button-blue)(?:-[\w-]+)?\b/,
    );
  });

  it("keeps both entry actions on the shared primary-button styling", () => {
    const noop = () => undefined;
    const splash = createElement(SplashCarousel, {
      slides: [{ id: "rules", title: "How to play", content: null }],
      activeId: "rules",
      onSelect: noop,
      paused: true,
      onPause: noop,
      onExpand: noop,
      expansionError: null,
    });
    const home = createElement(HomeScreen, {
      username: "player",
      playEuclidSubtitle: "Practice",
      records: getHomeRecordPresentations(null),
      soloContinuation: null,
      h2h: {
        state: "idle",
        title: "Play a Redditor",
        detail: "Find a match",
        actionLabel: "Find a match",
      },
      loading: { presence: false, solo: false, records: false },
      onPlayEuclid: noop,
      onPlayRedditor: noop,
      onContinueSolo: noop,
      onContinueH2H: noop,
      onCancelSearch: noop,
      onWatchGames: noop,
      onLeaderboard: noop,
      onOptions: noop,
      onRules: noop,
    });
    for (const [view, label] of [
      [splash, "Open Euclid"],
      [home, "Play Euclid"],
    ] as const) {
      const host = document.createElement("div");
      host.innerHTML = renderToStaticMarkup(view);
      const action = Array.from(host.querySelectorAll("button")).find(
        (button) => button.textContent?.trim() === label,
      );
      expect(action, label).toBeDefined();
      expect(action!.classList.contains("btn")).toBe(true);
      expect(action!.classList.contains("btn--primary")).toBe(true);
    }
  });
});
