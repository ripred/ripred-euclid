import {
  emptyCells,
  orderAroundCentre,
  pointIndex,
  squaresWithCorner,
} from "../../shared/game/geometry";
export { pointIndex, squaresWithCorner } from "../../shared/game/geometry";
export type { GridPoint } from "../../shared/game/geometry";
import type { GridPoint } from "../../shared/game/geometry";
/** Geometry shared by every board surface: game, demo, replay and share. */

export type Owner = 1 | 2;

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
export const orderCorners = orderAroundCentre;

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
  const cells = emptyCells(width, height);
  for (const point of points)
    cells[pointIndex(point.x, point.y, width)] = point.owner;
  return cells;
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
    if (corners.every((p) => cells[pointIndex(p.x, p.y, width)] === owner)) {
      blocked.push([{ x, y }, ...corners]);
    }
  }
  return blocked;
}

/**
 * Square hints for the piece at `index`: open points that finish one of its
 * squares next move ("near") or in two moves ("far"). Squares holding an
 * opponent's piece are already blocked and give no hints.
 */
export function squareHints(
  cells: ArrayLike<number>,
  width: number,
  height: number,
  index: number,
  owner: Owner,
  canComplete?: (corners: readonly number[]) => boolean,
): BoardHint[] {
  if (cells[index] !== owner) return [];
  const opponent = owner === 1 ? 2 : 1;
  const near = new Set<number>();
  const far = new Set<number>();
  const x = index % width;
  const y = Math.floor(index / width);
  for (const corners of squaresWithCorner(width, height, x, y)) {
    const indices = corners.map((point) => pointIndex(point.x, point.y, width));
    const values = indices.map((corner) => cells[corner]);
    if (values.some((value) => value === undefined || value === opponent))
      continue;
    if (canComplete && !canComplete([index, ...indices])) continue;
    const open = indices.filter((_, corner) => values[corner] === 0);
    if (open.length === 1) open.forEach((point) => near.add(point));
    else if (open.length === 2) open.forEach((point) => far.add(point));
  }
  return [
    ...[...near].map((point) => ({
      index: point,
      owner,
      strength: "near" as const,
    })),
    ...[...far]
      .filter((point) => !near.has(point))
      .map((point) => ({ index: point, owner, strength: "far" as const })),
  ];
}
