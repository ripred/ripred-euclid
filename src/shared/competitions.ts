import type { ChallengeOptions, ChallengeSnapshot } from "./challenge";
import type { ChallengePeriod, ChallengeWinner } from "./challenge-spotlights";
import type { SubredditSettings } from "./subreddit-settings";

export type CompetitionTemplate = Omit<ChallengeOptions, "seed">;
export interface CompetitionTemplateVersion {
  revision: number;
  options: CompetitionTemplate;
  effectiveAt: number;
  savedAt: number;
}
export interface CompetitionTemplateState {
  activationAt?: number | null;
  active: CompetitionTemplateVersion;
  pending: CompetitionTemplateVersion | null;
  revision: number;
  generationError: string | null;
}
export interface CompetitionTemplatesResponse {
  settings: SubredditSettings;
  templates: Record<ChallengePeriod, CompetitionTemplateState>;
  serverNow: number;
}
export interface CompetitionApplyRequest {
  options: CompetitionTemplate;
  expectedRevision: number;
  commandId: string;
  /** Required acknowledgement when application timing is immediate. */
  confirmReset?: boolean;
}
export interface CompetitionResult {
  username: string;
  moves: number;
  elapsedMs: number;
  achievedAt: number;
}
export interface CompetitionStanding extends CompetitionResult {
  rank: number;
}
export interface CompetitionAvailability {
  period: ChallengePeriod;
  enabled: boolean;
  status: "disabled" | "scheduled" | "open" | "unavailable";
  instanceId: string | null;
  opensAt: number;
  endsAt: number;
  showStandings: boolean;
}
export interface CompetitionAvailabilityResponse {
  competitions: Record<ChallengePeriod, CompetitionAvailability>;
  serverNow: number;
}
export interface CompetitionStateResponse {
  authenticated?: boolean;
  latestResult?: CompetitionSummary | null;
  competition: CompetitionAvailability;
  snapshot: ChallengeSnapshot | null;
  personalBest: CompetitionResult | null;
  personalRank: number | null;
  serverNow: number;
}
export interface CompetitionCommand {
  commandId: string;
  instanceId: string;
  attemptId: string | null;
  expectedRevision: number;
}
export interface CompetitionMoveRequest extends CompetitionCommand {
  point: number;
}
export interface CompetitionStandingsResponse {
  instanceId: string | null;
  visible: boolean;
  standings: CompetitionStanding[];
  offset: number;
  hasMore: boolean;
  serverNow: number;
}
export interface CompetitionSummary {
  instanceId: string;
  period: ChallengePeriod;
  opensAt: number;
  endsAt: number;
  superseded: boolean;
  winner: ChallengeWinner | null;
}
