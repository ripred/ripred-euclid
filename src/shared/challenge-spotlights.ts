import { isCount, isNonBlankString, isRecord } from "./guards";
import type { SubredditSettings } from "./subreddit-settings";

export const CHALLENGE_PERIODS = ["daily", "weekly"] as const;
export type ChallengePeriod = (typeof CHALLENGE_PERIODS)[number];

/** The subreddit switch that turns each challenge on. */
export const CHALLENGE_SETTING: Readonly<
  Record<ChallengePeriod, "dailyChallenges" | "weeklyChallenges">
> = { daily: "dailyChallenges", weekly: "weeklyChallenges" };

/** Finalized results only. Active attempts and solution boards stay private. */
export interface ChallengeWinner {
  username: string;
  avatar?: string;
  moves: number;
  elapsedMs: number;
  dailyWins: number;
  weeklyWins: number;
  opensAt?: number;
  endsAt?: number;
  instanceId?: string;
}

/** One value per challenge, in the order challenges are listed. */
export const byPeriod = <T>(
  read: (period: ChallengePeriod) => T,
): Record<ChallengePeriod, T> =>
  Object.fromEntries(
    CHALLENGE_PERIODS.map((period) => [period, read(period)]),
  ) as Record<ChallengePeriod, T>;

/** Each challenge's latest winner; `preview` marks local sample results. */
export type ChallengeSpotlights = { preview: boolean } & Record<
  ChallengePeriod,
  ChallengeWinner | null
>;

export const EMPTY_CHALLENGE_SPOTLIGHTS: ChallengeSpotlights = {
  preview: false,
  ...byPeriod(() => null),
};

const WINNER_COUNTS = [
  "moves",
  "elapsedMs",
  "dailyWins",
  "weeklyWins",
] as const;

function readWinner(value: unknown): ChallengeWinner | null {
  if (
    !isRecord(value) ||
    !isNonBlankString(value.username) ||
    (value.avatar !== undefined && typeof value.avatar !== "string") ||
    !WINNER_COUNTS.every((field) => isCount(value[field]))
  )
    return null;
  return {
    username: value.username,
    ...(isCount(value.opensAt) ? { opensAt: value.opensAt } : {}),
    ...(isCount(value.endsAt) ? { endsAt: value.endsAt } : {}),
    ...(typeof value.instanceId === "string"
      ? { instanceId: value.instanceId }
      : {}),
    ...(typeof value.avatar === "string" ? { avatar: value.avatar } : {}),
    ...Object.fromEntries(WINNER_COUNTS.map((field) => [field, value[field]])),
  } as ChallengeWinner;
}

/** Reads stored or fetched results; anything unreadable counts as no winner. */
export function readChallengeSpotlights(value: unknown): ChallengeSpotlights {
  if (!isRecord(value)) return EMPTY_CHALLENGE_SPOTLIGHTS;
  return {
    preview: value.preview === true,
    ...byPeriod((period) => readWinner(value[period])),
  };
}

/** Results for the challenges this subreddit has switched on. */
export function spotlightsFor(
  spotlights: ChallengeSpotlights,
  settings: SubredditSettings,
): ChallengeSpotlights {
  return {
    preview: spotlights.preview,
    ...byPeriod((period) =>
      settings[CHALLENGE_SETTING[period]] ? spotlights[period] : null,
    ),
  };
}
