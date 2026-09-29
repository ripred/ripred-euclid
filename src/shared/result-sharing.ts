import type { GameOutcome } from "./game/rules";
import type { SerializableBoard, SoloSessionStatus } from "./types/api";

export const RESULT_HUB_TITLES = {
  ai: "Redditors vs Euclid",
  h2h: "Redditors vs Redditors",
} as const;

/** Only played-through solo wins/losses can be shared, never abandonment or a draw. */
export function canShareSoloResult(result: {
  status: SoloSessionStatus;
  outcome: GameOutcome;
}): boolean {
  return result.status === "completed" && result.outcome.winner !== null;
}

/** Names and scores follow the canonical winning side, independent of human color. */
export function describeSharedResult({
  board,
  p1Name,
  p2Name,
  outcome,
}: {
  board: Pick<SerializableBoard, "m_players">;
  p1Name: string;
  p2Name: string;
  outcome: GameOutcome;
}) {
  if (outcome.status === "running")
    throw new Error("An unfinished game has no result to share.");
  const names = [p1Name, p2Name];
  const first = outcome.winner === 2 ? 1 : 0;
  const second = first === 0 ? 1 : 0;
  const headline = `${names[first]} ${outcome.winner === null ? "drew with" : "beat"} ${names[second]}`;
  const details = `${board.m_players[first]!.m_score}–${board.m_players[second]!.m_score}`;
  return {
    title: `${headline}, ${details}`,
    headline: `${headline}!`,
    details,
    winnerSide: outcome.winner,
  };
}
