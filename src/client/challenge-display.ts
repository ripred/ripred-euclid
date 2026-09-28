import type { ChallengePuzzle } from "../shared/challenge";

export function challengeObjective(puzzle: ChallengePuzzle): string {
  return `Complete ${puzzle.targetSquares} ${puzzle.targetSquares === 1 ? "Square" : "Squares"} In ${puzzle.minimumMoves} ${puzzle.minimumMoves === 1 ? "move" : "moves"}`;
}
