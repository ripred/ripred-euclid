import { squareCatalog } from "./game/geometry";

/* Every square scores its Grid Footprint: the points along one side of the
   upright box around it, squared. */

export type ScoringPoint = {
  x: number;
  y: number;
};

function assertBoardDimensions(width: number, height: number): void {
  if (!Number.isSafeInteger(width) || width < 2) {
    throw new RangeError("Board width must be an integer of at least 2.");
  }
  if (!Number.isSafeInteger(height) || height < 2) {
    throw new RangeError("Board height must be an integer of at least 2.");
  }
}

export function gridFootprintSideSpots(
  corners: readonly ScoringPoint[],
): number {
  if (corners.length === 0) return 0;

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;

  for (const corner of corners) {
    minX = Math.min(minX, corner.x);
    maxX = Math.max(maxX, corner.x);
    minY = Math.min(minY, corner.y);
    maxY = Math.max(maxY, corner.y);
  }

  return Math.max(maxX - minX + 1, maxY - minY + 1);
}

export function scoreGridFootprint(corners: readonly ScoringPoint[]): number {
  const sideSpots = gridFootprintSideSpots(corners);
  return sideSpots * sideSpots;
}

/**
 * Returns the theoretical score one player would receive for completing every
 * unique square on the board.
 */
export function totalSquareScore(width: number, height: number): number {
  assertBoardDimensions(width, height);

  let total = 0;
  for (const square of squareCatalog(width, height)) {
    total += scoreGridFootprint(
      square.corners.map((index) => ({
        x: index % width,
        y: Math.floor(index / width),
      })),
    );
  }

  return total;
}
