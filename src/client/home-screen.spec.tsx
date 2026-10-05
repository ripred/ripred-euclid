import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

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
  it("introduces four shared lessons including blocking your opponent", () => {
    const markup = renderToStaticMarkup(<HomeScreen {...homeProps()} />);
    expect(markup).toContain('<h2 id="home-learn-title">How to play</h2>');
    expect(markup.match(/class="lesson"/g)).toHaveLength(4);
    expect(markup).toContain("Block your opponent");
  });

  it("offers the four utility actions without a challenge button", () => {
    const markup = renderToStaticMarkup(<HomeScreen {...homeProps()} />);
    expect(markup.match(/class="home-nav__item"/g)).toHaveLength(4);
    for (const label of ["Watch live", "Leaderboard", "Options", "How to play"])
      expect(markup).toContain(`<span>${label}</span>`);
    expect(markup).not.toContain("Challenges");
    expect(markup).not.toContain("Challenge playground");
  });

  it("offers difficulty settings beside solo play and locks them during requests", () => {
    const render = (
      busyAction: Exclude<HomeScreenProps["busyAction"], undefined>,
    ) => renderToStaticMarkup(<HomeScreen {...homeProps({ busyAction })} />);
    const ready = render(null);
    expect(ready).toContain("Change difficulty");
    expect(ready.indexOf("Change difficulty")).toBeLessThan(
      ready.indexOf("Play a Redditor"),
    );
    const pending = render("solo");
    const index = pending.indexOf("Change difficulty");
    expect(
      pending.slice(pending.lastIndexOf("<button", index), index),
    ).toContain("disabled");
  });

  it("offers difficulty only for Practice, since Ranked rules are fixed", () => {
    const render = (soloMode: "practice" | "ranked") =>
      renderToStaticMarkup(
        <HomeScreen
          {...homeProps({ soloMode, onSoloModeChange: () => undefined })}
        />,
      );
    expect(render("practice")).toContain("Change difficulty");
    expect(render("ranked")).not.toContain("Change difficulty");
  });

  it("titles the home and status headers with a decorative-only mark", () => {
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
      // Brand art is hidden from assistive technology; the heading is the name.
      for (const svg of header.match(/<svg\b[^>]*>/g) ?? []) {
        expect(svg).toContain('aria-hidden="true"');
      }
      expect(header).not.toMatch(/<img\b/);
    }
  });

  it("keeps the primary, secondary, and utility actions in visual order", () => {
    const markup = renderToStaticMarkup(<HomeScreen {...homeProps()} />);

    expect(markup.indexOf("Play Euclid")).toBeLessThan(
      markup.indexOf("Play a Redditor"),
    );
    expect(markup.indexOf("Play a Redditor")).toBeLessThan(
      markup.indexOf("Watch live"),
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
            rules: "first to 150",
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
    expect(openingButtonTag(presenceMarkup, ">Watch live<")).not.toContain(
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
    expect(openingButtonTag(reconciliationMarkup, ">Watch live<")).toContain(
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

describe("home challenge entries", () => {
  it.each([0, 0.5, 0.999999])(
    "keeps all four square silhouettes distinct throughout their drift (random=%s)",
    (random) => {
      const randomSpy = vi.spyOn(Math, "random").mockReturnValue(random);
      try {
        const challenge = {
          enabled: true,
          status: "open" as const,
          instanceId: "test",
          opensAt: Date.UTC(2026, 8, 27),
          endsAt: Date.UTC(2026, 8, 28),
          showStandings: true,
        };
        const markup = renderToStaticMarkup(
          <HomeScreen
            {...homeProps({
              competitions: {
                daily: { ...challenge, period: "daily" },
                weekly: { ...challenge, period: "weekly" },
              },
              competitionNow: Date.UTC(2026, 8, 27, 12),
              onChallenge: () => undefined,
            })}
          />,
        );
        const styles = Array.from(
          markup.matchAll(/class="home-card__float" style="([^"]+)"/g),
          (match) => match[1]!,
        );
        expect(styles).toHaveLength(4);
        const origins = styles.map((style) =>
          Number(style.match(/--float-origin:[^;]*rotate\(([-\d.]+)deg\)/)![1]),
        );
        expect(origins).toEqual([-27, -4, 18, 41]);
        styles.forEach((style, index) => {
          const rotations = Array.from(
            style.matchAll(/rotate\(([-\d.]+)deg\)/g),
            (match) => Number(match[1]),
          );
          expect(rotations).toHaveLength(4);
          for (const rotation of rotations) {
            expect(Math.abs(rotation - origins[index]!)).toBeLessThanOrEqual(4);
          }
        });
        // Include the wraparound: a square repeats after 90 degrees, not 360.
        for (let index = 0; index < origins.length; index++) {
          const next = origins[(index + 1) % origins.length]!;
          const separation = (next - origins[index]! + 90) % 90;
          expect(separation - 8).toBeGreaterThanOrEqual(14);
        }
      } finally {
        randomSpy.mockRestore();
      }
    },
  );

  it.each([
    [false, false],
    [true, false],
    [false, true],
    [true, true],
  ])("shows only enabled daily=%s weekly=%s challenges", (daily, weekly) => {
    const make = (period: "daily" | "weekly", enabled: boolean) => ({
      period,
      enabled,
      status: "open" as const,
      instanceId: period,
      opensAt: Date.UTC(2026, 8, 27),
      endsAt: Date.UTC(2026, 8, 28),
      showStandings: true,
    });
    const markup = renderToStaticMarkup(
      <HomeScreen
        {...homeProps({
          competitions: {
            daily: make("daily", daily),
            weekly: make("weekly", weekly),
          },
          competitionNow: Date.UTC(2026, 8, 27, 12),
          onChallenge: () => undefined,
        })}
      />,
    );
    expect(markup.includes("Open daily challenge")).toBe(daily);
    expect(markup.includes("Open weekly challenge")).toBe(weekly);
    if (daily || weekly) expect(markup).toContain("Closes in 12h 00m 00s");
    const order = [
      "Play Euclid",
      "Play a Redditor",
      ...(daily ? ["Daily Challenge"] : []),
      ...(weekly ? ["Weekly Challenge"] : []),
      "Watch live",
      "Leaderboard",
      "How to play",
      "Options",
    ];
    for (let index = 1; index < order.length; index++)
      expect(markup.indexOf(order[index - 1]!)).toBeLessThan(
        markup.indexOf(order[index]!),
      );
    if (daily) expect(markup).toContain("home-challenge--red");
    if (weekly) expect(markup).toContain("home-challenge--blue");
  });
  it("shows a scheduled entry with its GMT start time and locks it during matchmaking", () => {
    const item = {
      period: "daily" as const,
      enabled: true,
      status: "scheduled" as const,
      instanceId: null,
      opensAt: Date.UTC(2026, 8, 28),
      endsAt: Date.UTC(2026, 8, 29),
      showStandings: true,
    };
    const markup = renderToStaticMarkup(
      <HomeScreen
        {...homeProps({
          competitions: {
            daily: item,
            weekly: { ...item, period: "weekly", enabled: false },
          },
          competitionNow: Date.UTC(2026, 8, 27, 12),
          onChallenge: () => undefined,
          busyAction: "h2h",
        })}
      />,
    );
    expect(markup).toContain("Opens in 12h 00m 00s");
    expect(markup).toContain("28 Sept 2026, 00:00 GMT");
    const index = markup.indexOf("Open daily challenge");
    expect(markup.slice(markup.lastIndexOf("<button", index), index)).toContain(
      "disabled",
    );
  });
});
