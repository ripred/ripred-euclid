import { cellsFromPoints, type BoardSquareShape } from "./board-geometry";

/* The mark is a tiny board: four red corners close a square around blue. */
export const MARK_CELLS = cellsFromPoints(3, 3, [
  { x: 0, y: 0, owner: 1 },
  { x: 2, y: 0, owner: 1 },
  { x: 0, y: 2, owner: 1 },
  { x: 2, y: 2, owner: 1 },
  { x: 1, y: 1, owner: 2 },
]);
export const MARK_SQUARES: BoardSquareShape[] = [
  {
    key: "mark",
    owner: 1,
    tone: "history",
    corners: [
      { x: 0, y: 0 },
      { x: 2, y: 0 },
      { x: 2, y: 2 },
      { x: 0, y: 2 },
    ],
  },
];

/* A cropped close-up of a board in play, in the spirit of the community banner. */
const MACRO_W = 14;
export const MACRO_H = 5;
type MacroPiece = readonly [x: number, y: number, owner: 1 | 2];
const RED_TILT: MacroPiece[] = [
  [1, 2, 1],
  [3, 1, 1],
  [4, 3, 1],
  [2, 4, 1],
];
const BLUE_DIAMOND: MacroPiece[] = [
  [6, 1, 2],
  [7, 2, 2],
  [6, 3, 2],
  [5, 2, 2],
];
const RED_BLOCK: MacroPiece[] = [
  [9, 1, 1],
  [11, 1, 1],
  [11, 3, 1],
  [9, 3, 1],
];
const LOOSE: MacroPiece[] = [
  [0, 0, 2],
  [3, 3, 2],
  [8, 0, 2],
  [13, 4, 2],
  [12, 2, 2],
  [7, 4, 2],
  [5, 0, 1],
  [8, 3, 1],
  [13, 1, 1],
  [0, 4, 1],
];
const toPoints = (pieces: readonly MacroPiece[]) =>
  pieces.map(([x, y, owner]) => ({ x, y, owner }));
const macroSquare = (
  key: string,
  pieces: readonly MacroPiece[],
): BoardSquareShape => ({
  key,
  owner: pieces[0]?.[2] ?? 1,
  tone: "history",
  corners: toPoints(pieces),
});
const MACRO_PIECES = [...RED_TILT, ...BLUE_DIAMOND, ...RED_BLOCK, ...LOOSE];
const MACRO_SQUARES = [
  macroSquare("red-tilt", RED_TILT),
  macroSquare("blue-diamond", BLUE_DIAMOND),
  macroSquare("red-block", RED_BLOCK),
];

/**
 * Tiles the close-up sideways for wide art such as banners; every other tile
 * is mirrored so the repeat never reads as a stamp.
 */
export function tiledMacro(repeat: number) {
  const width = MACRO_W * repeat;
  const place = (x: number, tile: number) =>
    tile * MACRO_W + (tile % 2 === 1 ? MACRO_W - 1 - x : x);
  const tiles = Array.from({ length: repeat }, (_, tile) => tile);
  return {
    width,
    cells: cellsFromPoints(
      width,
      MACRO_H,
      tiles.flatMap((tile) =>
        toPoints(MACRO_PIECES).map((p) => ({ ...p, x: place(p.x, tile) })),
      ),
    ),
    squares: tiles.flatMap((tile) =>
      MACRO_SQUARES.map((square) => ({
        ...square,
        key: `${tile}-${square.key}`,
        corners: square.corners.map((c) => ({ ...c, x: place(c.x, tile) })),
      })),
    ),
  };
}
