// @vitest-environment jsdom
import { act, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CompetitionScreen } from "./competition-screen";
import {
  placeChallengePoint,
  type ChallengeSnapshot,
} from "../shared/challenge";
import type {
  CompetitionStateResponse,
  CompetitionStandingsResponse,
} from "../shared/competitions";
import type { ChallengePeriod } from "../shared/challenge-spotlights";

const NOW = Date.UTC(2026, 8, 27, 10);
const fresh = (): ChallengeSnapshot => ({
  puzzleId: "daily-1",
  attemptId: "attempt-1",
  revision: 1,
  puzzle: {
    version: 1,
    size: 8,
    initial: [0, 1],
    blocked: [63],
    minimumMoves: 2,
    targetSquares: 1,
  },
  placements: [],
  completedSquares: [],
  complete: false,
  bestMoves: null,
  startedAt: NOW,
  finishedAt: null,
  elapsedMs: 0,
  bestElapsedMs: null,
});
let state: CompetitionStateResponse;
let standings: CompetitionStandingsResponse;
let host: HTMLDivElement, root: Root;
let loseMoveReply: boolean;
let failRecovery: boolean;
let replaceOnMove: boolean;
const requests: { url: string; body: Record<string, unknown> | null }[] = [];
const leave = vi.fn();

beforeEach(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers();
  state = {
    competition: {
      period: "daily",
      enabled: true,
      status: "open",
      instanceId: "daily-1",
      opensAt: NOW - 36000000,
      endsAt: NOW + 50400000,
      showStandings: true,
    },
    snapshot: null,
    personalBest: null,
    personalRank: null,
    serverNow: NOW,
    authenticated: true,
    latestResult: null,
  };
  standings = {
    instanceId: "daily-1",
    visible: true,
    standings: [],
    offset: 0,
    hasMore: false,
    serverNow: NOW,
  };
  loseMoveReply = false;
  failRecovery = false;
  replaceOnMove = false;
  requests.length = 0;
  leave.mockReset();
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const body = init?.body
        ? (JSON.parse(String(init.body)) as Record<string, unknown>)
        : null;
      requests.push({ url, body });
      if (url.includes("/standings"))
        return {
          ok: true,
          json: async () =>
            structuredClone({
              ...standings,
              offset: Number(
                new URL(url, "https://local").searchParams.get("offset"),
              ),
            }),
        };
      const action = url.split("/").at(-1);
      if (action === "state" && failRecovery) throw new Error("Still offline");
      if (action === "start") state.snapshot = fresh();
      if (action === "retry")
        state.snapshot = { ...fresh(), attemptId: "attempt-2" };
      if (action === "move" && replaceOnMove) {
        state = {
          ...state,
          competition: {
            ...state.competition,
            instanceId: "daily-replacement",
          },
          snapshot: null,
          personalBest: null,
        };
        return {
          ok: false,
          json: async () => ({ code: "stale", message: "Challenge replaced." }),
        };
      }
      if (action === "move" && state.snapshot) {
        state.snapshot = placeChallengePoint(
          state.snapshot,
          body!.point as number,
          NOW + 4000,
        );
        if (state.snapshot.complete)
          state.personalBest = {
            username: "player",
            moves: state.snapshot.placements.length,
            elapsedMs: state.snapshot.elapsedMs,
            achievedAt: NOW + 4000,
          };
        if (loseMoveReply) {
          loseMoveReply = false;
          throw new Error("Reply lost");
        }
      }
      return { ok: true, json: async () => structuredClone(state) };
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
  vi.restoreAllMocks();
});
async function mount(period: ChallengePeriod = "daily", username = "player") {
  await act(async () =>
    root.render(
      <StrictMode>
        <CompetitionScreen
          period={period}
          username={username}
          onLeave={leave}
        />
      </StrictMode>,
    ),
  );
}
function button(label: string): HTMLButtonElement {
  const result = Array.from(host.querySelectorAll("button")).find(
    (element) => element.textContent === label,
  );
  expect(result, label).toBeTruthy();
  return result!;
}
async function click(element: Element) {
  await act(async () =>
    element.dispatchEvent(new MouseEvent("click", { bubbles: true })),
  );
}
function point(index: number) {
  const cell = host.querySelector(`[data-index="${index}"]`);
  expect(cell).toBeTruthy();
  return cell!;
}
const mutations = () => requests.filter(({ body }) => body !== null);

