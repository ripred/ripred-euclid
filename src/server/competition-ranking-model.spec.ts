import { describe, expect, it } from "vitest";
import { compareCompetitionResults } from "../shared/competitions";
import {
  competitionRankMember,
  readCompetitionRankMember,
  recoverCompetitionSquares,
} from "./competition-ranking-model";
import {
  placeChallengePoint,
  type ChallengeSnapshot,
} from "../shared/challenge";

const base = {
  userId: "player",
  username: "player:one",
  moves: 2,
  squares: 3,
  elapsedMs: 1000,
  achievedAt: 2000,
  order: 1,
};

describe("competition ranking model", () => {
  it("keeps the Redis member order identical to squares, moves, time and first achievement", () => {
    const results = [
      { ...base, userId: "unknown", squares: null, moves: 1, elapsedMs: 0 },
      { ...base, userId: "fewer-squares", squares: 2, moves: 1, elapsedMs: 0 },
      {
        ...base,
        userId: "more-squares",
        squares: 4,
        moves: 8,
        elapsedMs: 5000,
      },
      { ...base, userId: "fewer-moves", moves: 1, elapsedMs: 5000 },
      { ...base, userId: "slower", elapsedMs: 2000 },
      { ...base, userId: "later-tie", order: 2 },
      { ...base, userId: "first-tie" },
    ];
    const expected = [
      "more-squares",
      "fewer-moves",
      "first-tie",
      "later-tie",
      "slower",
      "fewer-squares",
      "unknown",
    ];
    expect(
      [...results]
        .sort((a, b) => compareCompetitionResults(a, b) || a.order - b.order)
        .map((result) => result.userId),
    ).toEqual(expected);
    expect(
      results
        .map(competitionRankMember)
        .sort()
        .map((member) => readCompetitionRankMember(member)?.userId),
    ).toEqual(expected);
    expect(
      readCompetitionRankMember(competitionRankMember(base)),
    ).toMatchObject(base);
  });

  it("recovers actual surplus squares only from the matching completed attempt", () => {
    const started: ChallengeSnapshot = {
      puzzleId: "daily-1",
      attemptId: "attempt-1",
      revision: 1,
      puzzle: {
        version: 1,
        size: 8,
        initial: [0, 1, 2, 3, 8, 10],
        blocked: [],
        targetSquares: 1,
        minimumMoves: 1,
      },
      placements: [],
      completedSquares: [],
      complete: false,
      bestMoves: null,
      bestElapsedMs: null,
      startedAt: 1000,
      finishedAt: null,
      elapsedMs: 0,
    };
    const completed = placeChallengePoint(started, 9, 2000);
    const legacy = { ...base, moves: 1, squares: null, member: "legacy" };
    expect(completed.completedSquares).toHaveLength(2);
    expect(
      recoverCompetitionSquares(legacy, "daily-1", JSON.stringify(completed)),
    ).toMatchObject({ squares: 2, attemptId: "attempt-1", member: "legacy" });
    for (const snapshot of [
      started,
      { ...completed, finishedAt: 2001 },
      { ...completed, puzzleId: "other" },
    ])
      expect(
        recoverCompetitionSquares(legacy, "daily-1", JSON.stringify(snapshot))
          .squares,
      ).toBeNull();
    expect(
      recoverCompetitionSquares(
        { ...legacy, attemptId: "another-attempt" },
        "daily-1",
        JSON.stringify(completed),
      ).squares,
    ).toBeNull();
    expect(
      recoverCompetitionSquares(legacy, "daily-1", undefined).squares,
    ).toBeNull();
  });
});
