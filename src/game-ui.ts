export type PlayerSide = 1 | 2;

export interface BoardLayout {
  cellSize: number;
  dotSize: number;
  boardWidth: number;
  boardHeight: number;
}

const MINIMUM_CELL_SIZE = 16;
const MAXIMUM_CELL_SIZE = 88;

export function shouldRunVictoryEffects(
  terminal: boolean,
  isLocalWinner: boolean,
): boolean {
  return terminal && isLocalWinner;
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

/**
 * Browsers do not expose a keyboard-queue flush. Ignore events created before
 * placement reopened, and require a fresh press instead of an auto-repeat.
 * Both timestamps use the document's performance time origin.
 */
export function isFreshGameplayKey(
  event: Pick<KeyboardEvent, "repeat" | "timeStamp">,
  placeableSince: number,
): boolean {
  return (
    !event.repeat &&
    Number.isFinite(event.timeStamp) &&
    event.timeStamp > placeableSince
  );
}

/**
 * Board keystrokes never queue ahead of a move: a key places only while a
 * placement is allowed, and only if it was pressed after that began and is
 * not an auto-repeat.
 */
export function shouldPlaceFromKey(
  event: Pick<KeyboardEvent, "repeat" | "timeStamp">,
  placeableSince: number,
  placing: boolean,
): boolean {
  return placing && isFreshGameplayKey(event, placeableSince);
}
