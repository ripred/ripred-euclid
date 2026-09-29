import { playerColorForIndex, type PlayerColor } from "../shared/game/rules";
import {
  emptyCells,
  orderSquareCorners,
  pointIndex,
} from "../shared/game/geometry";
import {
  cloneSquare,
  squareIndexKey,
  squarePoints,
} from "../shared/share-squares";
import { completedSquares, type CompletedSquare } from "./completed-squares";
import type { BoardMarker, BoardSquareShape } from "./ui/board-geometry";
import type {
  SerializableBoard,
  SharePoint,
  ShareSquare,
} from "../shared/types/api";

export type ReplayOwner = PlayerColor;

type ReplayMove = SharePoint & {
  owner: ReplayOwner;
};

type ReplaySquare = CompletedSquare<ReplayOwner>;

export type ReplayFrame = {
  board: number[];
  scores: [number, number];
  moveNumber: number;
  move?: ReplayMove;
  newSquares: ReplaySquare[];
  allSquares: ReplaySquare[];
};

export type ReplayFrames = [ReplayFrame, ...ReplayFrame[]];

function ownerForReplayMove(
  board: SerializableBoard,
  moveIndex: number,
): ReplayOwner {
  const firstPlayer = board.solo?.rules.firstPlayer === 1 ? 1 : 0;
  const playerIndex =
    moveIndex % 2 === 0 ? firstPlayer : firstPlayer === 0 ? 1 : 0;
  return playerColorForIndex(playerIndex);
}

function squareFromStored(
  square: ShareSquare,
  owner: ReplayOwner,
): ReplaySquare {
  const corners = orderSquareCorners(squarePoints(cloneSquare(square)));
  return {
    key: squareIndexKey(square),
    owner,
    points: square.points,
    corners,
  };
}

function buildFinalFrame(board: SerializableBoard): ReplayFrame {
  const allSquares = [
    ...(board.m_players[0]?.m_squares || []).map((square) =>
      squareFromStored(square, 1),
    ),
    ...(board.m_players[1]?.m_squares || []).map((square) =>
      squareFromStored(square, 2),
    ),
  ];

  return {
    board: [...board.m_board],
    scores: [
      board.m_players[0]?.m_score ?? 0,
      board.m_players[1]?.m_score ?? 0,
    ],
    moveNumber: board.m_history?.length ?? 0,
    newSquares: [],
    allSquares,
  };
}

// Validate reconstructed history against the stored result. Missing or
// inconsistent history remains viewable as an opening frame plus final state.
export function buildReplayFrames(board: SerializableBoard): ReplayFrames {
  const emptyFrame: ReplayFrame = {
    board: emptyCells(board.W, board.H),
    scores: [0, 0],
    moveNumber: 0,
    newSquares: [],
    allSquares: [],
  };

  if (!Array.isArray(board.m_history) || board.m_history.length === 0) {
    return [emptyFrame, buildFinalFrame(board)];
  }

  const boardState = emptyCells(board.W, board.H);
  const scores: [number, number] = [0, 0];
  const allSquares = new Map<string, ReplaySquare>();
  const frames: ReplayFrames = [emptyFrame];

  for (const [index, historyPoint] of board.m_history.entries()) {
    const owner: ReplayOwner = ownerForReplayMove(board, index);
    const moveIndex = pointIndex(historyPoint.x, historyPoint.y, board.W);
    const move: ReplayMove = {
      x: historyPoint.x,
      y: historyPoint.y,
      index: moveIndex,
      owner,
    };

    if (move.x < 0 || move.x >= board.W || move.y < 0 || move.y >= board.H) {
      return [emptyFrame, buildFinalFrame(board)];
    }
    if (boardState[moveIndex] !== 0) {
      return [emptyFrame, buildFinalFrame(board)];
    }

    boardState[moveIndex] = owner;
    const newSquares = completedSquares(boardState, board.W, board.H, move);
    for (const square of newSquares) allSquares.set(square.key, square);
    const points = newSquares.reduce((sum, square) => sum + square.points, 0);
    if (owner === 1) scores[0] += points;
    else scores[1] += points;

    frames.push({
      board: [...boardState],
      scores: [scores[0], scores[1]],
      moveNumber: index + 1,
      move,
      newSquares,
      allSquares: [...allSquares.values()],
    });
  }

  const finalScores: [number, number] = [
    board.m_players[0]?.m_score ?? 0,
    board.m_players[1]?.m_score ?? 0,
  ];
  const matchesFinalBoard =
    boardState.length === board.m_board.length &&
    boardState.every((value, index) => value === board.m_board[index]);
  if (
    !matchesFinalBoard ||
    scores[0] !== finalScores[0] ||
    scores[1] !== finalScores[1]
  ) {
    return [emptyFrame, buildFinalFrame(board)];
  }

  return frames;
}

/** Converts one replay frame into the shared board's shapes. */
export function frameShapes(frame: ReplayFrame): {
  squares: BoardSquareShape[];
  markers: BoardMarker[];
} {
  const fresh = new Set(frame.newSquares.map((square) => square.key));
  return {
    squares: [
      ...frame.allSquares
        .filter((square) => !fresh.has(square.key))
        .map((square) => ({ ...square, tone: "history" as const })),
      ...frame.newSquares.map((square) => ({
        ...square,
        key: `${frame.moveNumber}-${square.key}`,
        tone: "fresh" as const,
      })),
    ],
    markers: frame.move
      ? [
          {
            x: frame.move.x,
            y: frame.move.y,
            owner: frame.move.owner,
            kind: "last",
          },
        ]
      : [],
  };
}
