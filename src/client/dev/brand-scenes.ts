import {
  cellsFromPoints,
  type BoardSquareShape,
  type GridPoint,
  type Owner,
} from "../ui/board-geometry";
import { AMBER_MARK_CELLS, AMBER_MARK_SQUARES } from "../ui/brand-boards";

export type BrandSceneName = "icon" | "splash";
type Point = readonly [x: number, y: number];
type Motif = { key: string; owner: Owner; corners: readonly Point[] };
type LoosePiece = readonly [x: number, y: number, owner: Owner];

export interface BrandScene {
  width: number;
  height: number;
  cells: number[];
  squares: readonly BoardSquareShape[];
}

function createScene(
  width: number,
  height: number,
  motifs: readonly Motif[],
  loose: readonly LoosePiece[] = [],
): BrandScene {
  const points = (corners: readonly Point[]): GridPoint[] =>
    corners.map(([x, y]) => ({ x, y }));
  return {
    width,
    height,
    cells: cellsFromPoints(width, height, [
      ...motifs.flatMap(({ corners, owner }) =>
        points(corners).map((point) => ({ ...point, owner })),
      ),
      ...loose.map(([x, y, owner]) => ({ x, y, owner })),
    ]),
    squares: motifs.map(({ key, owner, corners }) => ({
      key,
      owner,
      tone: "history",
      corners: points(corners),
    })),
  };
}

/** Complete shapes occupy the middle; unfinished shapes never get score bands. */
export const PROPOSED_BRAND_SCENES: Record<BrandSceneName, BrandScene> = {
  icon: {
    width: 3,
    height: 3,
    cells: AMBER_MARK_CELLS,
    squares: AMBER_MARK_SQUARES,
  },
  splash: createScene(
    8,
    8,
    [
      {
        key: "tilted",
        owner: 1,
        corners: [
          [1, 4],
          [2, 1],
          [5, 2],
          [4, 5],
        ],
      },
      {
        key: "small",
        owner: 2,
        corners: [
          [5, 5],
          [6, 5],
          [6, 6],
          [5, 6],
        ],
      },
    ],
    [
      [0, 0, 1],
      [3, 0, 1],
      [0, 3, 1],
      [3, 3, 2],
    ],
  ),
};

/** Each viewport contains the full board, including the shared plinth bleed. */
export const PROPOSED_SCENE_FRAMES: Record<
  BrandSceneName,
  { x: number; y: number; width: number; height: number }
> = {
  icon: { x: 50, y: 50, width: 200, height: 200 },
  splash: { x: 355, y: 270, width: 490, height: 490 },
};
