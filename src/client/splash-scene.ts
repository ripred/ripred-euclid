import { useEffect, useState } from "react";
import { STANDARD_BOARD } from "../shared/game/rules";
import {
  cellsFromPoints,
  type BoardSquareShape,
  type GridPoint,
} from "./ui/board-geometry";
import { useReducedMotion } from "./ui/use-reduced-motion";

/* Leaderboard podium: the top three places, first in the middle. */
export const PODIUM_PLACES = [1, 2, 3] as const;
export const PODIUM_SIZE = PODIUM_PLACES.length;
/** Ratings count once all three players stand on their steps. */
export const PODIUM_COUNT_DELAY_MS = 1000;

/**
 * Times a shown slide's entrance. `cued` turns true once the art has landed,
 * so numbers count up only after the eye has somewhere to rest.
 */
export function useSceneCue(active: boolean, delayMs: number) {
  const reduced = useReducedMotion();
  const [cued, setCued] = useState(false);
  useEffect(() => {
    if (!active) return;
    setCued(false);
    const timer = window.setTimeout(() => setCued(true), reduced ? 0 : delayMs);
    return () => window.clearTimeout(timer);
  }, [active, reduced, delayMs]);
  return { live: active && !reduced, cued, reduced };
}

/**
 * One standard-board position for the splash: red is a move away from a
 * tilted square, and blue has already closed a small one. The choices slide
 * invites that move; Options uses it to show what square hints look like.
 */
const SHOWCASE_RED: readonly GridPoint[] = [
  { x: 2, y: 1 },
  { x: 5, y: 2 },
  { x: 4, y: 5 },
];
const SHOWCASE_BLUE: readonly GridPoint[] = [
  { x: 5, y: 6 },
  { x: 6, y: 6 },
  { x: 5, y: 7 },
  { x: 6, y: 7 },
];
export const SHOWCASE = {
  width: STANDARD_BOARD.W,
  height: STANDARD_BOARD.H,
  /** The open corner that closes red's square. */
  move: { x: 1, y: 4 },
  /** The red piece Options presses to show its hints. */
  pressed: SHOWCASE_RED[0]!,
  red: SHOWCASE_RED,
  cells: cellsFromPoints(STANDARD_BOARD.W, STANDARD_BOARD.H, [
    ...SHOWCASE_RED.map((point) => ({ ...point, owner: 1 as const })),
    ...SHOWCASE_BLUE.map((point) => ({ ...point, owner: 2 as const })),
    { x: 6, y: 1, owner: 2 },
    { x: 1, y: 6, owner: 2 },
    { x: 7, y: 4, owner: 1 },
  ]),
  squares: [
    {
      key: "showcase-blue",
      owner: 2,
      tone: "history",
      corners: SHOWCASE_BLUE,
    },
  ] as BoardSquareShape[],
} as const;
