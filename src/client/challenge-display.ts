import type { ChallengePuzzle } from "../shared/challenge";
import { formatCount } from "./format";

export function challengeObjective(puzzle: ChallengePuzzle): string {
  return `Complete ${formatCount(puzzle.targetSquares, "Square")} In ${formatCount(puzzle.minimumMoves, "move")}`;
}
