import {
  hasOnlyKeys,
  isCanonicalIdentifier,
  isCount,
  isRecord,
} from "./guards";
import type { CanonicalBoardSnapshot, H2HCanonicalState } from "./types/api";

export const JOURNEYS_ACTIVITY_HEADER = "x-euclid-activity";
export const JOURNEYS_INTERACTION_LIMIT = 32;
export const JOURNEYS_REQUEST_TIMEOUT_MS = 2_000;

/** Private routing context. Never copy identifiers into analytics metadata. */
export type JourneyActivityRef =
  | { kind: "solo"; gameId: string }
  | { kind: "h2h-queue" }
  | {
      kind: "h2h";
      gameId: string;
      roundStartRevision: number | null;
      terminalRevision?: number;
    }
  | {
      kind: "competition";
      period: "daily" | "weekly";
      instanceId: string;
      attemptId: string;
    };

export const JOURNEY_END_REASONS = [
  "completed",
  "abandoned",
  "canceled",
  "retry",
  "unavailable",
] as const;
export type JourneyEndReason = (typeof JOURNEY_END_REASONS)[number];
export type JourneyRequestContext = {
  documentId: string;
  segmentId?: string;
  activity?: JourneyActivityRef;
  endReason?: JourneyEndReason;
  commandId?: string;
  expectedRevision?: number;
};

export const JOURNEY_MILESTONES = {
  quarter: 0.25,
  half: 0.5,
  three_quarters: 0.75,
  completed: 1,
} as const;
export type JourneyMilestone = keyof typeof JOURNEY_MILESTONES;

/** Deliberately finite: arbitrary user text and identifiers are never details. */
export const JOURNEY_INTERACTIONS = {
  match_found: ["achieved"],
  first_move: ["achieved"],
  first_square: ["achieved"],
  entry: ["new", "resume", "rematch", "retry"],
  tutorial: ["shown", "completed"],
  rules: ["opened"],
  sound: ["on", "off"],
  assistance: ["on", "off", "auto_move"],
  chat: ["opened", "sent"],
  standings: ["opened"],
  pause: ["left_view"],
  exit: JOURNEY_END_REASONS,
} as const;
export type JourneyInteraction = keyof typeof JOURNEY_INTERACTIONS;
export type JourneyInteractionDetail =
  (typeof JOURNEY_INTERACTIONS)[JourneyInteraction][number];

const id = (value: unknown): value is string =>
  isCanonicalIdentifier(value) &&
  [...value].every(
    (character) =>
      character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127,
  );

export function journeyBoardProgress(
  board: Pick<CanonicalBoardSnapshot, "m_players" | "winScore">,
): number {
  return Math.min(
    1,
    Math.max(...board.m_players.map((player) => player.m_score)) /
      board.winScore,
  );
}

export function h2hJourneyCompletedForPlayer(
  state: Pick<H2HCanonicalState, "ended" | "endedReason" | "victorSide">,
  playerIndex: 0 | 1,
): boolean {
  return (
    state.ended &&
    (state.endedReason === "game_over" ||
      state.endedReason === "tie" ||
      (state.endedReason === "player_left" &&
        state.victorSide === playerIndex + 1))
  );
}

export function parseJourneyActivity(
  value: unknown,
): JourneyActivityRef | null {
  if (!isRecord(value)) return null;
  switch (value.kind) {
    case "solo":
      return hasOnlyKeys(value, ["kind", "gameId"]) && id(value.gameId)
        ? { kind: "solo", gameId: value.gameId }
        : null;
    case "h2h-queue":
      return hasOnlyKeys(value, ["kind"]) ? { kind: "h2h-queue" } : null;
    case "h2h":
      return hasOnlyKeys(value, [
        "kind",
        "gameId",
        "roundStartRevision",
        "terminalRevision",
      ]) &&
        id(value.gameId) &&
        (value.roundStartRevision === null ||
          isCount(value.roundStartRevision)) &&
        (value.terminalRevision === undefined ||
          isCount(value.terminalRevision))
        ? {
            kind: "h2h",
            gameId: value.gameId,
            roundStartRevision: value.roundStartRevision as number | null,
            ...(value.terminalRevision === undefined
              ? {}
              : { terminalRevision: value.terminalRevision }),
          }
        : null;
    case "competition":
      return hasOnlyKeys(value, [
        "kind",
        "period",
        "instanceId",
        "attemptId",
      ]) &&
        (value.period === "daily" || value.period === "weekly") &&
        id(value.instanceId) &&
        id(value.attemptId)
        ? {
            kind: "competition",
            period: value.period,
            instanceId: value.instanceId,
            attemptId: value.attemptId,
          }
        : null;
    default:
      return null;
  }
}

export function parseJourneyRequestContext(
  value: unknown,
): JourneyRequestContext | null {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, [
      "documentId",
      "segmentId",
      "activity",
      "endReason",
      "commandId",
      "expectedRevision",
    ]) ||
    !id(value.documentId)
  )
    return null;
  const activity =
    value.activity === undefined
      ? undefined
      : parseJourneyActivity(value.activity);
  if (
    activity === null ||
    (value.segmentId !== undefined && !id(value.segmentId)) ||
    (activity !== undefined && value.segmentId === undefined) ||
    (activity === undefined && value.segmentId !== undefined) ||
    (value.endReason !== undefined &&
      !(JOURNEY_END_REASONS as readonly unknown[]).includes(value.endReason)) ||
    (value.expectedRevision !== undefined &&
      !isCount(value.expectedRevision)) ||
    (value.commandId !== undefined && !id(value.commandId))
  )
    return null;
  return {
    documentId: value.documentId,
    ...(activity ? { activity, segmentId: value.segmentId as string } : {}),
    ...(value.endReason === undefined
      ? {}
      : { endReason: value.endReason as JourneyEndReason }),
    ...(value.commandId === undefined
      ? {}
      : { commandId: value.commandId as string }),
    ...(value.expectedRevision === undefined
      ? {}
      : { expectedRevision: value.expectedRevision as number }),
  };
}

export function isJourneyMilestone(value: unknown): value is JourneyMilestone {
  return typeof value === "string" && Object.hasOwn(JOURNEY_MILESTONES, value);
}

export function isJourneyInteraction(
  action: unknown,
  details: unknown,
): action is JourneyInteraction {
  return (
    typeof action === "string" &&
    Object.hasOwn(JOURNEY_INTERACTIONS, action) &&
    typeof details === "string" &&
    (
      JOURNEY_INTERACTIONS[action as JourneyInteraction] as readonly string[]
    ).includes(details)
  );
}

export function journeyActivityKey(activity: JourneyActivityRef): string {
  switch (activity.kind) {
    case "solo":
      return `solo:${activity.gameId}`;
    case "h2h-queue":
      return "h2h-queue";
    case "h2h":
      return `h2h:${activity.gameId}:${activity.roundStartRevision ?? "legacy"}`;
    case "competition":
      return `competition:${activity.period}:${activity.instanceId}:${activity.attemptId}`;
  }
}
