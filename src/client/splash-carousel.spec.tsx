// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { requestExpandedMode } from "@devvit/web/client";
import { PreviewApp } from "./preview";
import {
  EMPTY_CHALLENGE_SPOTLIGHTS,
  type ChallengeSpotlights,
} from "../shared/challenge-spotlights";

vi.mock("@devvit/web/client", () => ({ requestExpandedMode: vi.fn() }));
let root: Root, host: HTMLDivElement;
let reduced: boolean;
let challenges: ChallengeSpotlights;
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
    vi.fn(async (url: string) => ({
      ok: true,
      json: async () =>
        url === "/api/init"
          ? { type: "init", username: "local_moderator", postId: "post" }
          : url === "/api/challenge-spotlights"
            ? challenges
            : url.startsWith("/api/users/")
              ? {
                  username: url.split("/")[3],
                  avatar:
                    "https://www.redditstatic.com/avatars/defaults/v2/avatar_default_0.png",
                }
              : { hvh: [], hva: [] },
    })),
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
    await advance(35000);
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

  it("labels sample winners, includes time and both win totals, and disables unopened challenges", async () => {
    await mount();
    await click("Show Weekly winner");
    const weekly = host.querySelector('[data-slide="weekly"]')!;
    expect(weekly.textContent).toContain("Last week’s weekly challenge");
    expect(weekly.textContent).toContain("0:42.7");
    expect(weekly.textContent).toContain("12 daily wins");
    expect(weekly.textContent).toContain("3 weekly wins");
    expect(weekly.textContent).toContain("Sample result");
    expect(weekly.querySelector(".avatar")?.getAttribute("src")).toBe(
      "https://www.redditstatic.com/avatars/defaults/v2/avatar_default_0.png",
    );
    expect(host.querySelectorAll(".splash-choice:disabled")).toHaveLength(2);
  });

  it("omits sample results and challenge choices when no contests are available", async () => {
    challenges = EMPTY_CHALLENGE_SPOTLIGHTS;
    await mount();
    expect(host.querySelectorAll("[data-slide]")).toHaveLength(3);
    expect(host.textContent).not.toContain("Sample result");
    expect(host.textContent).not.toContain("Daily Challenge");
    await click("Next slide");
    await advance(10000);
    expect(active()).toBe("play");
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
