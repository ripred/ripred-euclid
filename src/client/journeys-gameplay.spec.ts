import { describe, expect, it } from "vitest";
import type { CompetitionStateResponse } from "../shared/competitions";
import {
  DEFAULT_PRACTICE_RULES,
  RANKED_SOLO_RULES,
  type GameVariant,
  type SoloMode,
} from "../shared/game/rules";
import { journeyActivityKey } from "../shared/journeys";
import type {
  CanonicalBoardSnapshot,
  H2HCanonicalState,
  SharePlayer,
  ShareSquare,
  SoloSessionSnapshot,
} from "../shared/types/api";
import {
  competitionJourneyObservation,
  h2hJourneyObservation,
  isCurrentH2HJourneyMove,
  soloJourneyObservation,
} from "./journeys-gameplay";

const square: ShareSquare = {
  p1: { x: 0, y: 0, index: 0 },
  p2: { x: 1, y: 0, index: 1 },
  p3: { x: 0, y: 1, index: 8 },
  p4: { x: 1, y: 1, index: 9 },
  points: 4,
  remain: 0,
  clr: 1,
};

function player(score: number, squares: number): SharePlayer {
  return {
    m_score: score,
    m_squares: Array.from({ length: squares }, () => ({ ...square })),
    m_lastNumSquares: 0,
    m_playStyle: 0,
    m_goofs: false,
    m_computer: false,
    userId: `private-player-${score}`,
  };
}

function board(variant: GameVariant = "standard"): CanonicalBoardSnapshot {
  return {
    variant,
    W: 8,
    H: 8,
    winScore: 150,
    m_board: Array<number>(64).fill(0),
    m_players: [player(90, 3), player(30, 1)],
    m_turn: 1,
    m_history: Array.from({ length: 9 }, (_, index) => ({
      x: index % 8,
      y: Math.floor(index / 8),
      index,
    })),
    m_displayed_game_over: false,
    m_onlyShowLastSquares: false,
    m_createRandomizedRangeOrder: true,
    m_stopAt150: true,
    m_last: { x: 0, y: 1, index: 8 },
    m_lastPoints: 0,
    revision: 9,
    rulesVersion: 1,
  };
}

function solo(mode: SoloMode, variant: GameVariant): SoloSessionSnapshot {
  const metadata =
    mode === "ranked"
      ? {
          mode,
          ranked: true as const,
          rules: { ...RANKED_SOLO_RULES, variant },
        }
      : {
          mode,
          ranked: false as const,
          rules: {
            ...DEFAULT_PRACTICE_RULES,
            variant,
            humanPlayer: 1 as const,
          },
        };
  return {
    ...metadata,
    rulesVersion: 1,
    gameId: `${mode}-${variant}`,
    revision: 9,
    board: { ...board(variant), rulesVersion: 1 },
    status: "active",
    outcome: { state: 0, status: "running", winner: null },
    endedReason: null,
    canShare: false,
    humanMoveCount: mode === "ranked" ? 5 : 4,
    aiMoveCount: mode === "ranked" ? 4 : 5,
    rankedAbandonCountsAsLoss: mode === "ranked",
    createdAt: "2026-09-29T00:00:00.000Z",
    updatedAt: "2026-09-29T00:00:00.000Z",
  };
}

function h2h(overrides: Partial<H2HCanonicalState> = {}): H2HCanonicalState {
  return {
    gameId: "match",
    board: board(),
    revision: 9,
    roundStartRevision: 0,
    rulesVersion: 1,
    ended: false,
    endedReason: null,
    endedBy: null,
    victorSide: null,
    ...overrides,
  };
}

function competition(period: "daily" | "weekly"): CompetitionStateResponse {
  return {
    competition: {
      period,
      enabled: true,
      status: "open",
      instanceId: "instance",
      opensAt: 1,
      endsAt: 10_000,
      showStandings: true,
    },
    snapshot: {
      puzzleId: "instance",
      attemptId: "attempt",
      revision: 4,
      puzzle: {
        version: 1,
        size: 8,
        initial: [0, 1],
        blocked: [],
        minimumMoves: 2,
        targetSquares: 4,
      },
      placements: [8, 9, 10, 17],
      completedSquares: ["0:1:8:9"],
      complete: false,
      bestMoves: null,
      startedAt: 1,
      finishedAt: null,
      elapsedMs: 500,
      bestElapsedMs: null,
    },
    personalBest: null,
    personalRank: null,
    serverNow: 501,
  };
}

describe("solo Journey observations", () => {
  it.each([
    ["practice", "standard", 4, 1],
    ["practice", "tide", 4, 1],
    ["ranked", "standard", 5, 3],
    ["ranked", "tide", 5, 3],
  ] as const)(
    "uses canonical human counts in %s %s",
    (mode, variant, moves, squares) => {
      expect(soloJourneyObservation(solo(mode, variant))).toEqual({
        activity: { kind: "solo", gameId: `${mode}-${variant}` },
        moves,
        squares,
        progress: 0.6,
        terminal: false,
        complete: false,
      });
    },
  );

  it.each(["practice", "ranked"] as const)(
    "distinguishes completed losses/draws from abandoned %s",
    (mode) => {
      const snapshot = solo(mode, "tide");
      for (const outcome of [
        { state: 1, status: "player1_win", winner: 1 },
        { state: 2, status: "player2_win", winner: 2 },
        { state: 3, status: "tie", winner: null },
      ] as const) {
        expect(
          soloJourneyObservation({
            ...snapshot,
            status: "completed",
            endedReason: "move_limit",
            outcome,
          }),
        ).toMatchObject({ terminal: true, complete: true, progress: 0.6 });
      }
      expect(
        soloJourneyObservation({
          ...snapshot,
          status: "abandoned",
          endedReason: "abandoned",
        }),
      ).toMatchObject({ terminal: true, complete: false });
    },
  );
});

