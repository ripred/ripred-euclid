import type { Board } from "../shared/game/engine";
import type { PlayerColor, PlayerIndex } from "../shared/game/rules";
import type { Owner } from "./ui/board-geometry";

export interface ResultPlayer {
  owner: Owner;
  name: string;
  score: number;
  winner: boolean;
  squares: number;
  bestSquare: number;
}

/** Summarizes each side's squares from the canonical board. */
export function resultPlayers(
  board: Board,
  names: [string, string],
  winnerSide: PlayerColor | null,
): [ResultPlayer, ResultPlayer] {
  const summarize = (index: PlayerIndex): ResultPlayer => {
    const player = board.m_players[index];
    return {
      owner: (index + 1) as Owner,
      name: names[index],
      score: player.m_score,
      winner: winnerSide === index + 1,
      squares: player.m_squares.length,
      bestSquare: player.m_squares.reduce(
        (best, square) => Math.max(best, square.points),
        0,
      ),
    };
  };
  return [summarize(0), summarize(1)];
}
