// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { requestExpandedMode } from "@devvit/web/client";
import { PreviewApp } from "./preview";
import {
  EMPTY_CHALLENGE_SPOTLIGHTS,
  byPeriod,
  CHALLENGE_SETTING,
  spotlightsFor,
  type ChallengeSpotlights,
} from "../shared/challenge-spotlights";

import {
  DEFAULT_SUBREDDIT_SETTINGS,
  type SubredditSettings,
} from "../shared/subreddit-settings";

vi.mock("@devvit/web/client", () => ({ requestExpandedMode: vi.fn() }));
let root: Root, host: HTMLDivElement;
let reduced: boolean;
let challenges: ChallengeSpotlights;
let isModerator: boolean;
let settings: SubredditSettings;
let failSpotlights: boolean;
const active = () =>
  host
    .querySelector('[data-slide][aria-hidden="false"]')
    ?.getAttribute("data-slide");
const button = (label: string) =>
  Array.from(host.querySelectorAll("button")).find(
    (b) => b.getAttribute("aria-label") === label || b.textContent === label,
  )!;
async function click(label: string) {
  const target = button(label);
  expect(target, label).toBeTruthy();
  await act(async () => {
    target.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}
async function advance(ms: number) {
  // Flush each replay beat so the next effect schedules its own frame.
  for (let elapsed = 0; elapsed < ms; elapsed += 100)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(Math.min(100, ms - elapsed));
    });
}
async function mount() {
  await act(async () => {
    root.render(<PreviewApp />);
  });
}

