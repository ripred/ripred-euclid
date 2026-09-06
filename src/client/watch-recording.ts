import type { PlayerColor } from "../shared/game/rules";
import type { H2HCanonicalState, SerializableBoard } from "../shared/types/api";
import { getH2HResultPresentation } from "./game-ui";

export type WatchRecording = { board: SerializableBoard; headline: string };

export function captureWatchRecording(
  state: H2HCanonicalState,
  victorSide: PlayerColor | null,
): WatchRecording | null {
  if (!state.ended) return null;
  const [first, second] = state.board.m_players;
  const headline = victorSide
    ? getH2HResultPresentation(
        victorSide,
        null,
        true,
        state.board.playerNames?.[first.userId] || "Redditor 1",
        state.board.playerNames?.[second.userId] || "Redditor 2",
      ).headline
    : state.endedReason === "tie"
      ? "Tie game!"
      : "Game over";

  // Keep the accepted result independent of later rematches. A forfeit winner
  // comes from canonical state, never from comparing replay scores.
  return { board: structuredClone(state.board), headline };
}
