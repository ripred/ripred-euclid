import { describe, expect, it } from "vitest";
import {
  parseJourneyActivity,
  parseJourneyRequestContext,
  journeyActivityKey,
  isJourneyMilestone,
  isJourneyInteraction,
  journeyBoardProgress,
  h2hJourneyCompletedForPlayer,
  type JourneyActivityRef,
} from "./journeys";
import type { CanonicalBoardSnapshot, H2HCanonicalState } from "./types/api";

describe("private Journey correlation and finite metadata", () => {
  it.each<JourneyActivityRef>([
    { kind: "solo", gameId: "game" },
    { kind: "h2h-queue" },
    { kind: "h2h", gameId: "game", roundStartRevision: 0 },
    {
      kind: "h2h",
      gameId: "game",
      roundStartRevision: null,
      terminalRevision: 15,
    },
    {
      kind: "competition",
      period: "weekly",
      instanceId: "week",
      attemptId: "attempt",
    },
  ])("round-trips only supported activity refs: %j", (activity) => {
    expect(parseJourneyActivity(activity)).toEqual(activity);
    expect(
      parseJourneyRequestContext({
        documentId: "doc",
        segmentId: "segment",
        activity,
      }),
    ).toEqual({ documentId: "doc", segmentId: "segment", activity });
  });
  it.each([
    null,
    [],
    { kind: "lab", puzzleId: "p", attemptId: "a" },
    { kind: "solo", gameId: "game", score: 99 },
    { kind: "solo", gameId: "\nprivate" },
    { kind: "solo", gameId: "x".repeat(257) },
    { kind: "h2h", gameId: "game" },
    { kind: "h2h", gameId: "game", roundStartRevision: -1 },
    {
      kind: "h2h",
      gameId: "game",
      roundStartRevision: 0,
      terminalRevision: Infinity,
    },
    { kind: "competition", period: "monthly", instanceId: "i", attemptId: "a" },
  ])("rejects malformed, unbounded, or extra activity data: %j", (activity) => {
    expect(parseJourneyActivity(activity)).toBeNull();
  });
  it("uses document-only readiness and rejects injected context keys", () => {
    expect(parseJourneyRequestContext({ documentId: "doc" })).toEqual({
      documentId: "doc",
    });
    for (const bad of [
      { documentId: "doc", activity: { kind: "h2h-queue" } },
      { documentId: "doc", segmentId: "segment" },
      { documentId: "doc", username: "person" },
      { documentId: "doc", endReason: "left_view" },
      { documentId: "doc", expectedRevision: -1 },
    ])
      expect(parseJourneyRequestContext(bad)).toBeNull();
  });
  it("preserves a complete private abandon proof and rejects full gameplay commands", () => {
    const context = {
      documentId: "document",
      segmentId: "segment",
      activity: {
        kind: "competition",
        period: "daily",
        instanceId: "instance",
        attemptId: "attempt",
      },
      endReason: "abandoned",
      commandId: "abandon-command",
      expectedRevision: 0,
    } as const;
    expect(parseJourneyRequestContext(context)).toEqual(context);
    expect(
      parseJourneyRequestContext({
        ...context,
        instanceId: "instance",
        attemptId: "attempt",
      }),
    ).toBeNull();
    expect(
      parseJourneyRequestContext({
        ...context,
        commandId: "command\u0000injected",
      }),
    ).toBeNull();
    expect(
      parseJourneyRequestContext({
        ...context,
        expectedRevision: Number.MAX_SAFE_INTEGER + 1,
      }),
    ).toBeNull();
  });
  it.each([
    "a\u0000b",
    "a\tb",
    "a\nb",
    "a\rb",
    "a\u001fb",
    "a\u007fb",
    " leading",
    "trailing ",
    "",
    "x".repeat(257),
  ])(
    "rejects invalid identifiers in every private context position: %j",
    (invalid) => {
      const context = {
        documentId: "doc",
        segmentId: "segment",
        activity: { kind: "solo", gameId: "game" },
      };
      expect(
        parseJourneyRequestContext({ ...context, documentId: invalid }),
      ).toBeNull();
      expect(
        parseJourneyRequestContext({ ...context, segmentId: invalid }),
      ).toBeNull();
      expect(
        parseJourneyRequestContext({ ...context, commandId: invalid }),
      ).toBeNull();
      expect(
        parseJourneyActivity({ kind: "solo", gameId: invalid }),
      ).toBeNull();
      expect(
        parseJourneyActivity({
          kind: "competition",
          period: "daily",
          instanceId: invalid,
          attemptId: "attempt",
        }),
      ).toBeNull();
      expect(
        parseJourneyActivity({
          kind: "competition",
          period: "daily",
          instanceId: "instance",
          attemptId: invalid,
        }),
      ).toBeNull();
    },
  );
  it.each([-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, "1"])(
    "rejects non-count revisions: %j",
    (revision) => {
      expect(
        parseJourneyActivity({
          kind: "h2h",
          gameId: "game",
          roundStartRevision: revision,
        }),
      ).toBeNull();
      expect(
        parseJourneyActivity({
          kind: "h2h",
          gameId: "game",
          roundStartRevision: 0,
          terminalRevision: revision,
        }),
      ).toBeNull();
      expect(
        parseJourneyRequestContext({
          documentId: "doc",
          expectedRevision: revision,
        }),
      ).toBeNull();
    },
  );
  it("accepts the identifier boundary and preserves explicit legacy-null rounds", () => {
    expect(
      parseJourneyActivity({ kind: "solo", gameId: "x".repeat(256) }),
    ).toEqual({ kind: "solo", gameId: "x".repeat(256) });
    expect(
      parseJourneyActivity({
        kind: "h2h",
        gameId: "g",
        roundStartRevision: null,
        terminalRevision: 0,
      }),
    ).toEqual({
      kind: "h2h",
      gameId: "g",
      roundStartRevision: null,
      terminalRevision: 0,
    });
    expect(
      parseJourneyActivity({ kind: "h2h-queue", gameId: "injected" }),
    ).toBeNull();
  });
  it("does not conflate same-ID rematches, terminal revisions, or legacy rounds", () => {
    const first = { kind: "h2h", gameId: "g", roundStartRevision: 0 } as const;
    expect(journeyActivityKey(first)).toBe(
      journeyActivityKey({ ...first, terminalRevision: 8 }),
    );
    expect(journeyActivityKey(first)).not.toBe(
      journeyActivityKey({ ...first, roundStartRevision: 9 }),
    );
    expect(journeyActivityKey(first)).not.toBe(
      journeyActivityKey({ ...first, roundStartRevision: null }),
    );
  });
  it("accepts finite action/detail pairs and rejects text or cross-action details", () => {
    expect(isJourneyInteraction("chat", "opened")).toBe(true);
    expect(isJourneyInteraction("first_square", "achieved")).toBe(true);
    expect(isJourneyInteraction("chat", "private message")).toBe(false);
    expect(isJourneyInteraction("chat", "new")).toBe(false);
    expect(isJourneyInteraction("__proto__", "opened")).toBe(false);
    expect(isJourneyMilestone("half")).toBe(true);
    expect(isJourneyMilestone("first_square")).toBe(false);
    expect(isJourneyMilestone("__proto__")).toBe(false);
  });
  it("uses leading score relative to target and caps the final overshoot", () => {
    const board = {
      winScore: 150,
      m_players: [{ m_score: 20 }, { m_score: 90 }],
    } as Pick<CanonicalBoardSnapshot, "winScore" | "m_players">;
    expect(journeyBoardProgress(board)).toBe(0.6);
    board.m_players[0].m_score = 200;
    expect(journeyBoardProgress(board)).toBe(1);
  });
  it("counts a forfeit winner as completed and the quitter as incomplete", () => {
    const state: Pick<
      H2HCanonicalState,
      "ended" | "endedReason" | "victorSide"
    > = { ended: true, endedReason: "player_left", victorSide: 2 };
    expect(h2hJourneyCompletedForPlayer(state, 0)).toBe(false);
    expect(h2hJourneyCompletedForPlayer(state, 1)).toBe(true);
    expect(
      h2hJourneyCompletedForPlayer(
        { ...state, endedReason: "tie", victorSide: null },
        0,
      ),
    ).toBe(true);
    expect(h2hJourneyCompletedForPlayer({ ...state, ended: false }, 1)).toBe(
      false,
    );
  });
});
