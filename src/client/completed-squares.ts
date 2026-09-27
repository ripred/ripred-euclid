import {
  cornerKey,
  orderSquareCorners,
  pointIndex,
  squaresWithCorner,
  type GridPoint,
} from "../shared/game/geometry";
import { scoreGridFootprint } from "../shared/scoring";
import type { CornerPoints } from "../shared/share-squares";
import type { SharePoint } from "../shared/types/api";

export type CompletedSquare<Owner> = {
  key: string;
  owner: Owner;
  points: number;
  corners: CornerPoints;
};

/**
 * The squares a move completes: every square through the moved-to point
 * whose four corners now belong to the mover. The teaching demo and replays
 * of stored games read squares this way; live games use the engine.
 */
export function completedSquares<Owner extends number>(
  cells: readonly number[],
  width: number,
  height: number,
  move: GridPoint & { owner: Owner },
): CompletedSquare<Owner>[] {
  const indexed = ({ x, y }: GridPoint): SharePoint => ({
    x,
    y,
    index: pointIndex(x, y, width),
  });
  const seen = new Set<string>();
  const squares: CompletedSquare<Owner>[] = [];
  for (const [candidate, far, near] of squaresWithCorner(
    width,
    height,
    move.x,
    move.y,
  )) {
    const corners = orderSquareCorners([
      indexed(move),
      indexed(candidate),
      indexed(near),
      indexed(far),
    ]);
    if (corners.some((corner) => cells[corner.index] !== move.owner)) continue;
    const key = cornerKey(corners.map((corner) => corner.index));
    if (seen.has(key)) continue;
    seen.add(key);
    squares.push({
      key,
      owner: move.owner,
      points: scoreGridFootprint(corners),
      corners,
    });
  }
  return squares;
}
