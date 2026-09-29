import {
  STANDARD_WIN_SCORE,
  TIDE_MOVE_LIMIT,
  TIDE_PERSONAL_TURNS,
  TIDE_STONE_LIFETIME,
} from "../shared/game/rules";
import type { SerializableBoard } from "../shared/types/api";

export const TIDE_RULES_COPY = `Unanchored pieces last ${TIDE_PERSONAL_TURNS} of their owner's turns. Their outer rings shrink as turns pass. Complete a square to anchor its corners permanently. First to ${STANDARD_WIN_SCORE} wins; after ${TIDE_MOVE_LIMIT} moves, the higher score wins. Equal scores draw.`;

/** Piece age follows confirmed moves, never elapsed time or a client timer. */
export function tidePieceState(
  tide: SerializableBoard["tide"] | undefined,
  index: number,
  ply: number,
) {
  if (!tide) return null;
  if (tide.anchored[index]) return { anchored: true, remaining: 0, turns: 0 };
  const remaining = Math.max(
    0,
    Math.min(TIDE_STONE_LIFETIME, (tide.expires[index] ?? 0) - ply),
  );
  return {
    anchored: false,
    remaining,
    turns: Math.floor(remaining / 2),
  };
}

export function tidePieceDescription(
  tide: SerializableBoard["tide"] | undefined,
  index: number,
  ply: number,
): string {
  const state = tidePieceState(tide, index, ply);
  return !state
    ? ""
    : state.anchored
      ? ", anchored permanently"
      : state.turns === 0
        ? ", expires before its owner's next turn"
        : `, ${state.turns} personal ${state.turns === 1 ? "turn" : "turns"} remaining`;
}
