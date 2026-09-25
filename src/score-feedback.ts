import type { PlayerIndex } from "./game/rules";
import type { SquareScoringMode } from "./game/scoring";
import type { BoardPoint, BoardSquare } from "./game/types";
import type { SoloMove } from "./solo/session";

export type GridFootprintBounds = {
  /** Grid-space column of the footprint's upper-left occupied spot. */
  x: number;
  /** Grid-space row of the footprint's upper-left occupied spot. */
  y: number;
  /** Number of grid spots spanned horizontally. */
  width: number;
  /** Number of grid spots spanned vertically. */
  height: number;
};

export type ScoreFeedbackEvent = {
  /** One id per move, so a scoring moment animates once. */
  id: string;
  gameId: string;
  moveCount: number;
  player: PlayerIndex;
  point: BoardPoint;
  pointsScored: number;
  completedSquares: BoardSquare[];
  footprintBounds: GridFootprintBounds[];
};

export type SquareLineSelection = {
  historical: BoardSquare[];
  active: BoardSquare[];
};

function clonePoint(point: BoardPoint): BoardPoint {
  return { x: point.x, y: point.y, index: point.index };
}

function cloneSquare(square: BoardSquare): BoardSquare {
  return {
    p1: clonePoint(square.p1),
    p2: clonePoint(square.p2),
    p3: clonePoint(square.p3),
    p4: clonePoint(square.p4),
    points: square.points,
    remain: square.remain,
    clr: square.clr,
  };
}

function squarePoints(square: BoardSquare): readonly BoardPoint[] {
  return [square.p1, square.p2, square.p3, square.p4];
}

function createScoreFeedback(
  gameId: string,
  moveCount: number,
  player: PlayerIndex,
  point: BoardPoint,
  pointsScored: number,
  completedSquares: readonly BoardSquare[],
  scoring: SquareScoringMode,
): ScoreFeedbackEvent | null {
  if (pointsScored <= 0) return null;

  // Copy and sort so later board updates cannot mutate a queued animation
  // and square rendering remains deterministic.
  const squares = completedSquares
    .map(cloneSquare)
    .sort((left, right) =>
      squareSignature(left).localeCompare(squareSignature(right)),
    );
  const footprintBounds = squares.flatMap((square) => {
    const bounds = gridFootprintBounds(square, scoring);
    return bounds ? [bounds] : [];
  });

  return {
    id: scoreFeedbackId(gameId, moveCount),
    gameId,
    moveCount,
    player,
    point: clonePoint(point),
    pointsScored,
    completedSquares: squares,
    footprintBounds,
  };
}

/** One visual event per move. */
export function scoreFeedbackId(gameId: string, moveCount: number): string {
  return `${gameId}:${moveCount}`;
}

/**
 * Produces a corner-order-independent signature suitable for SVG keys and
 * active-versus-historical comparisons.
 */
export function squareSignature(square: BoardSquare): string {
  return squarePoints(square)
    .map((point) => `${point.x},${point.y}`)
    .sort()
    .join("|");
}

/**
 * Returns grid-space bounds for the enclosing Grid Footprint. True Area does
 * not use this rectangle as its scoring basis, so it intentionally returns
 * no bounds.
 */
export function gridFootprintBounds(
  square: BoardSquare,
  scoring: SquareScoringMode,
): GridFootprintBounds | null {
  if (scoring !== "bbox") return null;

  const points = squarePoints(square);
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);

  return {
    x: minX,
    y: minY,
    width: maxX - minX + 1,
    height: maxY - minY + 1,
  };
}

export function formatSquareCount(squareCount: number): string {
  return `${squareCount} ${squareCount === 1 ? "square" : "squares"}`;
}

export function formatScoreFeedback(
  feedback: Pick<ScoreFeedbackEvent, "pointsScored" | "completedSquares">,
): string {
  return `+${feedback.pointsScored} · ${formatSquareCount(
    feedback.completedSquares.length,
  )}`;
}

/** A scoring move's animation data; moves that score nothing return null. */
export function scoreFeedbackForMove(
  gameId: string,
  move: SoloMove,
  scoring: SquareScoringMode,
): ScoreFeedbackEvent | null {
  return createScoreFeedback(
    gameId,
    move.moveNumber,
    move.player,
    move.point,
    move.pointsScored,
    move.completedSquares,
    scoring,
  );
}

/** Keeps active feedback visible even when accumulated square lines are hidden. */
export function selectSquareLines(
  historicalSquares: readonly BoardSquare[],
  activeSquares: readonly BoardSquare[],
  showHistorical: boolean,
): SquareLineSelection {
  const activeBySignature = new Map<string, BoardSquare>();
  for (const square of activeSquares) {
    activeBySignature.set(squareSignature(square), square);
  }

  const historicalBySignature = new Map<string, BoardSquare>();
  if (showHistorical) {
    for (const square of historicalSquares) {
      const signature = squareSignature(square);
      if (!activeBySignature.has(signature)) {
        historicalBySignature.set(signature, square);
      }
    }
  }

  return {
    historical: [...historicalBySignature.values()],
    active: [...activeBySignature.values()],
  };
}
