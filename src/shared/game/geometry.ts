export interface GridPoint {
  x: number;
  y: number;
}

/** Row-major index of the point at (x, y). */
export const pointIndex = (x: number, y: number, width: number): number =>
  y * width + x;

/** Identifies a set of corners whatever their order: sorted indices. */
export const cornerKey = (indices: readonly number[]): string =>
  [...indices].sort((left, right) => left - right).join(",");

/** Corners sorted by angle around their centre, so they draw as a polygon. */
export function orderAroundCentre<T extends GridPoint>(
  corners: readonly T[],
): T[] {
  const cx = corners.reduce((sum, p) => sum + p.x, 0) / corners.length;
  const cy = corners.reduce((sum, p) => sum + p.y, 0) / corners.length;
  return [...corners].sort(
    (a, b) => Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx),
  );
}

/** A square's corners around its centre, starting from the top-left one. */
export function orderSquareCorners<T extends GridPoint>(
  corners: readonly [T, T, T, T],
): [T, T, T, T] {
  const ordered = orderAroundCentre(corners);
  let start = 0;
  ordered.forEach((point, index) => {
    const first = ordered[start]!;
    if (point.y < first.y || (point.y === first.y && point.x < first.x))
      start = index;
  });
  const at = (step: number) => ordered[(start + step) % 4]!;
  return [at(0), at(1), at(2), at(3)];
}

/** Cells of an empty board, in row-major order; 0 marks an open point. */
export function emptyCells(width: number, height: number): number[] {
  return new Array<number>(width * height).fill(0);
}

export interface SquarePattern {
  readonly id: string;
  readonly corners: readonly number[];
  readonly aligned: boolean;
  readonly oblique: boolean;
}

/** Complete an integer edge with its clockwise quarter-turn. */
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
          pointIndex(x, y, width),
          ...corners.map((p) => pointIndex(p.x, p.y, width)),
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
