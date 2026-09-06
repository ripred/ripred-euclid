import { Board, Player } from "../shared/game/engine";
import type { SerializableBoard } from "../shared/types/api";
import { DEMO_RECORDING } from "./preview-demo";

export function buildWatchDemo(): SerializableBoard {
  // This is a teaching sequence, not a finished match. A high target lets every
  // recorded move play without implying that a player won an actual game.
  const board = new Board(new Player(), new Player(), {
    W: DEMO_RECORDING.width,
    H: DEMO_RECORDING.height,
    scoring: "bbox",
    winScore: Number.MAX_SAFE_INTEGER,
    rng: () => 0,
  });

  for (const move of DEMO_RECORDING.moves) {
    const point = board.pointAt(move.x, move.y);
    if (
      move.owner !== board.m_turn + 1 ||
      !point.valid(board.W, board.H) ||
      board.m_board[point.index] !== 0
    ) {
      throw new Error("The spectator demo contains an invalid recorded move.");
    }
    board.placePiece(point);
    board.advanceTurn();
  }

  return board.toJSON();
}
