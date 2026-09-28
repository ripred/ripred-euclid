import type { ChallengePeriod } from "../shared/challenge-spotlights";
import type {
  CompetitionAvailabilityResponse,
  CompetitionCommand,
  CompetitionStateResponse,
  CompetitionStandingsResponse,
} from "../shared/competitions";
import { isRecord } from "../shared/guards";
import { fetchJsonRecord } from "./fetch-json";

export async function requestCompetitionAvailability(
  signal?: AbortSignal,
): Promise<CompetitionAvailabilityResponse> {
  const data = await fetchJsonRecord(
    "/api/competitions/availability",
    "Could not load challenges.",
    signal ? { signal } : undefined,
  );
  if (!isRecord(data?.competitions) || typeof data.serverNow !== "number")
    throw new Error("The challenge availability response was incomplete.");
  return data as unknown as CompetitionAvailabilityResponse;
}

export async function requestCompetitionState(
  period: ChallengePeriod,
  action: "state" | "start" | "retry" | "move" | "abandon" = "state",
  body?: CompetitionCommand & { point?: number },
  signal?: AbortSignal,
): Promise<CompetitionStateResponse> {
  const data = await fetchJsonRecord(
    `/api/competitions/${period}/${action}`,
    "The challenge request failed.",
    {
      ...(body
        ? {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          }
        : {}),
      ...(signal ? { signal } : {}),
    },
  );
  if (
    !isRecord(data?.competition) ||
    typeof data.serverNow !== "number" ||
    !("snapshot" in data)
  )
    throw new Error("The challenge response was incomplete.");
  return data as unknown as CompetitionStateResponse;
}

export async function requestCompetitionStandings(
  period: ChallengePeriod,
  offset: number,
  signal?: AbortSignal,
): Promise<CompetitionStandingsResponse> {
  const data = await fetchJsonRecord(
    `/api/competitions/${period}/standings?offset=${offset}`,
    "Could not load challenge standings.",
    signal ? { signal } : undefined,
  );
  if (
    !data ||
    !Array.isArray(data.standings) ||
    typeof data.visible !== "boolean"
  )
    throw new Error("The standings response was incomplete.");
  return data as unknown as CompetitionStandingsResponse;
}

export function competitionCommand(
  state: CompetitionStateResponse,
  action: "start" | "retry" | "move" | "abandon",
): CompetitionCommand {
  if (!state.competition.instanceId)
    throw new Error("This challenge is not open.");
  return {
    commandId: crypto.randomUUID(),
    instanceId: state.competition.instanceId,
    attemptId: action === "start" ? null : (state.snapshot?.attemptId ?? null),
    expectedRevision: action === "start" ? 0 : (state.snapshot?.revision ?? 0),
  };
}
