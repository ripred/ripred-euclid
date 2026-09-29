import {
  CHALLENGE_PERIODS,
  readChallengeSpotlights,
  spotlightsFor,
  type ChallengeSpotlights,
  type ChallengeWinner,
} from "../shared/challenge-spotlights";
import type { RedisCasClient } from "./redis-cas";
import { parseJson } from "./stored-json";
import { readSubredditSettings } from "./subreddit-settings";
import {
  competitionInstanceKey,
  readCompetitionInstance,
} from "./competition-model";
import {
  competitionAttemptHistoryKey,
  competitionAttemptKey,
  recoverCompetitionSquares,
} from "./competition-ranking-model";
import { isCount } from "../shared/guards";

/** Where finalized daily and weekly winners are kept once challenges run. */
export const CHALLENGE_RESULTS_KEY = "euclid:challenge-results:v1";

/** Enrich a published award without changing its winner, rank, or win totals. */
export async function recoverChallengeWinnerSquares(
  redis: RedisCasClient,
  winner: ChallengeWinner | null,
): Promise<ChallengeWinner | null> {
  if (!winner || isCount(winner.squares) || !winner.instanceId) return winner;
  const leader = readCompetitionInstance(
    await redis.get(competitionInstanceKey(winner.instanceId)),
  )?.leader;
  if (
    !leader ||
    leader.username !== winner.username ||
    leader.moves !== winner.moves ||
    leader.elapsedMs !== winner.elapsedMs
  )
    return { ...winner, squares: null };
  const [current, history] = await Promise.all([
    redis.get(competitionAttemptKey(winner.instanceId, leader.userId)),
    leader.attemptId
      ? redis.get(
          competitionAttemptHistoryKey(
            winner.instanceId,
            leader.userId,
            leader.attemptId,
          ),
        )
      : undefined,
  ]);
  const recovered = recoverCompetitionSquares(
    recoverCompetitionSquares(leader, winner.instanceId, history),
    winner.instanceId,
    current,
  );
  return { ...winner, squares: recovered.squares ?? null };
}

/** Winners of the challenges this subreddit has switched on, and no others. */
export async function publicChallengeSpotlights(
  redis: RedisCasClient,
): Promise<ChallengeSpotlights> {
  const [stored, settings] = await Promise.all([
    redis.get(CHALLENGE_RESULTS_KEY),
    readSubredditSettings(redis),
  ]);
  const spotlights = spotlightsFor(
    readChallengeSpotlights(parseJson(stored)),
    settings,
  );
  await Promise.all(
    CHALLENGE_PERIODS.map(async (period) => {
      spotlights[period] = await recoverChallengeWinnerSquares(
        redis,
        spotlights[period],
      );
    }),
  );
  return spotlights;
}
