export interface GridPoint {
  x: number;
  y: number;
}

export interface SquarePattern {
  readonly id: string;
  readonly corners: readonly number[];
  readonly aligned: boolean;
  readonly oblique: boolean;
}

/** Complete an integer edge with its clockwise quarter-turn, in legacy order. */
export function squareFromEdge(
  width: number,
  height: number,
  x: number,
  y: number,
  col: number,
  row: number,
): readonly [GridPoint, GridPoint] | null {
  const dx = col - x;
  const dy = row - y;
  const near = { x: x - dy, y: y + dx };
  const far = { x: col - dy, y: row + dx };
  if (
    (!dx && !dy) ||
    [near, far].some((p) => p.x < 0 || p.x >= width || p.y < 0 || p.y >= height)
  )
    return null;
  return [near, far];
}

export function* squaresWithCorner(
  width: number,
  height: number,
  x: number,
  y: number,
): Generator<[GridPoint, GridPoint, GridPoint]> {
  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      const edge = squareFromEdge(width, height, x, y, col, row);
      if (edge) yield [{ x: col, y: row }, edge[1], edge[0]];
    }
  }
}

const catalogs = new Map<string, readonly SquarePattern[]>();

/** Immutable catalog shared by scoring, puzzle certification, and rendering. */
export function squareCatalog(
  width: number,
  height = width,
): readonly SquarePattern[] {
  if (![width, height].every((n) => Number.isSafeInteger(n) && n >= 2))
    throw new RangeError("Board dimensions must be integers of at least 2.");
  const key = `${width}:${height}`;
  const cached = catalogs.get(key);
  if (cached) return cached;
  const patterns = new Map<string, SquarePattern>();
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      for (const corners of squaresWithCorner(width, height, x, y)) {
        const indices = [
          y * width + x,
          ...corners.map((p) => p.y * width + p.x),
        ].sort((a, b) => a - b);
        const id = indices.join("-");
        if (patterns.has(id)) continue;
        const dx = Math.abs(corners[0].x - x),
          dy = Math.abs(corners[0].y - y);
        patterns.set(
          id,
          Object.freeze({
            id,
            corners: Object.freeze(indices),
            aligned: dx === 0 || dy === 0,
            oblique: dx !== 0 && dy !== 0 && dx !== dy,
          }),
        );
      }
    }
  const result = Object.freeze([...patterns.values()]);
  catalogs.set(key, result);
  return result;
}
