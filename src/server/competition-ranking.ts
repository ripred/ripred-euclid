import { ChallengeError } from "../shared/challenge";
import {
  COMPETITION_DETAILS_TTL,
  competitionInstanceKey,
  readCompetitionInstance,
  readStoredCompetitionResult,
  type StoredCompetitionResult,
} from "./competition-model";
import {
  competitionAttemptHistoryKey,
  competitionAttemptKey,
  competitionBestKey,
  competitionLeaderboardKey,
  legacyCompetitionLeaderboardKey,
  readCompetitionRankMember,
  recoverCompetitionSquares,
  withCompetitionRankMember,
} from "./competition-ranking-model";
import {
  competitionRedisCas,
  type CompetitionRedisClient,
  type CompetitionWrite,
} from "./competition-redis";

const PAGE_SIZE = 50;
const MAX_PAGES_PER_REQUEST = 4;

/**
 * Build a separate index before publishing the new order. The legacy index stays
 * intact, and every page shares the instance CAS used by accepted completions.
 */
export async function ensureCompetitionRanking(
  redis: CompetitionRedisClient,
  id: string,
  now: number,
): Promise<void> {
  const instanceKey = competitionInstanceKey(id),
    legacyKey = legacyCompetitionLeaderboardKey(id),
    leaderboardKey = competitionLeaderboardKey(id);
  for (let page = 0; page < MAX_PAGES_PER_REQUEST; page++) {
    // Read before ZRANGE: legacy result writes also change this exact instance.
    const originalRaw = await redis.get(instanceKey);
    const original = readCompetitionInstance(originalRaw);
    if (
      !original ||
      original.settled ||
      original.superseded ||
      original.rankingVersion === 2
    )
      return;
    const expiration = new Date(original.endsAt + COMPETITION_DETAILS_TTL),
      retained = expiration.getTime() > now,
      restart =
        !retained ||
        !original.rankingMigration ||
        original.rankingMigration.sourceOrder !== original.completionOrder,
      offset = restart ? 0 : original.rankingMigration!.offset;
    const entries = retained
      ? await redis.zRange(legacyKey, offset, offset + PAGE_SIZE)
      : [];
    const finished = entries.length <= PAGE_SIZE;
    const candidates = entries
      .slice(0, PAGE_SIZE)
      .map(({ member }) => readCompetitionRankMember(member, 1))
      .filter((entry): entry is StoredCompetitionResult => entry !== null);
    // The durable leader survives detail expiration and a long scheduler outage.
    if (original.leader) candidates.push(original.leader);
    const users = [...new Set(candidates.map((entry) => entry.userId))];
    const historyKeys = new Map<string, string>();
    const stringKeys = [instanceKey];
    if (retained) {
      const bests = await Promise.all(
        users.map((userId) => redis.get(competitionBestKey(id, userId))),
      );
      users.forEach((userId, index) => {
        stringKeys.push(
          competitionBestKey(id, userId),
          competitionAttemptKey(id, userId),
        );
        const attemptId =
          readStoredCompetitionResult(bests[index])?.attemptId ??
          candidates.find((entry) => entry.userId === userId && entry.attemptId)
            ?.attemptId;
        if (attemptId) {
          const historyKey = competitionAttemptHistoryKey(
            id,
            userId,
            attemptId,
          );
          historyKeys.set(userId, historyKey);
          stringKeys.push(historyKey);
        }
      });
    }
    const committed = await competitionRedisCas(
      redis,
      stringKeys,
      [legacyKey, leaderboardKey],
      (values) => {
        // Covers completion or migration writes between the first read and WATCH.
        if (values.get(instanceKey) !== originalRaw)
          return { action: "no-change", result: false };
        const instance = readCompetitionInstance(values.get(instanceKey))!;
        const writes: CompetitionWrite[] = [];
        if (restart) writes.push({ action: "delete", key: leaderboardKey });
        let leader = restart ? null : instance.rankingMigration!.leader;
        const migrated = new Map<string, StoredCompetitionResult>();
        const bestWrites = new Map<string, CompetitionWrite>();
        for (const candidate of candidates) {
          const bestKey = competitionBestKey(id, candidate.userId);
          const storedResult = retained
            ? readStoredCompetitionResult(values.get(bestKey))
            : null;
          const stored =
            storedResult?.userId === candidate.userId ? storedResult : null;
          // An obsolete index member must not restore a superseded personal best.
          if (
            stored &&
            stored.member !== candidate.member &&
            candidate !== original.leader
          )
            continue;
          let result = stored ?? candidate;
          if (retained) {
            result = recoverCompetitionSquares(
              result,
              id,
              values.get(competitionAttemptKey(id, result.userId)),
            );
            const historyKey = historyKeys.get(result.userId);
            if (historyKey)
              result = recoverCompetitionSquares(
                result,
                id,
                values.get(historyKey),
              );
            if (
              stored &&
              (stored.squares !== result.squares ||
                stored.attemptId !== result.attemptId)
            )
              bestWrites.set(bestKey, {
                action: "set",
                key: bestKey,
                // Keep its original member until the complete index is published.
                value: JSON.stringify(result),
                expiration,
              });
          }
          const ranked = withCompetitionRankMember({
            ...result,
            squares: result.squares ?? null,
          });
          migrated.set(ranked.member, ranked);
          if (!leader || ranked.member < leader.member) leader = ranked;
        }
        writes.push(...bestWrites.values());
        if (retained && migrated.size) {
          for (const member of migrated.keys())
            writes.push({
              action: "z-add",
              key: leaderboardKey,
              member,
              score: 0,
            });
          writes.push({
            action: "expire",
            key: leaderboardKey,
            seconds: Math.max(
              1,
              Math.ceil((expiration.getTime() - now) / 1000),
            ),
          });
        }
        if (finished) {
          instance.rankingVersion = 2;
          instance.leader = leader;
          delete instance.rankingMigration;
        } else {
          instance.rankingMigration = {
            offset: offset + PAGE_SIZE,
            sourceOrder: instance.completionOrder,
            leader,
          };
        }
        // Unsettled instances deliberately have no TTL; settlement assigns it.
        writes.push({
          action: "set",
          key: instanceKey,
          value: JSON.stringify(instance),
        });
        return { action: "commit", writes, result: true };
      },
    );
    if (committed && finished) return;
  }
  throw new ChallengeError(
    "unavailable",
    "Challenge standings are being updated. Please try again.",
  );
}
