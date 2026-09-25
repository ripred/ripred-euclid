import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RANKED_SOLO_RULES, SOLO_RULES_VERSION } from "../shared/game/rules";
import type { RankingsResponse, RankingsShareRow } from "../shared/types/api";
import { fetchRankings } from "./rankings-loader";

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => vi.unstubAllGlobals());

function response(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const row: RankingsShareRow = {
  userId: "ranked-player",
  name: "Ranked player",
  rating: 1234,
  games: 10,
  wins: 6,
  losses: 3,
  draws: 1,
};

describe("live rankings requests", () => {
  it("preserves the local fixture marker so sample results cannot be mistaken for live rankings", async () => {
    fetchMock.mockResolvedValue(response({ hvh: [row], preview: true }));
    await expect(fetchRankings()).resolves.toEqual({
      hvh: [row],
      hva: [],
      preview: true,
    });
  });
  it("retains both canonical boards, their order, and ranked rules", async () => {
    const rankings: RankingsResponse = {
      hvh: [row, { ...row, userId: "second-player", rating: 1600 }],
      hva: [row],
      hvaRules: {
        mode: "ranked",
        ranked: true,
        rulesVersion: SOLO_RULES_VERSION,
        rules: RANKED_SOLO_RULES,
      },
    };
    fetchMock.mockResolvedValue(response(rankings));

    await expect(fetchRankings()).resolves.toEqual(rankings);
  });

  it.each([{}, { hvh: [] }, { hva: [] }])(
    "normalizes omitted boards only after a successful response",
    async (payload) => {
      fetchMock.mockResolvedValue(response(payload));
      await expect(fetchRankings()).resolves.toEqual({ hvh: [], hva: [] });
    },
  );

  it("rejects an HTTP failure even if the response also contains rows", async () => {
    fetchMock.mockResolvedValue(
      response(
        { message: "Standings are temporarily unavailable.", hvh: [row] },
        503,
      ),
    );
    await expect(fetchRankings()).rejects.toThrow(
      "Standings are temporarily unavailable.",
    );
  });

  it("supplies a usable HTTP error when the failure response is not JSON", async () => {
    fetchMock.mockResolvedValue(new Response("Unavailable", { status: 502 }));
    await expect(fetchRankings()).rejects.toThrow(
      "Unable to load the leaderboard.",
    );
  });

  it.each([null, [], { hvh: "invalid" }, { hva: {} }])(
    "rejects malformed successful responses instead of displaying an empty board",
    async (payload) => {
      fetchMock.mockResolvedValue(response(payload));
      await expect(fetchRankings()).rejects.toThrow(
        "The leaderboard response could not be read. Try again.",
      );
    },
  );

  it("rejects unreadable successful JSON", async () => {
    fetchMock.mockResolvedValue(new Response("not-json"));
    await expect(fetchRankings()).rejects.toThrow(
      "The leaderboard response could not be read. Try again.",
    );
  });

  it("passes cancellation to fetch and preserves its rejection for the owner", async () => {
    const controller = new AbortController();
    const cancellation = new DOMException("Request aborted", "AbortError");
    fetchMock.mockRejectedValue(cancellation);
    const pending = fetchRankings(controller.signal);
    controller.abort();

    await expect(pending).rejects.toBe(cancellation);
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith("/api/rankings", {
      signal: controller.signal,
    });
  });

  it("allows a successful retry after a failed request", async () => {
    fetchMock
      .mockResolvedValueOnce(response({ message: "Try later" }, 503))
      .mockResolvedValueOnce(response({ hvh: [row] }));

    await expect(fetchRankings()).rejects.toThrow("Try later");
    await expect(fetchRankings()).resolves.toEqual({ hvh: [row], hva: [] });
  });
});
