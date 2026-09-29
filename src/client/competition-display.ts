import type { ChallengePeriod } from "../shared/challenge-spotlights";
import type {
  CompetitionAvailability,
  CompetitionResult,
} from "../shared/competitions";
import { formatChallengeTime } from "./challenge-time";

export const COMPETITION_RANKING_GUIDANCE =
  "Most squares wins, then fewest moves, then shortest time, then first achieved.";

/** Use the same result summary for standings, personal bests, and winners. */
export function formatCompetitionResult(
  result: Pick<CompetitionResult, "moves" | "squares" | "elapsedMs">,
): string {
  const moves = `${result.moves} ${result.moves === 1 ? "move" : "moves"}`;
  const squares =
    result.squares == null
      ? "squares unavailable"
      : `${result.squares} ${result.squares === 1 ? "square" : "squares"}`;
  return `${squares} · ${moves} · ${formatChallengeTime(result.elapsedMs)}`;
}

export function competitionLabel(period: ChallengePeriod): string {
  return period === "daily" ? "Daily challenge" : "Weekly challenge";
}

export function formatCompetitionDate(timestamp: number): string {
  return `${new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
    hourCycle: "h23",
  }).format(timestamp)} GMT`;
}

export function formatCompetitionCountdown(milliseconds: number): string {
  const seconds = Math.max(0, Math.ceil(milliseconds / 1000));
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = seconds % 60;
  return `${days ? `${days}d ` : ""}${hours}h ${String(minutes).padStart(2, "0")}m ${String(remainder).padStart(2, "0")}s`;
}

export function competitionAvailabilityText(
  competition: CompetitionAvailability,
  now: number,
): string {
  if (!competition.enabled || competition.status === "disabled")
    return "Disabled by subreddit moderators";
  if (competition.status === "unavailable")
    return "Puzzle unavailable. Please check back later.";
  if (competition.status === "scheduled")
    return `Opens in ${formatCompetitionCountdown(competition.opensAt - now)}`;
  if (now >= competition.endsAt)
    return "This period has ended. Checking the next challenge…";
  return `Closes in ${formatCompetitionCountdown(competition.endsAt - now)}`;
}
