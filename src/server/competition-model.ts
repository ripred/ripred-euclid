import { DEFAULT_CHALLENGE_OPTIONS } from "../shared/challenge";
import { byPeriod, type ChallengePeriod } from "../shared/challenge-spotlights";
import type {
  CompetitionResult,
  CompetitionTemplateVersion,
} from "../shared/competitions";
import type { CertifiedChallenge } from "./challenge-generator";
import { isCount, isNonBlankString, isRecord } from "../shared/guards";
import { parseJson } from "./stored-json";

export const COMPETITION_STATE_KEY = "euclid:competitions:v1";
export const COMPETITION_DETAILS_TTL = 90 * 24 * 60 * 60 * 1000;
export const COMPETITION_LEASE_MS = 60_000;
export interface CompetitionGeneration {
  target: string;
  attempts: number;
  token: string;
  leaseUntil: number;
  error: string | null;
}
export interface CompetitionConfig {
  active: CompetitionTemplateVersion;
  pending: CompetitionTemplateVersion | null;
  revision: number;
  currentId: string | null;
  latestSummaryId?: string | null;
  preparedId: string | null;
  /** First enabled start. Null means it has never been enabled. */
  activationAt: number | null;
  generation: CompetitionGeneration | null;
  preparationGeneration?: CompetitionGeneration | null;
  generationError: string | null;
}
export interface CompetitionLifecycleState {
  version: 1;
  periods: Record<ChallengePeriod, CompetitionConfig>;
  settlementQueue: { id: string; endsAt: number }[];
}
export interface StoredCompetitionResult extends CompetitionResult {
  userId: string;
  /** Identifies the canonical completed snapshot for future result recovery. */
  attemptId?: string;
  order: number;
  member: string;
}
export interface CompetitionInstance {
  id: string;
  /** Explicitly marked sample data created for moderator validation. */
  preview?: boolean;
  period: ChallengePeriod;
  opensAt: number;
  endsAt: number;
  templateRevision: number;
  certified: CertifiedChallenge;
  superseded: boolean;
  settled: boolean;
  completionOrder: number;
  leader: StoredCompetitionResult | null;
  rankingVersion?: 2;
  rankingMigration?: {
    offset: number;
    sourceOrder: number;
    leader: StoredCompetitionResult | null;
  };
}
export const competitionInstanceKey = (id: string) =>
  `euclid:competition:instance:${id}`;
export const competitionSummaryKey = (id: string) =>
  `euclid:competition:summary:${id}`;
export const competitionWinsKey = (userId: string) =>
  `euclid:competition:wins:${encodeURIComponent(userId)}`;
export function competitionWindow(
  period: ChallengePeriod,
  now: number,
): { opensAt: number; endsAt: number } {
  const date = new Date(now);
  date.setUTCHours(0, 0, 0, 0);
  if (period === "weekly")
    date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
  const opensAt = date.getTime();
  return {
    opensAt,
    endsAt: opensAt + (period === "daily" ? 1 : 7) * 86_400_000,
  };
}
/** A player's stored best result, or null when it cannot be read. */
export function readStoredCompetitionResult(
  raw: string | null | undefined,
): StoredCompetitionResult | null {
  const value = parseJson(raw);
  return isRecord(value) &&
    isNonBlankString(value.username) &&
    isNonBlankString(value.userId) &&
    typeof value.member === "string" &&
    (value.attemptId === undefined || isNonBlankString(value.attemptId)) &&
    (value.squares === undefined ||
      value.squares === null ||
      isCount(value.squares)) &&
    [value.moves, value.elapsedMs, value.achievedAt, value.order].every(isCount)
    ? (value as unknown as StoredCompetitionResult)
    : null;
}
export function readCompetitionState(
  raw: string | null | undefined,
): CompetitionLifecycleState {
  const stored = parseJson(raw);
  if (
    stored &&
    typeof stored === "object" &&
    "version" in stored &&
    stored.version === 1
  )
    return stored as CompetitionLifecycleState;
  return {
    version: 1,
    settlementQueue: [],
    periods: byPeriod((period) => ({
      active: {
        revision: 0,
        options: {
          ...DEFAULT_CHALLENGE_OPTIONS,
          minimumMoves: period === "daily" ? 2 : 3,
          targetSquares: period === "daily" ? 3 : 4,
          geometry: period === "daily" ? "mixed" : "oblique",
          blockedPoints: [],
        },
        effectiveAt: 0,
        savedAt: 0,
      },
      pending: null,
      revision: 0,
      currentId: null,
      latestSummaryId: null,
      preparedId: null,
      activationAt: null,
      generation: null,
      generationError: null,
    })),
  };
}
export function readCompetitionInstance(
  raw: string | null | undefined,
): CompetitionInstance | null {
  return (parseJson(raw) as CompetitionInstance | null) ?? null;
}
