import type { RelayState } from "../../shared/edition-game";

export interface RelaySelection {
  gameId: string;
  revision: number;
  point: number;
}

/** A fresh hint selects its suggestion; an explicit choice overrides it for that revision. */
export function selectedRelayPoint(
  game: RelayState | null,
  gameId: string | null,
  selection: RelaySelection | null,
): number | null {
  if (!game || !gameId || game.winner !== null) return null;
  const point =
    selection?.gameId === gameId && selection.revision === game.revision
      ? selection.point
      : (game.hint?.point ?? null);
  return point !== null && game.cells[point] === 0 ? point : null;
}
