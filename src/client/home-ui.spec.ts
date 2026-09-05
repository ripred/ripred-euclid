import { describe, expect, it } from "vitest";

import {
  GAME_STATES,
  RANKED_SOLO_RULES,
  SOLO_RULES_VERSION,
  type PracticeRules,
} from "../shared/game/rules";
import type {
  H2HMappingResponse,
  RatingRecord,
  SharePlayer,
  SoloSessionSnapshot,
} from "../shared/types/api";
import {
  formatCompetitiveRecord,
  getH2HHomePresentation,
  getHomeRecordPresentations,
  getPlayEuclidSubtitle,
  getSoloContinuationPresentation,
  shouldLockHomeNavigation,
} from "./home-ui";

function ratingRecord(overrides: Partial<RatingRecord> = {}): RatingRecord {
  return {
    rating: 1_200,
    games: 0,
    wins: 0,
    losses: 0,
    draws: 0,
    ...overrides,
  };
}

function player(userId: string, score: number, computer = false): SharePlayer {
  return {
    m_squares: [],
    m_score: score,
    m_lastNumSquares: 0,
    m_playStyle: 0,
    m_goofs: false,
    m_computer: computer,
    userId,
  };
}

const PRACTICE_RULES: PracticeRules = {
  rulesVersion: SOLO_RULES_VERSION,
  mode: "practice",
  W: 6,
  H: 8,
  scoring: "true",
  winScore: 75,
  humanPlayer: 1,
  firstPlayer: 1,
  difficulty: "coffee",
};

function soloSnapshot(
  mode: "ranked" | "practice",
  humanScore: number,
  euclidScore: number,
  humanTurn: boolean,
): SoloSessionSnapshot {
  const rules = mode === "ranked" ? RANKED_SOLO_RULES : PRACTICE_RULES;
  const humanIndex = rules.humanPlayer;
  const euclidIndex = humanIndex === 0 ? 1 : 0;
  const players: [SharePlayer, SharePlayer] = [
    player("first", 0),
    player("second", 0),
  ];
  players[humanIndex] = player("human", humanScore);
  players[euclidIndex] = player("euclid", euclidScore, true);

  return {
    mode,
    ranked: mode === "ranked",
    rulesVersion: SOLO_RULES_VERSION,
    rules,
    gameId: `${mode}-game`,
    revision: 4,
    board: {
      W: rules.W,
      H: rules.H,
      scoring: rules.scoring,
      winScore: rules.winScore,
      m_board: new Array<number>(rules.W * rules.H).fill(0),
      m_players: players,
      m_turn: humanTurn ? humanIndex : euclidIndex,
      m_history: [],
      m_displayed_game_over: false,
      m_onlyShowLastSquares: false,
      m_createRandomizedRangeOrder: true,
      m_stopAt150: true,
      m_last: { x: -1, y: -1, index: -1 },
      m_lastPoints: 0,
      revision: 4,
      rulesVersion: SOLO_RULES_VERSION,
    },
    status: "active",
    outcome: {
      state: GAME_STATES.RUNNING,
      status: "running",
      winner: null,
    },
    endedReason: null,
    canShare: false,
    humanMoveCount: 2,
    aiMoveCount: 2,
    rankedAbandonCountsAsLoss: true,
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:01:00.000Z",
  } as SoloSessionSnapshot;
}

function activeH2H(
  overrides: Partial<Extract<H2HMappingResponse, { state: "active" }>> = {},
): Extract<H2HMappingResponse, { state: "active" }> {
  return {
    ok: true,
    state: "active",
    gameId: "h2h-game",
    isPlayer1: true,
    canRematch: true,
    board: {
      W: 8,
      H: 8,
      scoring: "bbox",
      winScore: 150,
      m_board: new Array<number>(64).fill(0),
      m_players: [player("ada", 34), player("grace", 21)],
      m_turn: 0,
      m_history: [],
      m_displayed_game_over: false,
      m_onlyShowLastSquares: false,
      m_createRandomizedRangeOrder: true,
      m_stopAt150: true,
      m_last: { x: -1, y: -1, index: -1 },
      m_lastPoints: 0,
      playerNames: { ada: "Ada", grace: "Grace" },
      revision: 6,
      rulesVersion: 1,
    },
    revision: 6,
    rulesVersion: 1,
    ended: false,
    endedReason: null,
    endedBy: null,
    victorSide: null,
    ...overrides,
  };
}

