export type SquareScoringMode = "bbox" | "true";

export type ScoringPoint = {
  x: number;
  y: number;
};

const RECOMMENDED_BASE_SIZE = 8;
const RECOMMENDED_BASE_TARGET = 150;

const ADJACENT_SQUARE: readonly ScoringPoint[] = [
  { x: 0, y: 0 },
  { x: 1, y: 0 },
  { x: 1, y: 1 },
  { x: 0, y: 1 },
];

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

export function scoreTrueArea(corners: readonly ScoringPoint[]): number {
  let minDistanceSquared = Infinity;

  for (let i = 0; i < corners.length; i++) {
    for (let j = i + 1; j < corners.length; j++) {
      const left = corners[i];
      const right = corners[j];
      if (!left || !right) continue;

      const dx = left.x - right.x;
      const dy = left.y - right.y;
      const distanceSquared = dx * dx + dy * dy;
      if (distanceSquared > 0 && distanceSquared < minDistanceSquared) {
        minDistanceSquared = distanceSquared;
      }
    }
  }

  return Number.isFinite(minDistanceSquared) ? minDistanceSquared : 0;
}

export function scoreSquareCorners(
  corners: readonly ScoringPoint[],
  scoring: SquareScoringMode,
): number {
  return scoring === "bbox"
    ? scoreGridFootprint(corners)
    : scoreTrueArea(corners);
}

/**
 * Returns the theoretical score one player would receive for completing every
 * unique square on the board.
 */
export function totalSquareScore(
  width: number,
  height: number,
  scoring: SquareScoringMode,
): number {
  assertBoardDimensions(width, height);

  const seenSquares = new Set<string>();
  let total = 0;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      for (let adjacentY = 0; adjacentY < height; adjacentY++) {
        for (let adjacentX = 0; adjacentX < width; adjacentX++) {
          if (adjacentX === x && adjacentY === y) continue;

          const dx = adjacentX - x;
          const dy = adjacentY - y;
          const oppositeAdjacentX = x - dy;
          const oppositeAdjacentY = y + dx;
          const oppositeX = adjacentX - dy;
          const oppositeY = adjacentY + dx;

          if (
            oppositeAdjacentX < 0 ||
            oppositeAdjacentX >= width ||
            oppositeAdjacentY < 0 ||
            oppositeAdjacentY >= height ||
            oppositeX < 0 ||
            oppositeX >= width ||
            oppositeY < 0 ||
            oppositeY >= height
          ) {
            continue;
          }

          const cornerIndexes = [
            y * width + x,
            adjacentY * width + adjacentX,
            oppositeAdjacentY * width + oppositeAdjacentX,
            oppositeY * width + oppositeX,
          ].sort((left, right) => left - right);
          const squareKey = cornerIndexes.join(",");
          if (seenSquares.has(squareKey)) continue;

          seenSquares.add(squareKey);
          total += scoreSquareCorners(
            [
              { x, y },
              { x: adjacentX, y: adjacentY },
              { x: oppositeAdjacentX, y: oppositeAdjacentY },
              { x: oppositeX, y: oppositeY },
            ],
            scoring,
          );
        }
      }
    }
  }

  return total;
}

/**
 * Scales the 8x8, first-to-150 baseline by theoretical board score. The floor
 * is strictly greater than the smallest scoring event so the first square is
 * not automatically decisive on a supported board.
 */
export function recommendedWinTarget(
  width: number,
  height: number,
  scoring: SquareScoringMode,
): number {
  const bestCase = totalSquareScore(width, height, scoring);
  const baseline = totalSquareScore(
    RECOMMENDED_BASE_SIZE,
    RECOMMENDED_BASE_SIZE,
    scoring,
  );
  const minimumEvent = scoreSquareCorners(ADJACENT_SQUARE, scoring);
  const scaledTarget = Math.round(
    (RECOMMENDED_BASE_TARGET * bestCase) / baseline,
  );

  return Math.min(bestCase, Math.max(minimumEvent + 1, scaledTarget));
}
