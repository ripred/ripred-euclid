export type PlayerSide = 1 | 2;

export interface H2HResultPresentation {
  headline: string;
  isLocalVictory: boolean;
}

export interface BoardLayout {
  isMobile: boolean;
  cellSize: number;
  dotSize: number;
  boardWidth: number;
  boardHeight: number;
  stackScores: boolean;
}

export type H2HExitAction =
  | { label: "Leave Game"; notifyServer: true }
  | { label: "Stop Watching"; notifyServer: false };

const MOBILE_BREAKPOINT = 768;
const MOBILE_RESERVED_HEIGHT = 260;
const DESKTOP_RESERVED_HEIGHT = 240;
const MINIMUM_BOARD_HEIGHT = 180;
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

export function calculateBoardLayout(
  viewportWidth: number,
  viewportHeight: number,
  boardColumns: number,
  boardRows: number,
): BoardLayout {
  if (
    !Number.isFinite(viewportWidth) ||
    !Number.isFinite(viewportHeight) ||
    !Number.isInteger(boardColumns) ||
    !Number.isInteger(boardRows) ||
    viewportWidth <= 0 ||
    viewportHeight <= 0 ||
    boardColumns <= 0 ||
    boardRows <= 0
  ) {
    throw new RangeError("Viewport and board dimensions must be positive.");
  }

  const isMobile = viewportWidth <= MOBILE_BREAKPOINT;
  const reservedHeight = isMobile
    ? MOBILE_RESERVED_HEIGHT
    : DESKTOP_RESERVED_HEIGHT;
  const maximumWidth = Math.floor(viewportWidth * 0.96);
  const maximumHeight = Math.max(
    MINIMUM_BOARD_HEIGHT,
    Math.floor(viewportHeight - reservedHeight),
  );
  const cellSize = Math.max(
    MINIMUM_CELL_SIZE,
    Math.min(
      MAXIMUM_CELL_SIZE,
      Math.floor(
        Math.min(maximumWidth / boardColumns, maximumHeight / boardRows),
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
    isMobile,
    cellSize,
    dotSize,
    boardWidth,
    boardHeight,
    stackScores: isMobile || boardWidth > viewportWidth * 0.82,
  };
}
