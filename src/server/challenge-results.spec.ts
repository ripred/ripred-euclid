import { describe, expect, it } from "vitest";
import {
  EMPTY_CHALLENGE_SPOTLIGHTS,
  readChallengeSpotlights,
  type ChallengeSpotlights,
} from "../shared/challenge-spotlights";
import {
  CHALLENGE_RESULTS_KEY,
  publicChallengeSpotlights,
} from "./challenge-results";
import { SUBREDDIT_SETTINGS_KEY } from "./subreddit-settings";
import { MemoryRedis } from "./testing/memory-redis";
import { DEFAULT_SUBREDDIT_SETTINGS } from "../shared/subreddit-settings";
import { competitionInstanceKey } from "./competition-model";
import {
  competitionAttemptHistoryKey,
  competitionAttemptKey,
} from "./competition-ranking-model";
import {
  placeChallengePoint,
  type ChallengeSnapshot,
} from "../shared/challenge";

const winners: ChallengeSpotlights = {
  preview: true,
  daily: {
    username: "daily_winner",
    moves: 4,
    elapsedMs: 12000,
    dailyWins: 2,
    weeklyWins: 0,
  },
  weekly: {
    username: "weekly_winner",
    avatar: "https://example.com/avatar.png",
    moves: 8,
    elapsedMs: 34000,
    dailyWins: 1,
    weeklyWins: 3,
  },
};

describe("public challenge spotlights", () => {
  it("preserves numeric and unavailable square counts while rejecting invalid counts", () => {
    for (const squares of [4, null])
      expect(
        readChallengeSpotlights({
          ...winners,
          daily: { ...winners.daily, squares },
        }).daily?.squares,
      ).toBe(squares);
    expect(readChallengeSpotlights(winners).daily).toEqual(winners.daily);
    for (const squares of [-1, 1.5, "4"])
      expect(
        readChallengeSpotlights({
          ...winners,
          daily: { ...winners.daily, squares },
        }).daily,
      ).toBeNull();
  });

  it("recovers a published winner's square count from its matching history without rewriting the award", async () => {
    const redis = new MemoryRedis();
    const started: ChallengeSnapshot = {
      puzzleId: "day-1",
      attemptId: "winner-attempt",
      revision: 1,
      puzzle: {
        version: 1,
        size: 8,
        initial: [0, 1, 2, 3, 8, 10],
        blocked: [],
        targetSquares: 1,
        minimumMoves: 1,
      },
      placements: [],
      completedSquares: [],
      complete: false,
      bestMoves: null,
      bestElapsedMs: null,
      startedAt: 1000,
      finishedAt: null,
      elapsedMs: 0,
    };
    const completed = placeChallengePoint(started, 9, 2000);
    const winner = {
      ...winners.daily!,
      instanceId: "day-1",
      moves: 1,
      elapsedMs: 1000,
    };
    const stored = JSON.stringify({ ...winners, daily: winner });
    redis.seed(CHALLENGE_RESULTS_KEY, stored);
    redis.seed(
      SUBREDDIT_SETTINGS_KEY,
      JSON.stringify({ ...DEFAULT_SUBREDDIT_SETTINGS, dailyChallenges: true }),
    );
    redis.seed(
      competitionInstanceKey("day-1"),
      JSON.stringify({
        leader: {
          userId: "winner-id",
          username: winner.username,
          attemptId: completed.attemptId,
          moves: 1,
          elapsedMs: 1000,
          achievedAt: 2000,
          order: 1,
          member: "legacy",
        },
      }),
    );
    redis.seed(
      competitionAttemptKey("day-1", "winner-id"),
      JSON.stringify({ ...started, attemptId: "later-retry" }),
    );
    redis.seed(
      competitionAttemptHistoryKey("day-1", "winner-id", completed.attemptId),
      JSON.stringify(completed),
    );
    expect((await publicChallengeSpotlights(redis)).daily).toEqual({
      ...winner,
      squares: 2,
    });
    expect(redis.value(CHALLENGE_RESULTS_KEY)).toBe(stored);
    expect(redis.commits).toHaveLength(0);
    redis.seed(
      competitionAttemptHistoryKey("day-1", "winner-id", completed.attemptId),
      JSON.stringify({ ...completed, finishedAt: 2001 }),
    );
    expect((await publicChallengeSpotlights(redis)).daily).toEqual({
      ...winner,
      squares: null,
    });
  });
  it("retains a seeded winner label without marking the real daily winner", async () => {
    const redis = new MemoryRedis();
    const mixed = {
      ...winners,
      preview: false,
      weekly: { ...winners.weekly!, preview: true },
    };
    redis.seed(CHALLENGE_RESULTS_KEY, JSON.stringify(mixed));
    redis.seed(
      SUBREDDIT_SETTINGS_KEY,
      JSON.stringify({
        ...DEFAULT_SUBREDDIT_SETTINGS,
        dailyChallenges: true,
        weeklyChallenges: true,
      }),
    );
    expect(await publicChallengeSpotlights(redis)).toEqual(mixed);
  });
  it.each([
    { dailyChallenges: false, weeklyChallenges: false },
    { dailyChallenges: true, weeklyChallenges: false },
    { dailyChallenges: false, weeklyChallenges: true },
    { dailyChallenges: true, weeklyChallenges: true },
  ])("returns winners only for enabled challenges: %j", async (settings) => {
    const redis = new MemoryRedis();
    const stored = JSON.stringify(winners);
    redis.seed(CHALLENGE_RESULTS_KEY, stored);
    redis.seed(
      SUBREDDIT_SETTINGS_KEY,
      JSON.stringify({ ...DEFAULT_SUBREDDIT_SETTINGS, ...settings }),
    );

    expect(await publicChallengeSpotlights(redis)).toEqual({
      preview: true,
      daily: settings.dailyChallenges ? winners.daily : null,
      weekly: settings.weeklyChallenges ? winners.weekly : null,
    });
    expect(redis.value(CHALLENGE_RESULTS_KEY)).toBe(stored);
    expect(redis.commits).toHaveLength(0);

    redis.seed(
      SUBREDDIT_SETTINGS_KEY,
      JSON.stringify({
        ...DEFAULT_SUBREDDIT_SETTINGS,
        dailyChallenges: true,
        weeklyChallenges: true,
      }),
    );
    expect(await publicChallengeSpotlights(redis)).toEqual(winners);
  });

  it.each([undefined, "not json"])(
    "hides stored winners when settings are absent or unreadable: %s",
    async (settings) => {
      const redis = new MemoryRedis();
      redis.seed(CHALLENGE_RESULTS_KEY, JSON.stringify(winners));
      if (settings !== undefined) redis.seed(SUBREDDIT_SETTINGS_KEY, settings);
      expect(await publicChallengeSpotlights(redis)).toEqual({
        preview: true,
        daily: null,
        weekly: null,
      });
      expect(redis.json(CHALLENGE_RESULTS_KEY)).toEqual(winners);
      expect(redis.commits).toHaveLength(0);
    },
  );

  it("keeps enabled challenges without finalized results empty", async () => {
    const redis = new MemoryRedis();
    redis.seed(
      SUBREDDIT_SETTINGS_KEY,
      JSON.stringify({
        ...DEFAULT_SUBREDDIT_SETTINGS,
        dailyChallenges: true,
        weeklyChallenges: true,
      }),
    );
    expect(await publicChallengeSpotlights(redis)).toEqual(
      EMPTY_CHALLENGE_SPOTLIGHTS,
    );
  });
});
