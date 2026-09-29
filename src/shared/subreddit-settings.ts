import { isRecord } from "./guards";

/** Subreddit-wide moderator settings. Disabled competitions are hidden. */
export interface SubredditSettings {
  tideMode: boolean;
  dailyChallenges: boolean;
  weeklyChallenges: boolean;
  challengeApplyTiming: "immediately" | "next-start";
  showLiveChallengeStandings: boolean;
}
export const DEFAULT_SUBREDDIT_SETTINGS: Readonly<SubredditSettings> =
  Object.freeze({
    tideMode: false,
    dailyChallenges: false,
    weeklyChallenges: false,
    challengeApplyTiming: "next-start",
    showLiveChallengeStandings: true,
  });

/** Validate moderator choices and supply defaults for newly added settings. */
export function validateSubredditSettings(
  value: unknown,
): SubredditSettings | null {
  if (
    !isRecord(value) ||
    Object.keys(value).some(
      (key) =>
        !Object.prototype.hasOwnProperty.call(DEFAULT_SUBREDDIT_SETTINGS, key),
    ) ||
    typeof value.dailyChallenges !== "boolean" ||
    typeof value.weeklyChallenges !== "boolean" ||
    (value.tideMode !== undefined && typeof value.tideMode !== "boolean") ||
    (value.challengeApplyTiming !== "immediately" &&
      value.challengeApplyTiming !== "next-start") ||
    typeof value.showLiveChallengeStandings !== "boolean"
  )
    return null;
  return {
    tideMode: value.tideMode ?? false,
    dailyChallenges: value.dailyChallenges,
    weeklyChallenges: value.weeklyChallenges,
    challengeApplyTiming: value.challengeApplyTiming,
    showLiveChallengeStandings: value.showLiveChallengeStandings,
  };
}
