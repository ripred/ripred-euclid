import { isRecord } from "./guards";

/** Subreddit-wide moderator settings. Disabled competitions are hidden. */
export interface SubredditSettings {
  dailyChallenges: boolean;
  weeklyChallenges: boolean;
  challengeApplyTiming: "immediately" | "next-start";
  showLiveChallengeStandings: boolean;
}
export const DEFAULT_SUBREDDIT_SETTINGS: Readonly<SubredditSettings> =
  Object.freeze({
    dailyChallenges: false,
    weeklyChallenges: false,
    challengeApplyTiming: "next-start",
    showLiveChallengeStandings: true,
  });

/** Accept legacy two-switch records without dropping their saved choices. */
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
    (value.challengeApplyTiming !== undefined &&
      value.challengeApplyTiming !== "immediately" &&
      value.challengeApplyTiming !== "next-start") ||
    (value.showLiveChallengeStandings !== undefined &&
      typeof value.showLiveChallengeStandings !== "boolean")
  )
    return null;
  return {
    dailyChallenges: value.dailyChallenges,
    weeklyChallenges: value.weeklyChallenges,
    challengeApplyTiming: value.challengeApplyTiming ?? "next-start",
    showLiveChallengeStandings: value.showLiveChallengeStandings ?? true,
  };
}