beforeEach(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers();
  vi.mocked(requestExpandedMode).mockReset();
  reduced = false;
  isModerator = false;
  settings = {
    ...DEFAULT_SUBREDDIT_SETTINGS,
    dailyChallenges: true,
    weeklyChallenges: true,
  };
  failSpotlights = false;
  challenges = {
    preview: true,
    daily: {
      username: "sample_player_001",
      moves: 2,
      elapsedMs: 18400,
      dailyWins: 7,
      weeklyWins: 2,
    },
    weekly: {
      username: "sample_player_500",
      moves: 3,
      elapsedMs: 42700,
      dailyWins: 12,
      weeklyWins: 3,
    },
  };
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query.includes("reduced-motion") && reduced,
    addEventListener() {},
    removeEventListener() {},
  }));
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (url === "/api/challenge-spotlights" && failSpotlights)
        throw new Error("Unavailable");
      return {
        ok: true,
        json: async () =>
          url === "/api/init"
            ? {
                type: "init",
                username: "local_moderator",
                postId: "post",
                isModerator,
                subredditSettings: { ...settings },
              }
            : url === "/api/competitions/availability"
              ? {
                  serverNow: Date.now(),
                  competitions: byPeriod((period) => ({
                    period,
                    enabled: settings[CHALLENGE_SETTING[period]],
                    status: settings[CHALLENGE_SETTING[period]]
                      ? "open"
                      : "disabled",
                    instanceId: `${period}-fixture`,
                    opensAt: Date.now(),
                    endsAt: Date.now() + 86400000,
                    showStandings: settings.showLiveChallengeStandings,
                  })),
                }
              : url === "/api/subreddit-settings"
                ? { settings: { ...settings } }
                : url === "/api/challenge-spotlights"
                  ? spotlightsFor(challenges, settings)
                  : url.startsWith("/api/users/")
                    ? {
                        username: url.split("/")[3],
                        avatar:
                          "https://www.redditstatic.com/avatars/defaults/v2/avatar_default_0.png",
                      }
                    : { hvh: [], hva: [] },
      };
    }),
  );
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("splash carousel", () => {
  it("advances after the final lesson with the mouse resting over the slide", async () => {
    await mount();
    for (let elapsed = 0; elapsed < 45000; elapsed += 100) {
      if (
        host
          .querySelector(".preview__progress")
          ?.textContent?.includes("Move 33 of 33")
      )
        break;
      await advance(100);
    }
    expect(host.querySelector(".preview__progress")?.textContent).toContain(
      "Move 33 of 33",
    );
    await act(async () => {
      host
        .querySelector(".splash-viewport")!
        .dispatchEvent(
          new MouseEvent("mouseover", { bubbles: true, relatedTarget: null }),
        );
    });
    await advance(3000);
    expect(active()).toBe("rules");
    await advance(2000);
    expect(active()).toBe("leaderboard");
    await advance(10000);
    expect(active()).toBe("daily");
  });

  it("finishes the teaching game, then cycles standings, both winners, and rules", async () => {
    await mount();
    const open = button("Open Euclid");
    expect(active()).toBe("rules");
    await advance(5000);
    expect(active()).toBe("rules");
    expect(host.textContent).toContain("Move 1 of 33");
    await advance(37000);
    expect(active()).toBe("leaderboard");
    for (const next of ["daily", "weekly", "rules"]) {
      await advance(10000);
      expect(active()).toBe(next);
      expect(button("Open Euclid")).toBe(open);
    }
    expect(host.querySelectorAll("[data-slide][inert]")).toHaveLength(3);
  });

  it("pauses for reading, resumes, and offers direct controls without starting a game", async () => {
    await mount();
    await click("Pause rotation");
    await advance(20000);
    expect(active()).toBe("rules");
    expect(host.textContent).toContain("A full game in 33 moves");
    await click("Next slide");
    expect(active()).toBe("leaderboard");
    await click("Next slide");
    expect(active()).toBe("daily");
    await click("Previous slide");
    expect(active()).toBe("leaderboard");
    await click("Resume rotation");
    await advance(10000);
    expect(active()).toBe("daily");
    await click("Open Euclid");
    expect(active()).toBe("daily");
    expect(requestExpandedMode).toHaveBeenCalledWith(
      expect.any(MouseEvent),
      "game",
    );
  });

  it("shows a resumable pause when a slide control receives focus", async () => {
    await mount();
    await click("Show Leaderboard");
    await act(async () => button("vs Euclid").focus());
    expect(button("Resume rotation")).toBeTruthy();
    expect(button("Pause rotation")).toBeUndefined();
    await advance(20000);
    expect(active()).toBe("leaderboard");
    await click("Resume rotation");
    await advance(10000);
    expect(active()).toBe("daily");
  });

  it("labels sample winners, includes time and both win totals, without activity navigation", async () => {
    await mount();
    await click("Show Weekly Challenge Winner");
    const weekly = host.querySelector('[data-slide="weekly"]')!;
    expect(weekly.querySelector(".preview-panel__kicker")?.textContent).toBe(
      "Weekly Challenge Winner",
    );
    expect(weekly.textContent).toContain("Completed challenge");
    expect(weekly.textContent).toContain("0:42.7");
    expect(weekly.textContent).toContain("12 daily wins");
    expect(weekly.textContent).toContain("3 weekly wins");
    expect(weekly.textContent).toContain("Sample result");
    expect(weekly.querySelector(".avatar")?.getAttribute("src")).toBe(
      "https://www.redditstatic.com/avatars/defaults/v2/avatar_default_0.png",
    );
    expect(host.querySelector('[data-slide="play"]')).toBeNull();
    for (const label of [
      "Options",
      "Watch live",
      "Full leaderboard",
      "Play now",
    ])
      expect(button(label)).toBeUndefined();
  });

  it("choreographs the winner only while shown and counts the time up to the result", async () => {
    await mount();
    await click("Show Daily Challenge Winner");
    const daily = host.querySelector('[data-slide="daily"] .splash-winner')!;
    const weekly = host.querySelector('[data-slide="weekly"] .splash-winner')!;
    expect(daily.classList.contains("splash-scene--live")).toBe(true);
    expect(weekly.classList.contains("splash-scene--live")).toBe(false);
    // One piece per move, and the final time is announced, not the count.
    expect(daily.querySelectorAll(".splash-winner__pieces svg")).toHaveLength(
      2,
    );
    expect(daily.querySelector(".euclid-sr-only")?.textContent).toBe(
      "Solved in 2 moves, 0:18.4.",
    );
    const shown = () =>
      daily.querySelector(".splash-winner__stat dd.num")?.textContent;
    expect(shown()).toBe("0:00.0");
    await advance(3000);
    expect(shown()).toBe("0:18.4");
  });

  it("dates finalized winners", async () => {
    challenges.daily!.endsAt = Date.UTC(2026, 8, 21);
    await mount();
    expect(host.querySelector('[data-slide="daily"]')?.textContent).toContain(
      "Ended 21 Sept 2026, 00:00 GMT",
    );
  });

  it("refreshes remote disablement while the selected winner is paused", async () => {
    await mount();
    await click("Show Daily Challenge Winner");
    await click("Pause rotation");
    settings = { ...settings, dailyChallenges: false };
    failSpotlights = true;
    await advance(30000);
    expect(host.querySelector('[data-slide="daily"]')).toBeNull();
    expect(host.querySelectorAll("[data-slide]")).toHaveLength(3);
    expect(active()).toBe("leaderboard");
  });

  it("refreshes challenge visibility when returning from expanded mode", async () => {
    await mount();
    await click("Show Weekly Challenge Winner");
    await click("Pause rotation");
    await click("Open Euclid");
    await act(async () => {
      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        value: "hidden",
      });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    settings = { ...settings, weeklyChallenges: false };
    failSpotlights = true;
    await act(async () => {
      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        value: "visible",
      });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(host.querySelector('[data-slide="weekly"]')).toBeNull();
    expect(active()).toBe("leaderboard");
    expect(button("Open Euclid")).toBeTruthy();
    expect(button("Resume rotation")).toBeTruthy();
  });

  it("removes an expired winner even when its challenge remains enabled", async () => {
    await mount();
    await click("Show Daily Challenge Winner");
    await click("Pause rotation");
    challenges = { ...challenges, daily: null };
    await advance(30000);
    expect(host.querySelector('[data-slide="daily"]')).toBeNull();
    expect(active()).toBe("leaderboard");
  });

  it("shows the winner's result at once with reduced motion", async () => {
    reduced = true;
    await mount();
    await click("Show Daily Challenge Winner");
    const daily = host.querySelector('[data-slide="daily"] .splash-winner')!;
    expect(daily.classList.contains("splash-scene--live")).toBe(false);
    await advance(100);
    expect(
      daily.querySelector(".splash-winner__stat dd.num")?.textContent,
    ).toBe("0:18.4");
  });

  it("celebrates standings and winners with falling confetti", async () => {
    await mount();
    for (const slide of ["leaderboard", "daily", "weekly"])
      expect(
        host.querySelectorAll(
          `[data-slide="${slide}"] .splash-confetti > span`,
        ),
      ).toHaveLength(16);
    expect(host.querySelectorAll("[data-slide] .splash-confetti")).toHaveLength(
      3,
    );
    await click("Show Leaderboard");
    const standings = host.querySelector(
      '[data-slide="leaderboard"] .splash-scene',
    )!;
    expect(standings.classList.contains("splash-scene--live")).toBe(true);
  });

  it("rotates only teaching and leaderboard when no winners are available", async () => {
    challenges = EMPTY_CHALLENGE_SPOTLIGHTS;
    settings = {
      ...DEFAULT_SUBREDDIT_SETTINGS,
      dailyChallenges: false,
      weeklyChallenges: false,
    };
    await mount();
    expect(host.querySelectorAll("[data-slide]")).toHaveLength(2);
    expect(host.textContent).not.toContain("Sample result");
    expect(host.textContent).not.toContain("Daily Challenge");
    await click("Next slide");
    await advance(10000);
    expect(active()).toBe("rules");
  });

  it("honors reduced motion and pauses while the document is hidden", async () => {
    reduced = true;
    await mount();
    await advance(6000);
    expect(button("Resume rotation")).toBeTruthy();
    expect(host.textContent).toContain("A full game in 33 moves");
    await click("Next slide");
    await click("Resume rotation");
    await act(async () => {
      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        value: "hidden",
      });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await advance(20000);
    expect(active()).toBe("leaderboard");
    await act(async () => {
      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        value: "visible",
      });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await advance(10000);
    expect(active()).toBe("daily");
  });

  it("reports asynchronous expansion failures without losing the launch controls", async () => {
    vi.mocked(requestExpandedMode).mockRejectedValue(new Error("Unavailable"));
    await mount();
    await click("Open Euclid");
    expect(host.querySelector('[role="alert"]')?.textContent).toContain(
      "Could not open",
    );
    expect(button("Open Euclid")).toBeTruthy();
    vi.mocked(requestExpandedMode).mockResolvedValue(undefined);
    await click("Open Euclid");
    expect(host.querySelector('[role="alert"]')).toBeNull();
  });
});
