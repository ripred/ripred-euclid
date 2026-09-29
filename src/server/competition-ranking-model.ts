import {
  completedChallengeSquares,
  readChallengeSnapshot,
} from "../shared/challenge";
import { isCount } from "../shared/guards";
import {
  readStoredCompetitionResult,
  type StoredCompetitionResult,
} from "./competition-model";
import { parseJson } from "./stored-json";

export const competitionAttemptKey = (id: string, userId: string) =>
  `euclid:competition:attempt:${id}:${encodeURIComponent(userId)}`;
export const competitionAttemptHistoryKey = (
  id: string,
  userId: string,
  attemptId: string,
) =>
  `euclid:competition:attempt-history:${id}:${encodeURIComponent(userId)}:${encodeURIComponent(attemptId)}`;
export const competitionBestKey = (id: string, userId: string) =>
  `euclid:competition:best:${id}:${encodeURIComponent(userId)}`;
export const competitionLeaderboardKey = (id: string) =>
  `euclid:competition:leaderboard:v2:${id}`;
export const legacyCompetitionLeaderboardKey = (id: string) =>
  `euclid:competition:leaderboard:${id}`;

const pad = (value: number) => String(value).padStart(16, "0");
const UNKNOWN_SQUARES = "9999999999999999";

/** A separate v2 index keeps old move/time members out of the new ordering. */
export function competitionRankMember(
  result: Omit<StoredCompetitionResult, "member">,
): string {
  return [
    isCount(result.squares)
      ? pad(Number.MAX_SAFE_INTEGER - result.squares)
      : UNKNOWN_SQUARES,
    pad(result.moves),
    pad(result.elapsedMs),
    pad(result.order),
    JSON.stringify({
      userId: result.userId,
      username: result.username,
      achievedAt: result.achievedAt,
    }),
  ].join(":");
}

export function withCompetitionRankMember(
  result: StoredCompetitionResult,
): StoredCompetitionResult {
  return { ...result, member: competitionRankMember(result) };
}

export function readCompetitionRankMember(
  member: string,
  version: 1 | 2 = 2,
): StoredCompetitionResult | null {
  const fields = member.split(":"),
    numericFields = version === 1 ? 3 : 4;
  if (
    fields.length <= numericFields ||
    !fields.slice(0, numericFields).every((field) => /^\d+$/.test(field))
  )
    return null;
  const details = parseJson(fields.slice(numericFields).join(":"));
  if (!details || typeof details !== "object" || Array.isArray(details))
    return null;
  return readStoredCompetitionResult(
    JSON.stringify({
      ...details,
      moves: Number(fields[version === 1 ? 0 : 1]),
      squares:
        version === 1 || fields[0] === UNKNOWN_SQUARES
          ? null
          : Number.MAX_SAFE_INTEGER - Number(fields[0]),
      elapsedMs: Number(fields[version === 1 ? 1 : 2]),
      order: Number(fields[version === 1 ? 2 : 3]),
      member,
    }),
  );
}

/** Recover only from the same accepted completed attempt, never the target or an unrelated retry. */
export function recoverCompetitionSquares(
  result: StoredCompetitionResult,
  instanceId: string,
  raw: string | null | undefined,
): StoredCompetitionResult {
  if (isCount(result.squares)) return result;
  const snapshot = readChallengeSnapshot(parseJson(raw));
  if (
    !snapshot?.complete ||
    snapshot.puzzleId !== instanceId ||
    (result.attemptId !== undefined &&
      snapshot.attemptId !== result.attemptId) ||
    snapshot.placements.length !== result.moves ||
    snapshot.elapsedMs !== result.elapsedMs ||
    snapshot.finishedAt !== result.achievedAt
  )
    return { ...result, squares: null };
  const squares = completedChallengeSquares(
    snapshot.puzzle,
    snapshot.placements,
  );
  if (squares.length < snapshot.puzzle.targetSquares)
    return { ...result, squares: null };
  return { ...result, squares: squares.length, attemptId: snapshot.attemptId };
}
