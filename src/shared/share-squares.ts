import { cornerKey } from "./game/geometry";
import type { SharePoint, ShareSquare } from "./types/api";

/* Stored squares as the server and the replays read them. */

export type CornerPoints = [SharePoint, SharePoint, SharePoint, SharePoint];

export const squarePoints = (square: ShareSquare): Readonly<CornerPoints> => [
  square.p1,
  square.p2,
  square.p3,
  square.p4,
];

export const clonePoint = ({ x, y, index }: SharePoint): SharePoint => ({
  x,
  y,
  index,
});

/** A plain copy, detached from engine objects and later board changes. */
export const cloneSquare = (square: ShareSquare): ShareSquare => ({
  p1: clonePoint(square.p1),
  p2: clonePoint(square.p2),
  p3: clonePoint(square.p3),
  p4: clonePoint(square.p4),
  points: square.points,
  remain: square.remain,
  clr: square.clr,
});

/** A stored square's corners, whatever order they were recorded in. */
export const squareIndexKey = (square: ShareSquare): string =>
  cornerKey(squarePoints(square).map((point) => point.index));
