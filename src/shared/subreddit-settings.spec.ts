import { describe, expect, it } from "vitest";
import {
  DEFAULT_SUBREDDIT_SETTINGS,
  validateSubredditSettings,
} from "./subreddit-settings";

describe("Tide subreddit setting", () => {
  it("defaults an omitted Tide setting to Standard without changing challenge choices", () => {
    expect(
      validateSubredditSettings({
        dailyChallenges: true,
        weeklyChallenges: false,
        challengeApplyTiming: "next-start",
        showLiveChallengeStandings: true,
      }),
    ).toEqual({
      ...DEFAULT_SUBREDDIT_SETTINGS,
      dailyChallenges: true,
      tideMode: false,
    });
  });
  it("retains the moderator's Tide selection", () => {
    const settings = { ...DEFAULT_SUBREDDIT_SETTINGS, tideMode: true };
    expect(validateSubredditSettings(settings)).toEqual(settings);
  });
  it.each(["true", 1, null, {}])(
    "rejects a malformed Tide flag: %j",
    (tideMode) => {
      expect(
        validateSubredditSettings({ ...DEFAULT_SUBREDDIT_SETTINGS, tideMode }),
      ).toBeNull();
    },
  );
});