describe("competitive record presentation", () => {
  it("formats rating, results, grouping, and singular game copy", () => {
    expect(
      formatCompetitiveRecord(
        "Euclid Ranked",
        ratingRecord({
          rating: 1_432,
          games: 1,
          wins: 1,
          losses: 0,
          draws: 0,
        }),
      ),
    ).toEqual({
      label: "Euclid Ranked",
      rating: "1,432",
      record: "1W · 0L · 0D",
      games: "1 rated game",
      available: true,
    });
  });

  it("distinguishes a fresh record from unavailable stats", () => {
    expect(
      formatCompetitiveRecord("Redditor Matches", ratingRecord()),
    ).toMatchObject({
      rating: "1,200",
      record: "No rated games yet",
      games: "0 rated games",
      available: true,
    });
    expect(formatCompetitiveRecord("Redditor Matches", null)).toMatchObject({
      rating: "—",
      record: "Stats unavailable",
      available: false,
    });
  });

  it("keeps the Ranked-solo and Redditor rating pools separate", () => {
    const [euclid, redditor] = getHomeRecordPresentations({
      hva: ratingRecord({ rating: 1_310, games: 2, wins: 2 }),
      hvh: ratingRecord({ rating: 1_105, games: 3, losses: 3 }),
    });

    expect(euclid).toMatchObject({ label: "Euclid Ranked", rating: "1,310" });
    expect(redditor).toMatchObject({
      label: "Redditor Matches",
      rating: "1,105",
    });
  });
});

describe("Play Euclid presentation", () => {
  it("locks every Home exit while a request or matchmaking is active", () => {
    expect(shouldLockHomeNavigation(true, "idle")).toBe(true);
    expect(shouldLockHomeNavigation(false, "queued")).toBe(true);
    expect(shouldLockHomeNavigation(false, "idle", true)).toBe(true);
    expect(shouldLockHomeNavigation(false, "active")).toBe(false);
    expect(shouldLockHomeNavigation(false, "idle")).toBe(false);
  });

  it("describes the rating consequence of each path", () => {
    expect(getPlayEuclidSubtitle("ranked")).toBe(
      "Ranked · 8 × 8 Grid Footprint · rating on the line",
    );
    expect(getPlayEuclidSubtitle("practice")).toBe(
      "Practice · custom rules · no rating changes",
    );
  });

  it("uses canonical solo orientation for scores, turn copy, and rules", () => {
    expect(
      getSoloContinuationPresentation(soloSnapshot("practice", 18, 27, true)),
    ).toEqual({
      title: "Continue Practice game",
      detail: "Your turn against Euclid",
      score: "You 18 · Euclid 27",
      rules: "6 × 8 · True Area · first to 75",
      actionLabel: "Continue",
    });

    expect(
      getSoloContinuationPresentation(soloSnapshot("ranked", 42, 36, false)),
    ).toMatchObject({
      title: "Continue Ranked game",
      detail: "Euclid's turn",
      score: "You 42 · Euclid 36",
      rules: "8 × 8 · Grid Footprint · first to 150",
    });
  });
});

describe("Redditor-match home presentation", () => {
  it("gives idle and queued states distinct actions", () => {
    expect(
      getH2HHomePresentation({ ok: true, state: "idle", gameId: null }),
    ).toEqual({
      state: "idle",
      title: "Play a Redditor",
      detail: "Start a live match with another redditor.",
      actionLabel: "Find a match",
    });
    expect(
      getH2HHomePresentation({ ok: true, state: "queued", gameId: null }),
    ).toEqual({
      state: "queued",
      title: "Searching for a redditor…",
      detail: "You can stay here while Euclid finds your opponent.",
      actionLabel: "Cancel search",
    });
  });

  it("orients active scores and turn copy to either participant", () => {
    expect(getH2HHomePresentation(activeH2H())).toMatchObject({
      state: "active",
      ended: false,
      title: "Continue Redditor match",
      detail: "Your turn against Grace",
      score: "You 34 · Grace 21",
      opponentName: "Grace",
      actionLabel: "Continue",
    });

    expect(
      getH2HHomePresentation(
        activeH2H({
          isPlayer1: false,
          board: { ...activeH2H().board, m_turn: 0 },
        }),
      ),
    ).toMatchObject({
      detail: "Waiting for Ada",
      score: "You 21 · Ada 34",
      opponentName: "Ada",
    });
  });

  it("uses participant-relative win, loss, departure, and tie copy", () => {
    expect(
      getH2HHomePresentation(
        activeH2H({
          ended: true,
          endedReason: "game_over",
          victorSide: 1,
        }),
      ),
    ).toMatchObject({
      title: "Review Redditor match",
      detail: "You won against Grace",
      actionLabel: "Review result",
    });

    expect(
      getH2HHomePresentation(
        activeH2H({
          isPlayer1: false,
          ended: true,
          endedReason: "game_over",
          victorSide: 1,
        }),
      ),
    ).toMatchObject({ detail: "Ada won this match" });

    expect(
      getH2HHomePresentation(
        activeH2H({
          ended: true,
          endedReason: "player_left",
          endedBy: "grace",
          victorSide: 1,
        }),
      ),
    ).toMatchObject({ detail: "Grace left · you won" });

    expect(
      getH2HHomePresentation(
        activeH2H({ ended: true, endedReason: "tie", victorSide: null }),
      ),
    ).toMatchObject({ detail: "The match ended in a tie" });
  });
});
