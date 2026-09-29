// @vitest-environment jsdom
import { act, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CompetitionScreen } from "./competition-screen";
import { createJourneyController, type JourneyController } from "./journeys";
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
let stateReadOverride: CompetitionStateResponse | null;
let standings: CompetitionStandingsResponse;
let host: HTMLDivElement, root: Root;
let loseMoveReply: boolean;
let loseAbandonReply: boolean;
let failAbandon: boolean;
let failRetry: boolean;
let failRecovery: boolean;
let replaceOnMove: boolean;
let heldAction: string | null;
let heldRequest: Promise<void>;
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
  stateReadOverride = null;
  standings = {
    instanceId: "daily-1",
    visible: true,
    standings: [],
    offset: 0,
    hasMore: false,
    serverNow: NOW,
  };
  loseMoveReply = false;
  loseAbandonReply = false;
  failAbandon = false;
  failRetry = false;
  failRecovery = false;
  replaceOnMove = false;
  heldAction = null;
  heldRequest = Promise.resolve();
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
      if (action === heldAction) await heldRequest;
      if (action === "state" && failRecovery) throw new Error("Still offline");
      if (action === "state" && stateReadOverride)
        return {
          ok: true,
          json: async () => structuredClone(stateReadOverride),
        };
      if (action === "start")
        state.snapshot = {
          ...fresh(),
          puzzleId: state.competition.instanceId!,
        };
      if (action === "retry" && failRetry)
        return {
          ok: false,
          status: 503,
          json: async () => ({ message: "Retry unavailable." }),
        };
      if (action === "retry")
        state.snapshot = {
          ...fresh(),
          puzzleId: state.competition.instanceId!,
          attemptId: "attempt-2",
        };
      if (action === "abandon") {
        if (failAbandon)
          return {
            ok: false,
            json: async () => ({ message: "Abandon unavailable." }),
          };
        state.snapshot = null;
        if (loseAbandonReply) {
          loseAbandonReply = false;
          throw new Error("Abandon reply lost");
        }
      }
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
            squares: state.snapshot.completedSquares.length,
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
async function mount(
  period: ChallengePeriod = "daily",
  username = "player",
  journeys?: JourneyController,
  intentionalEntry = false,
) {
  await act(async () =>
    root.render(
      <StrictMode>
        <CompetitionScreen
          period={period}
          username={username}
          onLeave={leave}
          {...(journeys ? { journeys } : {})}
          intentionalEntry={intentionalEntry}
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
function hold(action: string) {
  heldAction = action;
  let release!: () => void;
  heldRequest = new Promise<void>((resolve) => {
    release = resolve;
  });
  return release;
}

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
  it.each([
    [1, 1, "Complete 1 Square In 1 move"],
    [1, 2, "Complete 1 Square In 2 moves"],
    [3, 1, "Complete 3 Squares In 1 move"],
    [3, 4, "Complete 3 Squares In 4 moves"],
  ] as const)(
    "shows the objective for %s squares and %s moves without a progress fraction",
    async (targetSquares, minimumMoves, objective) => {
      state.snapshot = fresh();
      state.snapshot.puzzle = {
        ...state.snapshot.puzzle,
        targetSquares,
        minimumMoves,
      };
      await mount();
      expect(host.querySelector(".competition-objective h2")?.textContent).toBe(
        objective,
      );
      expect(
        host.querySelector(".competition-progress")?.textContent,
      ).toContain("Squares completed: 0 · Pieces placed: 0");
      expect(
        host.querySelector(".competition-objective")?.textContent,
      ).not.toMatch(/\d+\s*\/\s*\d+/);
      expect(mutations()).toEqual([]);
    },
  );
  it("keeps metadata in Details and standings and blocks board input until it closes", async () => {
    state.snapshot = fresh();
    await mount();
    expect(host.textContent).not.toContain("One puzzle for this subreddit");
    expect(host.textContent).not.toContain("Most squares wins");
    expect(host.querySelector("#competition-standings-title")).toBeNull();
    expect(point(8).getAttribute("aria-disabled")).toBe("false");

    await click(button("Details & standings"));
    const dialog = host.querySelector('[role="dialog"]');
    expect(dialog?.getAttribute("aria-modal")).toBe("true");
    expect(dialog?.textContent).toContain("Daily challenge details");
    expect(dialog?.textContent).toContain("One puzzle for this subreddit");
    expect(dialog?.textContent).toContain(
      "Most squares wins, then fewest moves, then shortest time, then first achieved.",
    );
    expect(dialog?.querySelector("#competition-standings-title")).toBeTruthy();
    expect(point(8).getAttribute("aria-disabled")).toBe("true");
    await click(point(8));
    await act(async () =>
      point(9).dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      ),
    );
    expect(mutations()).toEqual([]);

    await click(button("Close details"));
    expect(host.querySelector('[role="dialog"]')).toBeNull();
    expect(point(8).getAttribute("aria-disabled")).toBe("false");
    await click(point(8));
    expect(mutations()).toHaveLength(1);
    expect(mutations()[0]?.body?.point).toBe(8);
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
    expect(host.textContent).toContain("1 square · 2 moves · 0:04.0");
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

describe("abandoning a competition attempt", () => {
  it.each(["daily", "weekly"] as const)(
    "leaves the %s challenge only after confirmed abandonment and starts fresh on reentry",
    async (period) => {
      state.competition.period = period;
      state.competition.instanceId = `${period}-1`;
      state.snapshot = {
        ...fresh(),
        puzzleId: `${period}-1`,
        placements: [8],
        revision: 2,
      };
      const best = {
        username: "player",
        moves: 2,
        squares: 1,
        elapsedMs: 2500,
        achievedAt: NOW - 1000,
      };
      state.personalBest = best;
      const release = hold("abandon");
      await mount(period);
      await click(button("Abandon Challenge"));
      expect(mutations()).toEqual([
        {
          url: `/api/competitions/${period}/abandon`,
          body: {
            instanceId: `${period}-1`,
            attemptId: "attempt-1",
            expectedRevision: 2,
            commandId: expect.any(String),
          },
        },
      ]);
      expect(leave).not.toHaveBeenCalled();
      expect(state.snapshot?.placements).toEqual([8]);

      await act(async () => release());
      expect(leave).toHaveBeenCalledOnce();
      expect(state.snapshot).toBeNull();
      expect(state.personalBest).toEqual(best);

      await act(async () => root.render(null));
      await mount(period);
      expect(host.querySelector('[role="grid"]')).toBeNull();
      expect(button("Start challenge").disabled).toBe(false);
      expect(host.textContent).toContain(
        "Your best: 1 square · 2 moves · 0:02.5",
      );
      expect(host.textContent).not.toContain("Pieces placed: 1");
      expect(mutations()).toHaveLength(1);
      await click(button("Start challenge"));
      expect(mutations().at(-1)).toMatchObject({
        url: `/api/competitions/${period}/start`,
        body: {
          instanceId: `${period}-1`,
          attemptId: null,
          expectedRevision: 0,
        },
      });
      expect(host.textContent).toContain("Pieces placed: 0");
      expect(state.personalBest).toEqual(best);
    },
  );

  it("reconciles a lost abandonment reply before returning to the menu", async () => {
    state.snapshot = { ...fresh(), placements: [8], revision: 2 };
    await mount();
    loseAbandonReply = true;
    const releaseRecovery = hold("state");
    await click(button("Abandon Challenge"));
    expect(state.snapshot).toBeNull();
    expect(leave).not.toHaveBeenCalled();
    expect(mutations()).toHaveLength(1);
    expect(requests.at(-1)?.url).toBe("/api/competitions/daily/state");

    await act(async () => releaseRecovery());
    expect(leave).toHaveBeenCalledOnce();
    expect(mutations()).toHaveLength(1);
  });

  it.each([false, undefined])(
    "does not treat an empty recovery response with authenticated=%s as confirmed abandonment",
    async (authenticated) => {
      state.snapshot = { ...fresh(), placements: [8], revision: 2 };
      await mount();
      failAbandon = true;
      // A signed-out state read hides the user's board without deleting the
      // attempt. A response omitting identity confirmation is insufficient too.
      stateReadOverride = { ...state, snapshot: null };
      if (authenticated === undefined) delete stateReadOverride.authenticated;
      else stateReadOverride.authenticated = authenticated;
      await click(button("Abandon Challenge"));

      expect(requests.at(-1)?.url).toBe("/api/competitions/daily/state");
      expect(state.snapshot?.attemptId).toBe("attempt-1");
      expect(state.snapshot?.placements).toEqual([8]);
      expect(leave).not.toHaveBeenCalled();
      expect(host.textContent).toContain("Abandon unavailable.");
      expect(mutations()).toHaveLength(1);
    },
  );

  it("stays on the existing attempt when abandonment fails and refresh still finds it", async () => {
    state.snapshot = { ...fresh(), placements: [8], revision: 2 };
    await mount();
    failAbandon = true;
    await click(button("Abandon Challenge"));
    expect(leave).not.toHaveBeenCalled();
    expect(host.textContent).toContain("Abandon unavailable.");
    expect(host.textContent).toContain("Pieces placed: 1");
    expect(requests.at(-1)?.url).toBe("/api/competitions/daily/state");
    expect(point(9).getAttribute("aria-disabled")).toBe("false");
    expect(mutations()).toHaveLength(1);
    expect(state.snapshot?.attemptId).toBe("attempt-1");

    failAbandon = false;
    failRetry = false;
    await click(button("Abandon Challenge"));
    expect(leave).toHaveBeenCalledOnce();
    expect(mutations()).toHaveLength(2);
  });

  it("locks the attempt when abandonment and recovery both fail", async () => {
    state.snapshot = { ...fresh(), placements: [8], revision: 2 };
    await mount();
    failAbandon = true;
    failRecovery = true;
    await click(button("Abandon Challenge"));
    expect(leave).not.toHaveBeenCalled();
    expect(point(9).getAttribute("aria-disabled")).toBe("true");
    expect(button("Retry same puzzle").disabled).toBe(true);
    expect(button("Abandon Challenge").disabled).toBe(true);
    await click(point(9));
    await click(button("Retry same puzzle"));
    await click(button("Abandon Challenge"));
    expect(mutations()).toHaveLength(1);

    failRecovery = false;
    await click(button("Refresh challenge"));
    expect(leave).not.toHaveBeenCalled();
    expect(point(9).getAttribute("aria-disabled")).toBe("false");
    expect(button("Abandon Challenge").disabled).toBe(false);
  });

  it.each(["move", "retry", "abandon"] as const)(
    "blocks concurrent move, retry, abandon, and navigation while %s is pending",
    async (action) => {
      state.snapshot = fresh();
      await mount();
      const release = hold(action);
      await click(
        action === "move"
          ? point(8)
          : button(
              action === "retry" ? "Retry same puzzle" : "Abandon Challenge",
            ),
      );
      expect(mutations()).toHaveLength(1);
      expect(mutations()[0]?.url).toBe(`/api/competitions/daily/${action}`);
      expect(point(9).getAttribute("aria-disabled")).toBe("true");
      for (const label of [
        "Retry same puzzle",
        "Abandon Challenge",
        "Back to Euclid",
        "Details & standings",
      ]) {
        expect(button(label).disabled).toBe(true);
        await click(button(label));
      }
      await click(point(9));
      expect(mutations()).toHaveLength(1);
      expect(leave).not.toHaveBeenCalled();

      await act(async () => release());
      expect(mutations()).toHaveLength(1);
      expect(leave).toHaveBeenCalledTimes(action === "abandon" ? 1 : 0);
    },
  );
});

describe("competition results", () => {
  it.each(["daily", "weekly"] as const)(
    "shows unavailable square counts in legacy %s bests, standings, and winners",
    async (period) => {
      const result = {
        username: "legacy_player",
        moves: 2,
        elapsedMs: 2500,
        achievedAt: NOW,
      };
      state.personalBest = result;
      standings.standings = [{ ...result, rank: 1 }];
      state.latestResult = {
        instanceId: "old",
        period,
        opensAt: NOW - 86400000,
        endsAt: NOW - 36000000,
        superseded: false,
        winner: { ...result, dailyWins: 1, weeklyWins: 0 },
      };
      await mount(period);
      expect(host.querySelector(".competition-best")?.textContent).toContain(
        "squares unavailable · 2 moves · 0:02.5",
      );
      await click(button("Details & standings"));
      for (const selector of [".competition-results", ".competition-final"])
        expect(host.querySelector(selector)?.textContent).toContain(
          "squares unavailable · 2 moves · 0:02.5",
        );
    },
  );

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
    await click(button("Details & standings"));
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
    await click(button("Details & standings"));
    expect(host.textContent).toContain("Live standings are hidden");
  });

  it("pages public standings by twenty and renders rank and best result", async () => {
    standings.hasMore = true;
    standings.standings = [
      {
        username: "fast_player",
        moves: 2,
        squares: 3,
        elapsedMs: 2500,
        achievedAt: NOW,
        rank: 1,
      },
    ];
    await mount();
    await click(button("Details & standings"));
    expect(host.textContent).toContain("u/fast_player");
    expect(host.textContent).toContain("3 squares · 2 moves · 0:02.5");
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
        squares: 4,
        elapsedMs: 1234,
        dailyWins: 1,
        weeklyWins: 0,
      },
    };
    await mount();
    expect(host.textContent).not.toContain("Latest finalized result");
    await click(button("Details & standings"));
    expect(host.textContent).toContain("Latest finalized result");
    expect(host.textContent).toContain("Period ended 27 Sept 2026, 00:00 GMT");
    expect(host.textContent).toContain("u/winner");
    expect(host.textContent).toContain("4 squares · 2 moves · 0:01.2");
    expect(host.textContent).not.toMatch(/yesterday/i);
  });
});

