import { describe, expect, it } from "vitest";
import {
  CHALLENGE_SIZE,
  CHALLENGE_VERSION,
  readChallengePuzzle,
  readChallengeSnapshot,
  type ChallengeSnapshot,
} from "./challenge";

const puzzle = {
  version: CHALLENGE_VERSION,
  size: CHALLENGE_SIZE,
  initial: [0, 9, 18],
  blocked: [63],
  minimumMoves: 2,
  targetSquares: 3,
} as const;

const snapshot: ChallengeSnapshot = {
  puzzleId: "puzzle-1",
  attemptId: "attempt-1",
  revision: 4,
  puzzle: { ...puzzle, initial: [...puzzle.initial], blocked: [63] },
  placements: [27, 36],
  completedSquares: ["0,9,18,27"],
  complete: false,
  bestMoves: null,
  startedAt: 1_000,
  finishedAt: null,
  elapsedMs: 2_500,
  bestElapsedMs: null,
};

describe("stored challenge readers", () => {
  it("accepts a stored puzzle and attempt unchanged", () => {
    expect(readChallengePuzzle(puzzle)).toEqual(puzzle);
    expect(readChallengeSnapshot(snapshot)).toEqual(snapshot);
    expect(
      readChallengeSnapshot({
        ...snapshot,
        complete: true,
        bestMoves: 2,
        finishedAt: 3_500,
        bestElapsedMs: 2_500,
      }),
    ).not.toBeNull();
  });

  it.each([
    ["an older puzzle version", { version: CHALLENGE_VERSION + 1 }],
    ["a different board size", { size: CHALLENGE_SIZE + 2 }],
    ["a point off the board", { initial: [CHALLENGE_SIZE ** 2] }],
    ["a fractional move count", { minimumMoves: 1.5 }],
  ])("rejects a puzzle with %s", (_label, change) => {
    expect(readChallengePuzzle({ ...puzzle, ...change })).toBeNull();
  });

  it.each([
    ["no attempt", undefined],
    ["a list", [snapshot]],
    ["a blank attempt ID", { ...snapshot, attemptId: " " }],
    ["a negative revision", { ...snapshot, revision: -1 }],
    ["an unreadable puzzle", { ...snapshot, puzzle: { ...puzzle, size: 4 } }],
    ["a placement off the board", { ...snapshot, placements: [64] }],
    ["non-text square keys", { ...snapshot, completedSquares: [1] }],
    ["a missing finish time", { ...snapshot, finishedAt: undefined }],
  ])("rejects %s", (_label, value) => {
    expect(readChallengeSnapshot(value)).toBeNull();
  });
});
