import { describe, expect, it } from "vitest";

import { RANKED_SOLO_RULES, validatePracticeRules } from "../game/rules";
import {
  EMPTY_RECORDS,
  expectedScore,
  restoreRecords,
  settleGame,
  settleRating,
  START_RATING,
} from "./records";
import {
  abandonSoloGame,
  createSoloGame,
  playHumanMove,
  type SoloGame,
} from "./session";

const NOW = 1_700_000_000_000;

const rankedAfterOneMove = () =>
  playHumanMove(
    createSoloGame(RANKED_SOLO_RULES, { id: "ranked", now: NOW }),
    4,
    4,
    NOW,
  )!.game;

const finished = (game: SoloGame, winner: 1 | 2 | null): SoloGame => ({
  ...game,
  status: "completed",
  endedReason: "score_target",
  outcome:
    winner === null
      ? { state: 3, status: "tie", winner: null }
      : winner === 1
        ? { state: 1, status: "player1_win", winner: 1 }
        : { state: 2, status: "player2_win", winner: 2 },
});

describe("Ranked ratings", () => {
  it("rates against Euclid's fixed 1600 with K = 32", () => {
    expect(expectedScore(1200)).toBeCloseTo(1 / 11, 10);
    expect(settleRating(1200, 0)).toBe(1197);
    expect(settleRating(1200, 1)).toBe(1229);
    expect(settleRating(1200, 0.5)).toBe(1213);
    expect(settleRating(1600, 0.5)).toBe(1600);
  });

  it("settles a finished game once and keeps the change on the game", () => {
    const win = finished(rankedAfterOneMove(), 1);
    const first = settleGame(win, EMPTY_RECORDS);
    expect(first.game.settled).toBe(true);
    expect(first.game.rating).toEqual({ before: START_RATING, after: 1229 });
    expect(first.records.ranked).toMatchObject({
      rating: 1229,
      best: 1229,
      games: 1,
      wins: 1,
    });

    const again = settleGame(first.game, first.records);
    expect(again.records).toBe(first.records);
    expect(again.game).toBe(first.game);
  });

  it("counts a Ranked forfeit as a loss and keeps the best rating", () => {
    const forfeit = abandonSoloGame(rankedAfterOneMove(), NOW);
    const { records } = settleGame(forfeit, EMPTY_RECORDS);
    expect(records.ranked).toMatchObject({
      rating: 1197,
      best: START_RATING,
      losses: 1,
      games: 1,
    });
  });

  it("does not count a canceled Ranked start or an active game", () => {
    const fresh = createSoloGame(RANKED_SOLO_RULES, { id: "r", now: NOW });
    expect(settleGame(fresh, EMPTY_RECORDS).records).toBe(EMPTY_RECORDS);
    const canceled = settleGame(abandonSoloGame(fresh, NOW), EMPTY_RECORDS);
    expect(canceled.records).toBe(EMPTY_RECORDS);
    expect(canceled.game.settled).toBe(true);
  });
});

describe("Practice tally", () => {
  it("tallies results without touching the rating", () => {
    const rules = validatePracticeRules({
      W: 6,
      H: 6,
      scoring: "true",
      winScore: 20,
      difficulty: "casual",
    });
    const game = playHumanMove(
      createSoloGame(rules, { id: "p", now: NOW }),
      0,
      0,
      NOW,
    )!.game;
    const tie = settleGame(finished(game, null), EMPTY_RECORDS);
    expect(tie.records.practice).toEqual({
      games: 1,
      wins: 0,
      losses: 0,
      draws: 1,
    });
    expect(tie.records.ranked).toEqual(EMPTY_RECORDS.ranked);
    expect(tie.game.rating).toBeUndefined();
  });
});

describe("restoring records", () => {
  it("accepts well-formed records, including a rating below zero", () => {
    const value = {
      ranked: {
        games: 3,
        wins: 1,
        losses: 1,
        draws: 1,
        rating: -4,
        best: 1210,
      },
      practice: { games: 0, wins: 0, losses: 0, draws: 0 },
    };
    expect(restoreRecords(value)).toEqual(value);
  });

  it("rejects malformed or inconsistent tallies", () => {
    expect(restoreRecords(null)).toBeNull();
    expect(restoreRecords({ ranked: {}, practice: {} })).toBeNull();
    expect(
      restoreRecords({
        ranked: {
          games: 2,
          wins: 1,
          losses: 0,
          draws: 0,
          rating: 1200,
          best: 1200,
        },
        practice: { games: 0, wins: 0, losses: 0, draws: 0 },
      }),
    ).toBeNull();
    expect(
      restoreRecords({
        ranked: {
          games: 0,
          wins: 0,
          losses: 0,
          draws: 0,
          rating: 1.5,
          best: 1200,
        },
        practice: { games: 0, wins: 0, losses: 0, draws: 0 },
      }),
    ).toBeNull();
  });
});