describe("H2H Journey observations", () => {
  it.each(["standard", "tide"] as const)(
    "counts each player's turns and squares in %s",
    (variant) => {
      const state = h2h({ board: board(variant) });
      expect(h2hJourneyObservation(state, true)).toEqual({
        activity: { kind: "h2h", gameId: "match", roundStartRevision: 0 },
        moves: 5,
        squares: 3,
        progress: 0.6,
        terminal: false,
        complete: false,
      });
      expect(h2hJourneyObservation(state, false)).toMatchObject({
        moves: 4,
        squares: 1,
        progress: 0.6,
        terminal: false,
        complete: false,
      });
      state.board.m_history = [];
      expect(h2hJourneyObservation(state, false).moves).toBe(0);
    },
  );

  it.each([1, 2, null] as const)(
    "finishes both players for normal winner %s",
    (victorSide) => {
      const state = h2h({
        ended: true,
        endedReason: victorSide ? "game_over" : "tie",
        victorSide,
      });
      for (const first of [true, false]) {
        expect(h2hJourneyObservation(state, first)).toMatchObject({
          activity: { terminalRevision: 9 },
          terminal: true,
          complete: true,
        });
      }
    },
  );

  it.each([1, 2] as const)(
    "completes only surviving player %s after a forfeit",
    (victorSide) => {
      const state = h2h({
        ended: true,
        endedReason: "player_left",
        victorSide,
      });
      expect(h2hJourneyObservation(state, victorSide === 1)).toMatchObject({
        terminal: true,
        complete: true,
      });
      expect(h2hJourneyObservation(state, victorSide !== 1)).toMatchObject({
        terminal: true,
        complete: false,
      });
    },
  );

  it("keeps legacy, initial, and rematch identity separate while terminal revisions share a round", () => {
    const legacy = h2h();
    delete legacy.roundStartRevision;
    const legacyObservation = h2hJourneyObservation(legacy, true);
    expect(legacyObservation.activity).toEqual({
      kind: "h2h",
      gameId: "match",
      roundStartRevision: null,
    });
    const first = h2hJourneyObservation(h2h(), true);
    const finished = h2hJourneyObservation(
      h2h({ ended: true, endedReason: "tie" }),
      true,
    );
    const rematch = h2hJourneyObservation(
      h2h({ roundStartRevision: 10, revision: 10 }),
      true,
    );
    expect(journeyActivityKey(first.activity)).toBe(
      journeyActivityKey(finished.activity),
    );
    expect(
      new Set(
        [legacyObservation, first, rematch].map((observation) =>
          journeyActivityKey(observation.activity),
        ),
      ).size,
    ).toBe(3);
  });

  it("accepts current replies but rejects late accepted moves after departure or a rematch", () => {
    const submitted = h2h();
    expect(isCurrentH2HJourneyMove(3, 3, submitted, null)).toBe(true);
    expect(
      isCurrentH2HJourneyMove(3, 3, submitted, h2h({ revision: 11 })),
    ).toBe(true);
    expect(isCurrentH2HJourneyMove(3, 4, submitted, null)).toBe(false);
    expect(
      isCurrentH2HJourneyMove(3, 3, submitted, h2h({ gameId: "another-game" })),
    ).toBe(false);
    expect(
      isCurrentH2HJourneyMove(
        3,
        3,
        submitted,
        h2h({ roundStartRevision: 10, revision: 10 }),
      ),
    ).toBe(false);
    const legacy = h2h();
    delete legacy.roundStartRevision;
    expect(isCurrentH2HJourneyMove(3, 3, legacy, h2h())).toBe(false);
  });
});

describe("challenge Journey observations", () => {
  it.each(["daily", "weekly"] as const)(
    "uses completed squares/target, not moves, in %s",
    (period) => {
      const state = competition(period);
      expect(competitionJourneyObservation(state)).toEqual({
        activity: {
          kind: "competition",
          period,
          instanceId: "instance",
          attemptId: "attempt",
        },
        moves: 4,
        squares: 1,
        progress: 0.25,
        terminal: false,
      });
      state.snapshot!.completedSquares = ["a", "b", "c", "d", "e"];
      state.snapshot!.complete = true;
      expect(competitionJourneyObservation(state)).toMatchObject({
        squares: 5,
        progress: 1,
        terminal: true,
      });
    },
  );

  it("has no activity for absent or hidden canonical attempts", () => {
    const state = competition("daily");
    expect(
      competitionJourneyObservation({ ...state, snapshot: null }),
    ).toBeNull();
    expect(
      competitionJourneyObservation({
        ...state,
        competition: { ...state.competition, instanceId: null },
      }),
    ).toBeNull();
  });

  it("distinguishes period, replacement instance, and retry attempt", () => {
    const state = competition("daily");
    const keys = [
      state,
      {
        ...state,
        competition: { ...state.competition, period: "weekly" as const },
      },
      {
        ...state,
        competition: { ...state.competition, instanceId: "replacement" },
      },
      { ...state, snapshot: { ...state.snapshot!, attemptId: "retry" } },
    ].map((value) =>
      journeyActivityKey(competitionJourneyObservation(value)!.activity),
    );
    expect(new Set(keys).size).toBe(4);
  });
});
