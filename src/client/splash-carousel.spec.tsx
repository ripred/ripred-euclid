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
let failSave: boolean;
let failSpotlights: boolean;
let failSettingsLoad: boolean;
let releaseSave: (() => void) | undefined;
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
  failSave = false;
  failSpotlights = false;
  failSettingsLoad = false;
  releaseSave = undefined;
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
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "/api/subreddit-settings" && init?.method === "PUT") {
        if (releaseSave)
          await new Promise<void>((resolve) => {
            releaseSave = resolve;
          });
        if (failSave)
          return {
            ok: false,
            json: async () => ({ message: "Moderator access denied." }),
          };
        settings = JSON.parse(init.body as string).settings;
      }
      if (
        (url === "/api/challenge-spotlights" && failSpotlights) ||
        (url === "/api/subreddit-settings" && !init?.method && failSettingsLoad)
      )
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

  it("finishes the teaching game, then cycles standings, both winners, choices, and rules", async () => {
    await mount();
    const play = button("Play now"),
      watch = button("Watch live");
    expect(active()).toBe("rules");
    await advance(5000);
    expect(active()).toBe("rules");
    expect(host.textContent).toContain("Move 1 of 33");
    await advance(37000);
    expect(active()).toBe("leaderboard");
    for (const next of ["daily", "weekly", "play", "rules"]) {
      await advance(10000);
      expect(active()).toBe(next);
      expect(button("Play now")).toBe(play);
      expect(button("Watch live")).toBe(watch);
    }
    expect(host.querySelectorAll("[data-slide][inert]")).toHaveLength(4);
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
    await click("Play now");
    expect(active()).toBe("play");
    expect(requestExpandedMode).not.toHaveBeenCalled();
    const solo = host.querySelector<HTMLButtonElement>(".splash-choice--solo")!;
    await act(async () => solo.click());
    expect(requestExpandedMode).toHaveBeenCalledWith(
      expect.any(MouseEvent),
      "solo",
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

  it("labels sample winners, includes time and both win totals, and opens enabled challenges", async () => {
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
    expect(host.querySelectorAll(".splash-choice--challenge")).toHaveLength(2);
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

  it("opens each enabled public challenge and dates finalized winners", async () => {
    challenges.daily!.endsAt = Date.UTC(2026, 8, 21);
    await mount();
    expect(host.querySelector('[data-slide="daily"]')?.textContent).toContain(
      "Ended 21 Sept 2026, 00:00 GMT",
    );
    await click("Play now");
    const choices = host.querySelectorAll<HTMLButtonElement>(
      ".splash-choice--challenge",
    );
    for (const [index, period] of ["daily", "weekly"].entries()) {
      await act(async () => choices[index]!.click());
      expect(requestExpandedMode).toHaveBeenLastCalledWith(
        expect.any(MouseEvent),
        period,
      );
    }
  });

  it("refreshes remote disablement while the selected winner is paused", async () => {
    await mount();
    await click("Show Daily Challenge Winner");
    await click("Pause rotation");
    settings = { ...settings, dailyChallenges: false };
    await advance(30000);
    expect(host.querySelector('[data-slide="daily"]')).toBeNull();
    expect(host.querySelectorAll(".splash-choice--challenge")).toHaveLength(1);
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

  it("celebrates standings and winners with falling confetti, and invites a move", async () => {
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
    await click("Show Choose a game");
    const play = host.querySelector('[data-slide="play"]')!;
    expect(play.querySelector("h2")?.textContent).toBe("Choose a game");
    expect(play.querySelectorAll(".board__marker--pending")).toHaveLength(1);
  });

  it("edits and saves game options in the post while the rotation holds", async () => {
    localStorage.clear();
    await mount();
    await click("Options");
    const dialog = host.querySelector('[role="dialog"]')!;
    expect(dialog.getAttribute("aria-labelledby")).toBe("splash-options-title");
    expect(document.activeElement?.id).toBe("splash-options-title");
    expect(host.querySelector(".splash-carousel")?.hasAttribute("inert")).toBe(
      true,
    );
    const hintPoints = () =>
      dialog.querySelectorAll('[class*="board__point--hint-"]').length;
    expect(hintPoints()).toBe(0);
    // Turning hints on previews them on the stage's 8×8 showcase board.
    await act(async () =>
      dialog.querySelectorAll<HTMLInputElement>(".switch input")[0]!.click(),
    );
    expect(hintPoints()).toBeGreaterThan(0);
    const slider =
      dialog.querySelector<HTMLInputElement>("#splash-difficulty")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )!.set!.call(slider, "8");
      slider.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(JSON.parse(localStorage.getItem("euclid_practice_setup")!)).toEqual({
      difficulty: "brutal",
      assist: true,
    });
    expect(dialog.querySelector('[aria-label="Board width"]')).toBeNull();
    expect(dialog.querySelector('[aria-label="Scoring"]')).toBeNull();
    await advance(45000);
    expect(active()).toBe("rules");
    await act(async () => {
      dialog.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });
    expect(host.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement?.textContent).toBe("Options");
    expect(requestExpandedMode).not.toHaveBeenCalled();
  });

  it("omits sample results and challenge choices when no contests are available", async () => {
    challenges = EMPTY_CHALLENGE_SPOTLIGHTS;
    settings = {
      ...DEFAULT_SUBREDDIT_SETTINGS,
      dailyChallenges: false,
      weeklyChallenges: false,
    };
    await mount();
    expect(host.querySelectorAll("[data-slide]")).toHaveLength(3);
    expect(host.textContent).not.toContain("Sample result");
    expect(host.textContent).not.toContain("Daily Challenge");
    await click("Next slide");
    await advance(10000);
    expect(active()).toBe("play");
  });

  it("keeps subreddit controls and playground hidden from non-moderators", async () => {
    await mount();
    await click("Options");
    expect(host.querySelector('[role="tablist"]')).toBeNull();
    expect(button("Challenge playground")).toBeUndefined();
    expect(
      vi
        .mocked(fetch)
        .mock.calls.some(([url]) => url === "/api/subreddit-settings"),
    ).toBe(false);
  });

  it("opens the moderator playground even with both public challenges off", async () => {
    isModerator = true;
    settings = {
      ...DEFAULT_SUBREDDIT_SETTINGS,
      dailyChallenges: false,
      weeklyChallenges: false,
    };
    await mount();
    await click("Options");
    await click("Subreddit");
    expect(host.querySelector('[role="tabpanel"]')?.textContent).toContain(
      "Challenge playground",
    );
    expect(
      host.querySelectorAll(
        ".splash-options .switch:nth-of-type(-n+2) input:checked",
      ),
    ).toHaveLength(0);
    await click("Challenge playground");
    expect(requestExpandedMode).toHaveBeenCalledWith(
      expect.any(MouseEvent),
      "challenge",
    );
    expect(
      vi.mocked(fetch).mock.calls.filter(([, init]) => init?.method === "PUT"),
    ).toHaveLength(0);
  });

  it("reports playground expansion errors inside the open options", async () => {
    isModerator = true;
    vi.mocked(requestExpandedMode).mockRejectedValue(new Error("Unavailable"));
    await mount();
    await click("Options");
    await click("Subreddit");
    await click("Challenge playground");
    expect(
      host.querySelector('.splash-options [role="alert"]')?.textContent,
    ).toContain("Could not open");
  });

  it("saves application timing and shared standings without applying a template", async () => {
    isModerator = true;
    await mount();
    await click("Options");
    await click("Subreddit");
    const select = host.querySelector<HTMLSelectElement>(
      ".splash-options select",
    )!;
    await act(async () => {
      select.value = "immediately";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(settings.challengeApplyTiming).toBe("immediately");
    await act(async () =>
      host
        .querySelectorAll<HTMLInputElement>(".splash-options input")[2]!
        .click(),
    );
    expect(settings.showLiveChallengeStandings).toBe(false);
    expect(settings.dailyChallenges).toBe(true);
    expect(settings.weeklyChallenges).toBe(true);
    expect(
      vi
        .mocked(fetch)
        .mock.calls.some(([url]) => String(url).endsWith("/apply")),
    ).toBe(false);
  });

  it("supports keyboard switching between personal and subreddit options", async () => {
    isModerator = true;
    await mount();
    await click("Options");
    await act(async () => {
      button("Your options").focus();
      button("Your options").dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }),
      );
    });
    expect(document.activeElement).toBe(button("Subreddit"));
    expect(button("Subreddit").getAttribute("aria-selected")).toBe("true");
    await act(async () =>
      button("Subreddit").dispatchEvent(
        new KeyboardEvent("keydown", { key: "Home", bubbles: true }),
      ),
    );
    expect(document.activeElement).toBe(button("Your options"));
    expect(host.querySelector("#splash-difficulty")).not.toBeNull();
  });

  it("saves each switch, removes the displayed winner while paused, and persists on reopen", async () => {
    isModerator = true;
    await mount();
    await click("Pause rotation");
    await click("Show Daily Challenge Winner");
    await click("Options");
    await click("Subreddit");
    // A failed spotlight reload must never leave a disabled challenge visible.
    failSpotlights = true;
    await act(async () =>
      host
        .querySelectorAll<HTMLInputElement>(".splash-options input")[0]!
        .click(),
    );
    expect(settings).toEqual({
      ...DEFAULT_SUBREDDIT_SETTINGS,
      dailyChallenges: false,
      weeklyChallenges: true,
    });
    expect(host.querySelector('[data-slide="daily"]')).toBeNull();
    expect(host.querySelector('[data-slide="weekly"]')).not.toBeNull();
    expect(host.querySelectorAll(".splash-choice--challenge")).toHaveLength(1);
    expect(active()).toBe("leaderboard");
    await act(async () =>
      host
        .querySelectorAll<HTMLInputElement>(".splash-options input")[1]!
        .click(),
    );
    expect(settings).toEqual({
      ...DEFAULT_SUBREDDIT_SETTINGS,
      dailyChallenges: false,
      weeklyChallenges: false,
    });
    expect(host.querySelectorAll(".splash-choice--challenge")).toHaveLength(0);
    await click("Done");
    await click("Options");
    await click("Subreddit");
    expect(
      host.querySelectorAll(
        ".splash-options .switch:nth-of-type(-n+2) input:checked",
      ),
    ).toHaveLength(0);
    failSpotlights = false;
    await act(async () =>
      host
        .querySelectorAll<HTMLInputElement>(".splash-options input")[0]!
        .click(),
    );
    expect(host.querySelector('[data-slide="daily"]')).not.toBeNull();
    expect(host.querySelector('[data-slide="weekly"]')).toBeNull();
  });

  it("keeps saved switches unchanged on a rejected save and allows retry", async () => {
    isModerator = true;
    failSave = true;
    await mount();
    await click("Options");
    await click("Subreddit");
    const daily = host.querySelector<HTMLInputElement>(
      ".splash-options input",
    )!;
    await act(async () => daily.click());
    expect(daily.checked).toBe(true);
    expect(
      host.querySelector('.splash-options [role="alert"]')?.textContent,
    ).toContain("Moderator access denied");
    expect(host.querySelector('[data-slide="daily"]')).not.toBeNull();
    failSave = false;
    await act(async () => daily.click());
    expect(daily.checked).toBe(false);
  });

  it("disables further changes while a save is pending", async () => {
    isModerator = true;
    releaseSave = () => {};
    await mount();
    await click("Options");
    await click("Subreddit");
    await act(async () =>
      host.querySelector<HTMLInputElement>(".splash-options input")!.click(),
    );
    expect(
      host.querySelector<HTMLFieldSetElement>(".splash-options fieldset")!
        .disabled,
    ).toBe(true);
    expect(
      host.querySelector('.splash-options [role="status"]')?.textContent,
    ).toBe("Saving…");
    expect(button("Your options").disabled).toBe(true);
    expect(button("Done").disabled).toBe(true);
    expect(button("Challenge playground").disabled).toBe(true);
    await act(async () =>
      host
        .querySelector('[role="dialog"]')!
        .dispatchEvent(
          new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
        ),
    );
    expect(host.querySelector('[role="dialog"]')).not.toBeNull();
    await act(async () => releaseSave!());
    expect(
      host.querySelector<HTMLFieldSetElement>(".splash-options fieldset")!
        .disabled,
    ).toBe(false);
    expect(button("Your options").disabled).toBe(false);
    expect(button("Done").disabled).toBe(false);
    expect(button("Challenge playground").disabled).toBe(false);
  });

  it("allows retry after loading settings fails without blocking the playground", async () => {
    isModerator = true;
    failSettingsLoad = true;
    await mount();
    await click("Options");
    await click("Subreddit");
    expect(
      host.querySelector<HTMLFieldSetElement>(".splash-options fieldset")!
        .disabled,
    ).toBe(true);
    expect(button("Challenge playground").disabled).toBe(false);
    failSettingsLoad = false;
    await click("Retry");
    expect(
      host.querySelector<HTMLFieldSetElement>(".splash-options fieldset")!
        .disabled,
    ).toBe(false);
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
    await click("Watch live");
    expect(host.querySelector('[role="alert"]')?.textContent).toContain(
      "Could not open",
    );
    expect(button("Play now")).toBeTruthy();
  });
});
