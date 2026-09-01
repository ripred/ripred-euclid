import { playerColorForIndex, type PlayerColor } from "../shared/game/rules";
import { scoreSquareCorners } from "../shared/scoring";
import type {
  SerializableBoard,
  SharePoint,
  ShareSquare,
} from "../shared/types/api";

export type ReplayOwner = PlayerColor;

type ReplayCorner = {
  x: number;
  y: number;
  index: number;
};

type ReplayCorners = [ReplayCorner, ReplayCorner, ReplayCorner, ReplayCorner];

type ReplayMove = SharePoint & {
  owner: ReplayOwner;
};

type ReplaySquare = {
  key: string;
  owner: ReplayOwner;
  points: number;
  corners: ReplayCorners;
};

export type ReplayFrame = {
  board: number[];
  scores: [number, number];
  moveNumber: number;
  move?: ReplayMove;
  newSquares: ReplaySquare[];
  allSquares: ReplaySquare[];
};

export type ReplayFrames = [ReplayFrame, ...ReplayFrame[]];

function pointIndex(x: number, y: number, width: number) {
  return y * width + x;
}

function ownerForReplayMove(
  board: SerializableBoard,
  moveIndex: number,
): ReplayOwner {
  const firstPlayer = board.solo?.rules.firstPlayer === 1 ? 1 : 0;
  const playerIndex =
    moveIndex % 2 === 0 ? firstPlayer : firstPlayer === 0 ? 1 : 0;
  return playerColorForIndex(playerIndex);
}

function orderSquareCorners(corners: ReplayCorners): ReplayCorners {
  const centerX =
    corners.reduce((sum, point) => sum + point.x, 0) / corners.length;
  const centerY =
    corners.reduce((sum, point) => sum + point.y, 0) / corners.length;

  const ordered: ReplayCorners = [...corners];
  ordered.sort((left, right) => {
    const leftAngle = Math.atan2(left.y - centerY, left.x - centerX);
    const rightAngle = Math.atan2(right.y - centerY, right.x - centerX);
    return leftAngle - rightAngle;
  });

  let startIndex = 0;
  let firstPoint = ordered[0];
  for (const [index, point] of ordered.entries()) {
    if (
      point.y < firstPoint.y ||
      (point.y === firstPoint.y && point.x < firstPoint.x)
    ) {
      startIndex = index;
      firstPoint = point;
    }
  }

  const first = ordered[startIndex % 4];
  const second = ordered[(startIndex + 1) % 4];
  const third = ordered[(startIndex + 2) % 4];
  const fourth = ordered[(startIndex + 3) % 4];
  return first && second && third && fourth
    ? [first, second, third, fourth]
    : ordered;
}

function squareKey(corners: ReplayCorner[]) {
  return corners
    .map((point) => point.index)
    .sort((left, right) => left - right)
    .join(",");
}

function computeCompletedSquares(
  board: number[],
  move: ReplayMove,
  width: number,
  height: number,
  scoring: SerializableBoard["scoring"],
): ReplaySquare[] {
  const other = move.owner === 1 ? 2 : 1;
  const seen = new Set<string>();
  const squares: ReplaySquare[] = [];

  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      const dx = col - move.x;
      const dy = row - move.y;
      const x1 = move.x - dy;
      const y1 = move.y + dx;
      const x2 = col - dy;
      const y2 = row + dx;

      if (
        x1 < 0 ||
        x1 >= width ||
        y1 < 0 ||
        y1 >= height ||
        x2 < 0 ||
        x2 >= width ||
        y2 < 0 ||
        y2 >= height ||
        (col === move.x && row === move.y)
      ) {
        continue;
      }

      const corners = orderSquareCorners([
        { x: move.x, y: move.y, index: pointIndex(move.x, move.y, width) },
        { x: col, y: row, index: pointIndex(col, row, width) },
        { x: x1, y: y1, index: pointIndex(x1, y1, width) },
        { x: x2, y: y2, index: pointIndex(x2, y2, width) },
      ]);
      const values = corners.map((point) => board[point.index]);

      if (values.some((value) => value === other || value === 0)) continue;

      const key = squareKey(corners);
      if (seen.has(key)) continue;
      seen.add(key);

      squares.push({
        key,
        owner: move.owner,
        corners,
        points: scoreSquareCorners(corners, scoring),
      });
    }
  }

  return squares;
}

function squareFromStored(
  square: ShareSquare,
  owner: ReplayOwner,
): ReplaySquare {
  const corners = orderSquareCorners([
    { x: square.p1.x, y: square.p1.y, index: square.p1.index },
    { x: square.p2.x, y: square.p2.y, index: square.p2.index },
    { x: square.p3.x, y: square.p3.y, index: square.p3.index },
    { x: square.p4.x, y: square.p4.y, index: square.p4.index },
  ]);
  return {
    key: squareKey(corners),
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
    board: new Array(board.W * board.H).fill(0),
    scores: [0, 0],
    moveNumber: 0,
    newSquares: [],
    allSquares: [],
  };

  if (!Array.isArray(board.m_history) || board.m_history.length === 0) {
    return [emptyFrame, buildFinalFrame(board)];
  }

  const boardState = new Array(board.W * board.H).fill(0);
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
    const newSquares = computeCompletedSquares(
      boardState,
      move,
      board.W,
      board.H,
      board.scoring,
    );
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
