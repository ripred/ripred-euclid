import type { PlayerIndex } from "../shared/game/rules";
import type { SquareScoringMode } from "../shared/scoring";
import type {
  H2HCanonicalState,
  H2HMoveResponse,
  SharePoint,
  ShareSquare,
  SoloEvent,
} from "../shared/types/api";

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
  /** Stable across retries and equal polls for the same canonical move. */
  id: string;
  gameId: string;
  moveCount: number;
  player: PlayerIndex;
  point: SharePoint;
  pointsScored: number;
  completedSquares: ShareSquare[];
  footprintBounds: GridFootprintBounds[];
};

export type SquareLineSelection = {
  historical: ShareSquare[];
  active: ShareSquare[];
};

export type H2HStateWithBoard = Pick<
  H2HCanonicalState,
  "gameId" | "board" | "ended"
>;

export type PendingH2HScoreFeedbackResolution<
  TState extends H2HStateWithBoard = H2HStateWithBoard,
> = {
  baseline: TState | null;
  events: ScoreFeedbackEvent[];
};

function clonePoint(point: SharePoint): SharePoint {
  return { x: point.x, y: point.y, index: point.index };
}

function cloneSquare(square: ShareSquare): ShareSquare {
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

function squarePoints(square: ShareSquare): readonly SharePoint[] {
  return [square.p1, square.p2, square.p3, square.p4];
}

function squareContainsPoint(square: ShareSquare, point: SharePoint): boolean {
  return squarePoints(square).some(
    (corner) =>
      corner.index === point.index &&
      corner.x === point.x &&
      corner.y === point.y,
  );
}

function ownerAtMove(
  board: H2HCanonicalState["board"],
  point: SharePoint,
): PlayerIndex | null {
  const owner = board.m_board[point.index];
  return owner === 1 ? 0 : owner === 2 ? 1 : null;
}

function latestCanonicalPoint(
  board: H2HCanonicalState["board"],
): SharePoint | null {
  const historyPoint = board.m_history.at(-1);
  if (
    !historyPoint ||
    historyPoint.index !== board.m_last.index ||
    historyPoint.x !== board.m_last.x ||
    historyPoint.y !== board.m_last.y
  ) {
    return null;
  }
  return historyPoint;
}

function createScoreFeedback(
  gameId: string,
  moveCount: number,
  player: PlayerIndex,
  point: SharePoint,
  pointsScored: number,
  completedSquares: readonly ShareSquare[],
  scoring: SquareScoringMode,
): ScoreFeedbackEvent | null {
  if (pointsScored <= 0) return null;

  // Copy and sort server-owned values so later board updates cannot mutate a
  // queued animation and square rendering remains deterministic.
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

/** One visual event per canonical move, independent of request or poll count. */
export function scoreFeedbackId(gameId: string, moveCount: number): string {
  return `${gameId}:${moveCount}`;
}

/**
 * Produces a corner-order-independent signature suitable for SVG keys and
 * active-versus-historical comparisons.
 */
export function squareSignature(square: ShareSquare): string {
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
  square: ShareSquare,
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

/**
 * Preserves the canonical order of human and Euclid moves. A single request
 * can therefore enqueue two distinct scoring moments rather than replacing
 * the first with the second.
 */
export function normalizeSoloScoreFeedback(
  gameId: string,
  events: readonly SoloEvent[],
  scoring: SquareScoringMode,
): ScoreFeedbackEvent[] {
  return events.flatMap((event) => {
    if (event.type !== "move") return [];
    const feedback = createScoreFeedback(
      gameId,
      event.revision,
      event.player,
      event.point,
      event.pointsScored,
      event.completedSquares,
      scoring,
    );
    return feedback ? [feedback] : [];
  });
}

/** Uses the exact square delta returned for the locally accepted H2H move. */
export function scoreFeedbackFromH2HMove(
  response: H2HMoveResponse,
): ScoreFeedbackEvent | null {
  if (!response.ok || !response.accepted) return null;

  const point = latestCanonicalPoint(response.board);
  if (!point) return null;
  const player = ownerAtMove(response.board, point);
  if (player === null) return null;

  return createScoreFeedback(
    response.gameId,
    response.board.m_history.length,
    player,
    point,
    response.pointsScored,
    response.completedSquares,
    response.board.scoring,
  );
}

/** Detects a same-ID rematch before deduplication can suppress its early moves. */
export function didH2HHistoryReset(
  previous: H2HStateWithBoard | null,
  current: H2HStateWithBoard,
): boolean {
  if (!previous || previous.gameId !== current.gameId) return false;
  if (previous.ended && !current.ended) return true;
  if (current.board.m_history.length < previous.board.m_history.length) {
    return true;
  }

  return previous.board.m_history.some((point, index) => {
    const currentPoint = current.board.m_history[index];
    return (
      !currentPoint ||
      currentPoint.index !== point.index ||
      currentPoint.x !== point.x ||
      currentPoint.y !== point.y
    );
  });
}

/**
 * Recovers only the newest H2H scoring moment when an opponent or spectator
 * observes it through canonical polling. A prior state is required so loading
 * or resuming a game establishes a quiet baseline instead of replaying history.
 */
export function scoreFeedbackFromH2HSnapshot(
  previous: H2HStateWithBoard | null,
  current: H2HStateWithBoard,
): ScoreFeedbackEvent | null {
  if (!previous || previous.gameId !== current.gameId) return null;

  const previousMoveCount = previous.board.m_history.length;
  const moveCount = current.board.m_history.length;
  if (moveCount <= previousMoveCount) return null;

  const point = latestCanonicalPoint(current.board);
  if (!point || previous.board.m_board[point.index] !== 0) return null;
  const player = ownerAtMove(current.board, point);
  if (player === null) return null;

  // Since this spot was empty in the prior board, every completed square now
  // containing it belongs to the latest move; older squares cannot contain it.
  const completedSquares = current.board.m_players[player].m_squares.filter(
    (square) => squareContainsPoint(square, point),
  );

  return createScoreFeedback(
    current.gameId,
    moveCount,
    player,
    point,
    current.board.m_lastPoints,
    completedSquares,
    current.board.scoring,
  );
}

/**
 * Orders the exact local delta before any newer move recovered from a poll.
 * This is intentionally pure so the pending-request race can be verified
 * without depending on React scheduling.
 */
export function resolvePendingH2HScoreFeedback<
  TState extends H2HStateWithBoard,
>({
  acceptedFeedback,
  submittedRoundEpoch,
  currentRoundEpoch,
  baseline,
  deferred,
}: {
  acceptedFeedback: ScoreFeedbackEvent | null;
  submittedRoundEpoch: number;
  currentRoundEpoch: number;
  baseline: TState | null;
  deferred: TState | null;
}): PendingH2HScoreFeedbackResolution<TState> {
  const activeGameId = deferred?.gameId ?? baseline?.gameId;
  const candidates: ScoreFeedbackEvent[] = [];

  if (
    acceptedFeedback &&
    submittedRoundEpoch === currentRoundEpoch &&
    acceptedFeedback.gameId === activeGameId
  ) {
    candidates.push(acceptedFeedback);
  }

  let nextBaseline = baseline;
  if (deferred) {
    nextBaseline = deferred;
    if (
      baseline?.gameId === deferred.gameId &&
      !didH2HHistoryReset(baseline, deferred)
    ) {
      const recoveredFeedback = scoreFeedbackFromH2HSnapshot(
        baseline,
        deferred,
      );
      if (recoveredFeedback) candidates.push(recoveredFeedback);
    }
  }

  const seen = new Set<string>();
  return {
    baseline: nextBaseline,
    events: candidates.filter((event) => {
      if (seen.has(event.id)) return false;
      seen.add(event.id);
      return true;
    }),
  };
}

/** Keeps active feedback visible even when accumulated square lines are hidden. */
export function selectSquareLines(
  historicalSquares: readonly ShareSquare[],
  activeSquares: readonly ShareSquare[],
  showHistorical: boolean,
): SquareLineSelection {
  const activeBySignature = new Map<string, ShareSquare>();
  for (const square of activeSquares) {
    activeBySignature.set(squareSignature(square), square);
  }

  const historicalBySignature = new Map<string, ShareSquare>();
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
