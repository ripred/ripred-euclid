/** Geometry shared by every board surface: game, demo, replay and share. */

export type Owner = 1 | 2;

export interface GridPoint {
  x: number;
  y: number;
}

export interface BoardSquareShape {
  key: string;
  owner: Owner;
  corners: readonly GridPoint[];
  /**
   * "fresh" squares were completed by the move being shown; "blocked"
   * squares were denied by it and draw as a dashed outline.
   */
  tone: "history" | "fresh" | "blocked";
  /** Optional per-square strength for fading older history. */
  opacity?: number;
}

export interface BoardFootprint {
  key: string;
  owner: Owner;
  x: number;
  y: number;
  width: number;
  height: number;
}

export type BoardMarkerKind = "last" | "pending" | "ghost";

export interface BoardMarker {
  x: number;
  y: number;
  owner: Owner;
  kind: BoardMarkerKind;
}

export interface BoardHint {
  index: number;
  owner: Owner;
  strength: "near" | "far";
}

/** The board's drawing extends slightly past its grid for the plinth. */
export const BOARD_BLEED = { left: 0.12, top: 0.12, right: 0.12, bottom: 0.22 };

/** CSS aspect-ratio of a drawn board, including its bleed. */
export const boardAspectRatio = (width: number, height: number) =>
  `${width + BOARD_BLEED.left + BOARD_BLEED.right} / ${height + BOARD_BLEED.top + BOARD_BLEED.bottom}`;

const COLUMN_NAMES = "ABCDEFGHIJKLMNOP";

/** Point centres sit half a cell in from the slab edge. */
export const centre = (value: number) => value + 0.5;

/** Corner order around the centroid, so rotated squares draw as polygons. */
export function orderCorners(corners: readonly GridPoint[]): GridPoint[] {
  const cx = corners.reduce((sum, p) => sum + p.x, 0) / corners.length;
  const cy = corners.reduce((sum, p) => sum + p.y, 0) / corners.length;
  return corners
    .slice()
    .sort(
      (a, b) => Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx),
    );
}

export const polygonPoints = (corners: readonly GridPoint[]) =>
  orderCorners(corners)
    .map((p) => `${centre(p.x)},${centre(p.y)}`)
    .join(" ");

export function ownerAt(cells: ArrayLike<number>, index: number): Owner | 0 {
  const value = cells[index];
  return value === 1 || value === 2 ? value : 0;
}

export const ownerName = (owner: Owner) => (owner === 1 ? "red" : "blue");

export function pointLabel(x: number, y: number): string {
  return `${COLUMN_NAMES[x] ?? `column ${x + 1}`}${y + 1}`;
}

/** Converts a list of owned points to the row-major cell array boards use. */
export function cellsFromPoints(
  width: number,
  height: number,
  points: readonly (GridPoint & { owner: Owner })[],
): number[] {
  const cells = new Array<number>(width * height).fill(0);
  for (const point of points) cells[point.y * width + point.x] = point.owner;
  return cells;
}

/**
 * Every square with (x0, y0) as a corner, once each. For each candidate
 * adjacent corner A, the square turns a quarter clockwise from (x0, y0)→A.
 * Yields the other three corners in order around the square.
 */
export function* squaresWithCorner(
  width: number,
  height: number,
  x0: number,
  y0: number,
): Generator<[GridPoint, GridPoint, GridPoint]> {
  const inside = (p: GridPoint) =>
    p.x >= 0 && p.x < width && p.y >= 0 && p.y < height;
  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      if (col === x0 && row === y0) continue;
      const dx = col - x0;
      const dy = row - y0;
      const far = { x: col - dy, y: row + dx };
      const near = { x: x0 - dy, y: y0 + dx };
      if (!inside(far) || !inside(near)) continue;
      yield [{ x: col, y: row }, far, near];
    }
  }
}

/** Squares the move at (x, y) denied: the other three corners are `owner`'s. */
export function blockedSquares(
  cells: ArrayLike<number>,
  width: number,
  height: number,
  x: number,
  y: number,
  owner: Owner,
): GridPoint[][] {
  const blocked: GridPoint[][] = [];
  for (const corners of squaresWithCorner(width, height, x, y)) {
    if (corners.every((p) => cells[p.y * width + p.x] === owner)) {
      blocked.push([{ x, y }, ...corners]);
    }
  }
  return blocked;
}
