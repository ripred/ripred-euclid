import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { getHomeRecordPresentations } from "./home-ui";
import {
  HomeScreen,
  HomeStatusScreen,
  type HomeScreenProps,
} from "./home-screen";

function homeProps(overrides: Partial<HomeScreenProps> = {}): HomeScreenProps {
  const noOp = () => undefined;
  return {
    username: "euclid_player",
    playEuclidSubtitle: "Practice · custom rules · no rating changes",
    records: getHomeRecordPresentations({
      hva: {
        rating: 1_240,
        games: 3,
        wins: 2,
        losses: 1,
        draws: 0,
      },
      hvh: {
        rating: 1_180,
        games: 2,
        wins: 1,
        losses: 1,
        draws: 0,
      },
    }),
    soloContinuation: null,
    h2h: {
      state: "idle",
      title: "Play a Redditor",
      detail: "Start a live match with another redditor.",
      actionLabel: "Find a match",
    },
    loading: { presence: false, solo: false, records: false },
    onPlayEuclid: noOp,
    onPlayRedditor: noOp,
    onContinueSolo: noOp,
    onContinueH2H: noOp,
    onCancelSearch: noOp,
    onWatchGames: noOp,
    onLeaderboard: noOp,
    onOptions: noOp,
    onRules: noOp,
    ...overrides,
  };
}

function openingButtonTag(markup: string, className: string): string {
  const classIndex = markup.indexOf(className);
  expect(classIndex).toBeGreaterThanOrEqual(0);
  const start = markup.lastIndexOf("<button", classIndex);
  const end = markup.indexOf(">", classIndex);
  return markup.slice(start, end + 1);
}

function completeButtonMarkup(markup: string, className: string): string {
  const classIndex = markup.indexOf(className);
  expect(classIndex).toBeGreaterThanOrEqual(0);
  const start = markup.lastIndexOf("<button", classIndex);
  const end = markup.indexOf("</button>", classIndex);
  return markup.slice(start, end + "</button>".length);
}

describe("home dashboard structure", () => {
  it("keeps the home and status headers text-only", () => {
    const screens = [
      <HomeScreen {...homeProps()} />,
      <HomeStatusScreen heading="Loading" detail="Preparing your game" />,
    ];

    for (const screen of screens) {
      const markup = renderToStaticMarkup(screen);
      const header = markup.slice(
        markup.indexOf("<header"),
        markup.indexOf("</header>"),
      );
      expect(header).toContain("Euclid</h1>");
      expect(header).not.toContain("euclid-home__brand-mark");
      expect(header).not.toMatch(/<(?:img|svg)\b/);
    }
  });

  it("keeps the primary, secondary, and utility actions in visual order", () => {
    const markup = renderToStaticMarkup(<HomeScreen {...homeProps()} />);

    expect(markup.indexOf("Play Euclid")).toBeLessThan(
      markup.indexOf("Play a Redditor"),
    );
    expect(markup.indexOf("Play a Redditor")).toBeLessThan(
      markup.indexOf("Live games"),
    );
    expect(markup).toContain("Euclid Ranked");
    expect(markup).toContain("Redditor Matches");
  });

  it("holds only controls that depend on each progressive loader", () => {
    const presenceMarkup = renderToStaticMarkup(
      <HomeScreen
        {...homeProps({
          loading: { presence: true, solo: false, records: true },
          soloContinuation: {
            title: "Continue Ranked game",
            detail: "Your turn against Euclid",
            score: "You 36 · Euclid 28",
            rules: "8 × 8 · Grid Footprint · first to 150",
            actionLabel: "Continue",
          },
        })}
      />,
    );

    expect(
      openingButtonTag(presenceMarkup, "euclid-home__primary-action"),
    ).toContain("disabled");
    expect(
      openingButtonTag(presenceMarkup, "euclid-home__secondary-button--strong"),
    ).toContain("disabled");
    expect(openingButtonTag(presenceMarkup, ">Live games<")).not.toContain(
      "disabled",
    );
    expect(presenceMarkup).toContain("Checking status…");
    expect(presenceMarkup).toContain("Loading record…");
    expect(
      completeButtonMarkup(presenceMarkup, "euclid-home__continue-button"),
    ).toContain("Checking status…");

    const recordsMarkup = renderToStaticMarkup(
      <HomeScreen
        {...homeProps({
          loading: { presence: false, solo: false, records: true },
        })}
      />,
    );
    expect(
      openingButtonTag(recordsMarkup, "euclid-home__primary-action"),
    ).not.toContain("disabled");
    expect(
      openingButtonTag(recordsMarkup, "euclid-home__secondary-button--strong"),
    ).not.toContain("disabled");

    const soloMarkup = renderToStaticMarkup(
      <HomeScreen
        {...homeProps({
          loading: { presence: false, solo: true, records: false },
        })}
      />,
    );
    expect(
      openingButtonTag(soloMarkup, "euclid-home__primary-action"),
    ).toContain("disabled");
    expect(
      openingButtonTag(soloMarkup, "euclid-home__secondary-button--strong"),
    ).not.toContain("disabled");
    expect(soloMarkup).toContain("Checking for a saved game…");

    const reconciliationMarkup = renderToStaticMarkup(
      <HomeScreen
        {...homeProps({
          loading: { presence: true, solo: false, records: false },
          presenceReconciliationPending: true,
        })}
      />,
    );
    expect(openingButtonTag(reconciliationMarkup, ">Live games<")).toContain(
      "disabled",
    );
    expect(reconciliationMarkup).toContain(
      "Unavailable while matchmaking status is being confirmed.",
    );
  });

  it("keeps status actions outside the live message region", () => {
    const markup = renderToStaticMarkup(
      <HomeStatusScreen
        heading="Opening your match"
        detail="Refreshing the canonical board…"
        busy
        actions={[
          {
            label: "Leaving…",
            onClick: () => undefined,
            disabled: true,
            busy: true,
          },
        ]}
      />,
    );

    const statusStart = markup.indexOf('role="status"');
    const actionStart = markup.indexOf(">Leaving…<");
    const messageEnd = markup.indexOf("</div>", statusStart);
    expect(statusStart).toBeGreaterThanOrEqual(0);
    expect(messageEnd).toBeLessThan(actionStart);
    expect(markup.match(/role="status"/g)).toHaveLength(1);
    expect(markup.slice(statusStart, messageEnd)).not.toContain("aria-busy");
    expect(openingButtonTag(markup, ">Leaving…<")).toContain(
      'aria-busy="true"',
    );
    expect(openingButtonTag(markup, ">Leaving…<")).toContain("disabled");
  });
});
