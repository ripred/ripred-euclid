import type { H2HCanonicalState, H2HEndReason } from "../shared/types/api";

export type PlayerSide = 1 | 2;

export type H2HViewEndReason = H2HEndReason | "gone" | "";

export interface H2HResultPresentation {
  headline: string;
  isLocalVictory: boolean;
}

export interface BoardLayout {
  cellSize: number;
  dotSize: number;
  boardWidth: number;
  boardHeight: number;
}

export type H2HExitAction =
  | { label: "Leave Game"; notifyServer: true }
  | { label: "Stop Watching"; notifyServer: false };

const MINIMUM_CELL_SIZE = 16;
const MAXIMUM_CELL_SIZE = 64;

export function isLocalVictory(
  winnerSide: PlayerSide | null | undefined,
  localSide: PlayerSide | null | undefined,
  spectating: boolean,
): boolean {
  return !spectating && winnerSide != null && winnerSide === localSide;
}

export function shouldRunVictoryEffects(
  terminal: boolean,
  isLocalWinner: boolean,
): boolean {
  return terminal && isLocalWinner;
}

export function getH2HResultPresentation(
  winnerSide: PlayerSide,
  localSide: PlayerSide | null,
  spectating: boolean,
  player1Name: string,
  player2Name: string,
): H2HResultPresentation {
  const localVictory = isLocalVictory(winnerSide, localSide, spectating);
  const winnerName = winnerSide === 1 ? player1Name : player2Name;

  return {
    headline: localVictory ? "You Win!" : `${winnerName} Wins!`,
    isLocalVictory: localVictory,
  };
}

export function getH2HExitAction(spectating: boolean): H2HExitAction {
  return spectating
    ? { label: "Stop Watching", notifyServer: false }
    : { label: "Leave Game", notifyServer: true };
}

/** Chat is available only to a participant while the canonical round is live. */
export function isH2HChatAvailable({
  hasGame,
  hasBoard,
  spectating,
  endReason,
}: {
  hasGame: boolean;
  hasBoard: boolean;
  spectating: boolean;
  endReason: H2HViewEndReason;
}): boolean {
  return hasGame && hasBoard && !spectating && endReason === "";
}

/** A rematch can restart only a normally completed round with both players. */
export function isH2HRematchAvailable(
  endReason: H2HViewEndReason,
  spectating: boolean,
  canRematch: boolean | null = true,
): boolean {
  return (
    canRematch !== false &&
    !spectating &&
    (endReason === "game_over" || endReason === "tie")
  );
}

/**
 * Live views always poll. A completed participant view keeps polling only
 * while another participant can replace it with a canonical rematch round.
 */
export function shouldPollH2HState({
  ended,
  endReason,
  spectating,
  canRematch = true,
}: {
  ended: boolean;
  endReason: H2HViewEndReason | null;
  spectating: boolean;
  canRematch?: boolean | null;
}): boolean {
  if (!ended) return true;
  return isH2HRematchAvailable(
    endReason ?? "game_over",
    spectating,
    canRematch,
  );
}

/**
 * Poll metadata can change without a board revision when a participant
 * detaches from an already completed round.
 */
export function shouldProcessH2HPollSnapshot({
  activeGameId,
  currentRevision,
  currentCanRematch,
  hasBaseline,
  incoming,
}: {
  activeGameId: string | null;
  currentRevision: number;
  currentCanRematch: boolean;
  hasBaseline: boolean;
  incoming: Pick<H2HCanonicalState, "gameId" | "revision" | "ended"> & {
    canRematch: boolean;
  };
}): boolean {
  if (
    !shouldAdoptH2HState(
      activeGameId,
      currentRevision,
      incoming.gameId,
      incoming.revision,
    )
  ) {
    return false;
  }
  if (!hasBaseline || incoming.revision !== currentRevision) return true;
  return incoming.ended && incoming.canRematch !== currentCanRematch;
}

/** Recognizes the canonical live round returned after a stale rematch retry. */
export function isH2HRematchRecovery(
  expectedGameId: string,
  expectedRevision: number,
  state: Pick<H2HCanonicalState, "gameId" | "revision" | "ended">,
): boolean {
  return (
    state.gameId === expectedGameId &&
    state.revision > expectedRevision &&
    !state.ended
  );
}

export function shouldAdoptH2HState(
  activeGameId: string | null,
  currentRevision: number,
  incomingGameId: string | null | undefined,
  incomingRevision: number | null | undefined,
): boolean {
  if (!activeGameId) return false;
  if (incomingGameId && incomingGameId !== activeGameId) return false;
  return incomingRevision == null || incomingRevision >= currentRevision;
}

/** Fit the rendered board area; minimum-sized cells can overflow into scrolling. */
export function calculateBoardLayout(
  availableWidth: number,
  availableHeight: number,
  boardColumns: number,
  boardRows: number,
): BoardLayout {
  if (
    !Number.isFinite(availableWidth) ||
    !Number.isFinite(availableHeight) ||
    !Number.isInteger(boardColumns) ||
    !Number.isInteger(boardRows) ||
    availableWidth < 0 ||
    availableHeight < 0 ||
    boardColumns <= 0 ||
    boardRows <= 0
  ) {
    throw new RangeError(
      "Available space must be non-negative and board dimensions positive integers.",
    );
  }

  const cellSize = Math.max(
    MINIMUM_CELL_SIZE,
    Math.min(
      MAXIMUM_CELL_SIZE,
      Math.floor(
        Math.min(availableWidth / boardColumns, availableHeight / boardRows),
      ),
    ),
  );
  const dotScale = Math.max(
    0.58,
    Math.min(0.82, 0.82 - Math.max(0, boardColumns - 8) * 0.02),
  );
  const dotSize = Math.min(cellSize - 4, Math.floor(cellSize * dotScale));
  const boardWidth = boardColumns * cellSize;
  const boardHeight = boardRows * cellSize;

  return {
    cellSize,
    dotSize,
    boardWidth,
    boardHeight,
  };
}