describe("public competition play", () => {
  it.each(["daily", "weekly"] as const)(
    "does not reveal or start the %s board before Start",
    async (period) => {
      await mount(period);
      expect(host.querySelector('[role="grid"]')).toBeNull();
      expect(mutations()).toEqual([]);
      await click(button("Start challenge"));
      expect(host.querySelector('[role="grid"]')).toBeTruthy();
      expect(mutations()[0]).toMatchObject({
        url: `/api/competitions/${period}/start`,
        body: {
          instanceId: "daily-1",
          attemptId: null,
          expectedRevision: 0,
          commandId: expect.any(String),
        },
      });
    },
  );
  it("resumes the server attempt without starting or restarting its timer", async () => {
    state.snapshot = {
      ...fresh(),
      placements: [8],
      elapsedMs: 90000,
      revision: 2,
    };
    await mount();
    expect(host.textContent).toContain("1:30.0");
    expect(host.textContent).toContain("Pieces placed: 1");
    expect(mutations()).toEqual([]);
    await click(button("Back to Euclid"));
    expect(leave).toHaveBeenCalledOnce();
    expect(mutations()).toEqual([]);
  });
  it("submits revisioned placements, completes, and retries while preserving the best result", async () => {
    await mount();
    await click(button("Start challenge"));
    await click(point(8));
    await click(point(9));
    expect(host.textContent).toContain("Puzzle complete");
    expect(host.textContent).toContain("Your best:");
    const moves = mutations().filter(({ url }) => url.endsWith("/move"));
    expect(moves[1]?.body).toMatchObject({
      expectedRevision: 2,
      attemptId: "attempt-1",
      instanceId: "daily-1",
      point: 9,
    });
    expect(moves[0]?.body?.commandId).not.toBe(moves[1]?.body?.commandId);
    await click(button("Retry same puzzle"));
    expect(host.textContent).toContain("Pieces placed: 0");
    expect(host.textContent).toContain("Your best:");
    expect(host.textContent).toContain("2 moves · 0:04.0");
    expect(
      host.querySelector('[data-index="63"]')?.getAttribute("aria-disabled"),
    ).toBe("true");
  });
  it("confirms retrying an incomplete attempt and keeps the board unchanged on cancel", async () => {
    state.snapshot = { ...fresh(), placements: [8] };
    await mount();
    await click(button("Retry same puzzle"));
    expect(host.querySelector('[role="dialog"]')).toBeTruthy();
    await click(button("Keep playing"));
    expect(mutations()).toEqual([]);
    await click(button("Retry same puzzle"));
    await click(button("Restart attempt"));
    expect(mutations().at(-1)?.url).toBe("/api/competitions/daily/retry");
  });
  it("recovers a lost move reply without duplicating its placement", async () => {
    state.snapshot = fresh();
    await mount();
    loseMoveReply = true;
    await click(point(8));
    expect(host.textContent).toContain("Pieces placed: 1");
    expect(mutations()).toHaveLength(1);
    expect(host.textContent).toContain("Reply lost");
    await click(point(9));
    expect(host.textContent).toContain("Puzzle complete");
  });
  it("locks uncertain state until a successful refresh", async () => {
    state.snapshot = fresh();
    await mount();
    loseMoveReply = true;
    failRecovery = true;
    await click(point(8));
    await click(point(9));
    expect(mutations()).toHaveLength(1);
    expect(point(9).getAttribute("aria-disabled")).toBe("true");
    failRecovery = false;
    await click(button("Refresh challenge"));
    expect(point(9).getAttribute("aria-disabled")).toBe("false");
    expect(host.textContent).toContain("Pieces placed: 1");
  });
  it("dismisses a pending retry when moderators disable the challenge", async () => {
    state.snapshot = { ...fresh(), placements: [8] };
    await mount();
    await click(button("Retry same puzzle"));
    expect(host.querySelector('[role="dialog"]')).toBeTruthy();
    state.competition.enabled = false;
    state.competition.status = "disabled";
    state.serverNow += 15000;
    await act(async () => vi.advanceTimersByTime(15000));
    expect(host.querySelector('[role="dialog"]')).toBeNull();
    expect(host.textContent).toContain("Challenge disabled");
    expect(mutations()).toEqual([]);
  });

  it("reconciles replacement conflicts and does not reuse the previous attempt", async () => {
    state.snapshot = fresh();
    await mount();
    replaceOnMove = true;
    await click(point(8));
    expect(host.querySelector('[role="grid"]')).toBeNull();
    expect(host.textContent).toContain("Moderators replaced this challenge");
    await click(button("Start challenge"));
    expect(mutations().at(-1)?.body).toMatchObject({
      instanceId: "daily-replacement",
      attemptId: null,
      expectedRevision: 0,
    });
  });
  it("closes input at the deadline according to interpolated server time", async () => {
    state.snapshot = fresh();
    state.competition.endsAt = NOW + 1000;
    await mount();
    state = { ...state, serverNow: NOW + 1000 };
    await act(async () => vi.advanceTimersByTime(1100));
    expect(host.querySelector('[role="grid"]')).toBeNull();
    expect(host.textContent).toContain("Challenge closed");
    expect(mutations()).toEqual([]);
  });
  it("does not allow anonymous start even if the initialization username is stale", async () => {
    state.authenticated = false;
    await mount();
    expect(host.textContent).toContain("Sign in to play");
    expect(host.querySelector('[role="grid"]')).toBeNull();
    expect(mutations()).toEqual([]);
  });
  it.each(["disabled", "scheduled", "unavailable"] as const)(
    "handles %s without exposing a board",
    async (status) => {
      state.competition.status = status;
      state.competition.enabled = status !== "disabled";
      if (status === "scheduled") state.competition.opensAt = NOW + 100000;
      await mount();
      expect(host.querySelector('[role="grid"]')).toBeNull();
      expect(
        Array.from(host.querySelectorAll("button")).some(
          (item) => item.textContent === "Start challenge",
        ),
      ).toBe(false);
      expect(mutations()).toEqual([]);
    },
  );
});