function recordJourneys() {
  const journeys = createJourneyController({ storage: null });
  journeys.ready("post", "player");
  return {
    journeys,
    begin: vi.spyOn(journeys, "begin"),
    observe: vi.spyOn(journeys, "observe"),
    end: vi.spyOn(journeys, "end"),
    pause: vi.spyOn(journeys, "pause"),
  };
}
async function pollChallenge() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(15_000);
  });
}

describe("competition Journey wiring", () => {
  it("never starts from passive initial state but starts on committed Start", async () => {
    const tracker = recordJourneys();
    await mount("daily", "player", tracker.journeys);
    expect(tracker.begin).not.toHaveBeenCalled();
    await click(button("Start challenge"));
    expect(tracker.begin).toHaveBeenCalledOnce();
    expect(tracker.begin).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "competition", attemptId: "attempt-1" }),
      "new",
      undefined,
    );
  });

  it("only resumes an existing attempt from explicit challenge entry", async () => {
    state.snapshot = { ...fresh(), placements: [8], revision: 2 };
    const tracker = recordJourneys();
    await mount("daily", "player", tracker.journeys);
    expect(tracker.begin).not.toHaveBeenCalled();
    await act(async () => root.unmount());
    root = createRoot(host);
    await mount("daily", "player", tracker.journeys, true);
    expect(tracker.begin).toHaveBeenCalledOnce();
    expect(tracker.begin).toHaveBeenCalledWith(
      expect.objectContaining({ attemptId: "attempt-1" }),
      "resume",
      expect.objectContaining({ moves: 1 }),
    );
  });

  it("Back pauses without an abandonment request or incomplete End", async () => {
    const tracker = recordJourneys();
    await mount("weekly", "player", tracker.journeys);
    await click(button("Start challenge"));
    await click(button("Back to Euclid"));
    expect(tracker.pause).toHaveBeenCalledOnce();
    expect(tracker.end).not.toHaveBeenCalled();
    expect(requests.some((r) => r.url.endsWith("/abandon"))).toBe(false);
  });

  it("ends a successfully abandoned attempt with its exact command proof", async () => {
    const tracker = recordJourneys();
    await mount("daily", "player", tracker.journeys);
    await click(button("Start challenge"));
    await click(button("Abandon Challenge"));
    const request = requests.find((r) => r.url.endsWith("/abandon"))!;
    expect(tracker.end).toHaveBeenCalledWith(
      "abandoned",
      expect.objectContaining({
        commandId: request.body!.commandId,
        expectedRevision: request.body!.expectedRevision,
      }),
    );
    expect(leave).toHaveBeenCalledOnce();
  });

  it("recovers a committed abandonment reply once without inventing completion", async () => {
    const tracker = recordJourneys();
    await mount("daily", "player", tracker.journeys);
    await click(button("Start challenge"));
    loseAbandonReply = true;
    await click(button("Abandon Challenge"));
    expect(tracker.end).toHaveBeenCalledOnce();
    expect(tracker.end.mock.calls[0]![0]).toBe("abandoned");
    expect(tracker.begin).toHaveBeenCalledOnce();
  });

  it("starts a retry only when a new canonical attempt replaces the old one", async () => {
    const tracker = recordJourneys();
    await mount("daily", "player", tracker.journeys);
    await click(button("Start challenge"));
    failRetry = true;
    await click(button("Retry same puzzle"));
    expect(tracker.begin).toHaveBeenCalledOnce();
    expect(tracker.end).not.toHaveBeenCalled();
    failRetry = false;
    await click(button("Retry same puzzle"));
    expect(tracker.end).toHaveBeenCalledOnce();
    expect(tracker.end.mock.calls[0]![0]).toBe("retry");
    expect(tracker.begin).toHaveBeenCalledTimes(2);
    expect(tracker.journeys.activeActivity()).toMatchObject({
      attemptId: "attempt-2",
    });
  });

  it("preserves an active Journey while a challenge is temporarily disabled", async () => {
    const tracker = recordJourneys();
    await mount("daily", "player", tracker.journeys);
    await click(button("Start challenge"));
    const before = structuredClone(state);
    state = {
      ...state,
      snapshot: null,
      competition: {
        ...state.competition,
        enabled: false,
        status: "disabled",
        instanceId: null,
      },
    };
    await pollChallenge();
    expect(tracker.end).not.toHaveBeenCalled();
    state = before;
    await pollChallenge();
    expect(tracker.end).not.toHaveBeenCalled();
    expect(tracker.begin).toHaveBeenCalledOnce();
  });

  it("observes another tab's completed attempt at the deadline before unavailable handling", async () => {
    const tracker = recordJourneys();
    await mount("daily", "player", tracker.journeys);
    await click(button("Start challenge"));
    state.snapshot = {
      ...fresh(),
      complete: true,
      completedSquares: ["square"],
      finishedAt: state.competition.endsAt - 1,
    };
    state.serverNow = state.competition.endsAt + 1;
    await pollChallenge();
    expect(tracker.end).not.toHaveBeenCalledWith("unavailable");
    expect(tracker.observe).toHaveBeenCalledWith(
      expect.objectContaining({ terminal: true }),
    );
  });

  it.each(["retry", "unavailable"] as const)(
    "ends a hidden attempt as %s when a different attempt becomes visible",
    async (reason) => {
      const tracker = recordJourneys();
      await mount("daily", "player", tracker.journeys);
      await click(button("Start challenge"));
      const before = structuredClone(state);
      state = {
        ...state,
        snapshot: null,
        competition: {
          ...state.competition,
          enabled: false,
          status: "disabled",
          instanceId: null,
        },
      };
      await pollChallenge();
      expect(tracker.end).not.toHaveBeenCalled();
      state = {
        ...before,
        snapshot: { ...fresh(), attemptId: "replacement-attempt" },
        competition: {
          ...before.competition,
          instanceId: reason === "retry" ? "daily-1" : "daily-2",
        },
      };
      await pollChallenge();
      expect(tracker.end).toHaveBeenCalledOnce();
      expect(tracker.end).toHaveBeenCalledWith(reason);
      expect(tracker.begin).toHaveBeenCalledOnce();
    },
  );

  it("ends the previous attempt if another tab retries without passively starting the replacement", async () => {
    const tracker = recordJourneys();
    await mount("daily", "player", tracker.journeys);
    await click(button("Start challenge"));
    state.snapshot = { ...fresh(), attemptId: "other-tab-attempt" };
    await pollChallenge();
    expect(tracker.end).toHaveBeenCalledWith("retry");
    expect(tracker.begin).toHaveBeenCalledOnce();
  });
});
