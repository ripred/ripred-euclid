import type {
  ChallengeCommand,
  ChallengeResponse,
  ChallengeSnapshot,
} from "../shared/challenge";

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
  const response = await fetch(`/api/challenge-lab/${action}`, {
    ...(body === undefined
      ? {}
      : {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }),
    ...(signal ? { signal } : {}),
  });
  const payload = (await response.json()) as ChallengeResponse & {
    message?: string;
  };
  if (!response.ok)
    throw new Error(payload.message ?? "The playground request failed.");
  if (!("snapshot" in payload))
    throw new Error("The playground response was incomplete.");
  return payload.snapshot;
}