describe("competition results", () => {
  it("hides live standings and rank while preserving the player's best", async () => {
    state.competition.showStandings = false;
    state.personalBest = {
      username: "player",
      moves: 2,
      elapsedMs: 999,
      achievedAt: NOW,
    };
    state.personalRank = 4;
    await mount();
    expect(host.textContent).toContain("Your best:");
    expect(host.textContent).not.toContain("Rank 4");
    expect(host.textContent).toContain("Live standings are hidden");
    expect(requests.some(({ url }) => url.includes("/standings"))).toBe(false);
  });
  it("hides rank immediately when the standings endpoint reports a newer privacy change", async () => {
    state.personalBest = {
      username: "player",
      moves: 2,
      elapsedMs: 999,
      achievedAt: NOW,
    };
    state.personalRank = 4;
    standings.visible = false;
    await mount();
    expect(host.textContent).not.toContain("Rank 4");
    expect(host.textContent).toContain("Live standings are hidden");
  });

  it("pages public standings by twenty and renders rank and best result", async () => {
    standings.hasMore = true;
    standings.standings = [
      {
        username: "fast_player",
        moves: 2,
        elapsedMs: 2500,
        achievedAt: NOW,
        rank: 1,
      },
    ];
    await mount();
    expect(host.textContent).toContain("u/fast_player");
    expect(host.textContent).toContain("2 moves · 0:02.5");
    await click(button("Next page"));
    expect(requests.at(-1)?.url).toBe(
      "/api/competitions/daily/standings?offset=20",
    );
    await click(button("Previous page"));
    expect(requests.at(-1)?.url).toBe(
      "/api/competitions/daily/standings?offset=0",
    );
  });
  it("shows dated finalized results without describing older winners as yesterday's", async () => {
    state.latestResult = {
      instanceId: "old",
      period: "daily",
      opensAt: NOW - 86400000,
      endsAt: NOW - 36000000,
      superseded: false,
      winner: {
        username: "winner",
        moves: 2,
        elapsedMs: 1234,
        dailyWins: 1,
        weeklyWins: 0,
      },
    };
    await mount();
    expect(host.textContent).toContain("Latest finalized result");
    expect(host.textContent).toContain("Period ended 27 Sept 2026, 00:00 GMT");
    expect(host.textContent).toContain("u/winner");
    expect(host.textContent).not.toMatch(/yesterday/i);
  });
});
