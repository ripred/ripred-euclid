import {
  readChallengeSpotlights,
  spotlightsFor,
  type ChallengeSpotlights,
} from "../shared/challenge-spotlights";
import type { RedisCasClient } from "./redis-cas";
import { parseJson } from "./stored-json";
import { readSubredditSettings } from "./subreddit-settings";

/** Where finalized daily and weekly winners are kept once challenges run. */
export const CHALLENGE_RESULTS_KEY = "euclid:challenge-results:v1";

/** Winners of the challenges this subreddit has switched on, and no others. */
export async function publicChallengeSpotlights(
  redis: RedisCasClient,
): Promise<ChallengeSpotlights> {
  const [stored, settings] = await Promise.all([
    redis.get(CHALLENGE_RESULTS_KEY),
    readSubredditSettings(redis),
  ]);
  return spotlightsFor(readChallengeSpotlights(parseJson(stored)), settings);
}
