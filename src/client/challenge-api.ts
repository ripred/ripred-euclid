import type {
  ChallengeCommand,
  ChallengeResponse,
  ChallengeSnapshot,
} from "../shared/challenge";
import { readChallengeOptions } from "../shared/challenge";
import { byPeriod, type ChallengePeriod } from "../shared/challenge-spotlights";
import type {
  CompetitionApplyRequest,
  CompetitionTemplatesResponse,
  CompetitionTemplateVersion,
} from "../shared/competitions";
import { isCount, isRecord } from "../shared/guards";
import { validateSubredditSettings } from "../shared/subreddit-settings";
import { fetchJsonRecord } from "./fetch-json";

export function challengeCommand(
  snapshot: ChallengeSnapshot | null,
): ChallengeCommand {
  return {
    commandId: crypto.randomUUID(),
    expectedRevision: snapshot?.revision ?? 0,
    puzzleId: snapshot?.puzzleId ?? null,
    attemptId: snapshot?.attemptId ?? null,
  };
}

export async function requestChallenge(
  action: string,
  body?: unknown,
  signal?: AbortSignal,
): Promise<ChallengeSnapshot | null> {
  const payload = (await fetchJsonRecord(
    `/api/challenge-lab/${action}`,
    "The playground request failed.",
    {
      ...(body === undefined
        ? {}
        : {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          }),
      ...(signal ? { signal } : {}),
    },
  )) as unknown as ChallengeResponse | null;
  if (!payload || !("snapshot" in payload))
    throw new Error("The playground response was incomplete.");
  return payload.snapshot;
}

/** Validate the saved configuration before allowing a destructive Apply. */
export function readCompetitionTemplates(
  value: unknown,
): CompetitionTemplatesResponse {
  const incomplete = () =>
    new Error("The challenge settings response was incomplete.");
  if (
    !isRecord(value) ||
    !isRecord(value.templates) ||
    !isCount(value.serverNow)
  )
    throw incomplete();
  const settings = validateSubredditSettings(value.settings);
  if (!settings) throw incomplete();
  const templateVersion = (version: unknown): CompetitionTemplateVersion => {
    if (
      !isRecord(version) ||
      !isCount(version.revision) ||
      !isCount(version.savedAt) ||
      !isCount(version.effectiveAt)
    )
      throw incomplete();
    const options = readChallengeOptions(version.options);
    delete options.seed;
    return {
      revision: version.revision,
      savedAt: version.savedAt,
      effectiveAt: version.effectiveAt,
      options,
    };
  };
  const templates = value.templates;
  return {
    settings,
    serverNow: value.serverNow,
    templates: byPeriod((period) => {
      const state = templates[period];
      if (
        !isRecord(state) ||
        !isCount(state.revision) ||
        (state.activationAt !== undefined &&
          state.activationAt !== null &&
          !isCount(state.activationAt)) ||
        (state.generationError !== null &&
          typeof state.generationError !== "string")
      )
        throw incomplete();
      return {
        revision: state.revision,
        active: templateVersion(state.active),
        pending: state.pending === null ? null : templateVersion(state.pending),
        generationError: state.generationError,
        activationAt: state.activationAt ?? null,
      };
    }),
  };
}

export async function requestCompetitionTemplates(signal?: AbortSignal) {
  return readCompetitionTemplates(
    await fetchJsonRecord(
      "/api/competitions/templates",
      "Challenge settings could not be loaded.",
      signal ? { signal } : undefined,
    ),
  );
}

export async function applyCompetitionTemplate(
  period: ChallengePeriod,
  request: CompetitionApplyRequest,
) {
  return readCompetitionTemplates(
    await fetchJsonRecord(
      `/api/competitions/${period}/apply`,
      "Challenge settings could not be applied.",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request),
      },
    ),
  );
}
