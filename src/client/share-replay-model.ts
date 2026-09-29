import { playerColorForIndex, type PlayerColor } from "../shared/game/rules";
import { Board, Player } from "../shared/game/engine";
import { orderSquareCorners, pointIndex } from "../shared/game/geometry";
import {
  cloneSquare,
  squareIndexKey,
  squarePoints,
} from "../shared/share-squares";
import type { CompletedSquare } from "./completed-squares";
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
  tide?: SerializableBoard["tide"];
  board: number[];
  scores: [number, number];
  moveNumber: number;
  move?: ReplayMove;
  newSquares: ReplaySquare[];
  allSquares: ReplaySquare[];
};

export type ReplayFrames = [ReplayFrame, ...ReplayFrame[]];

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
    ...(board.variant === "tide" && board.tide
      ? {
          tide: {
            expires: [...board.tide.expires],
            anchored: [...board.tide.anchored],
          },
        }
      : {}),
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

/** Replay confirmed moves through the same rules used for live games. */
export function buildReplayFrames(board: SerializableBoard): ReplayFrames {
  const engine = new Board(new Player(), new Player(), {
    W: board.W,
    H: board.H,
    winScore: board.winScore,
    variant: board.variant ?? "standard",
    rng: () => 0,
  });
  engine.m_turn = board.solo?.rules.firstPlayer === 1 ? 1 : 0;
  const frames: ReplayFrames = [buildFinalFrame(engine.toJSON())];
  const fallback = (): ReplayFrames => [frames[0], buildFinalFrame(board)];
  // Incomplete or inconsistent recordings remain viewable as a final state.
  if (!Array.isArray(board.m_history) || board.m_history.length === 0)
    return fallback();
  for (const [index, point] of board.m_history.entries()) {
    const moveIndex = pointIndex(point.x, point.y, board.W);
    if (
      !Number.isInteger(point.x) ||
      !Number.isInteger(point.y) ||
      point.x < 0 ||
      point.x >= board.W ||
      point.y < 0 ||
      point.y >= board.H ||
      engine.m_board[moveIndex] !== 0
    )
      return fallback();
    const owner = playerColorForIndex(engine.m_turn);
    const previousSquares = engine.m_players[engine.m_turn].m_squares.length;
    engine.placePiece(engine.pointAt(point.x, point.y));
    if (engine.m_history.length !== index + 1) return fallback();
    const serialized = engine.toJSON();
    const frame = buildFinalFrame(serialized);
    frame.move = { ...point, index: moveIndex, owner };
    frame.newSquares = engine.m_players[engine.m_turn].m_squares
      .slice(previousSquares)
      .map((square) => squareFromStored(square, owner));
    frames.push(frame);
    engine.advanceTurn();
  }
  const last = frames[frames.length - 1]!;
  if (
    last.board.length !== board.m_board.length ||
    last.board.some((owner, index) => owner !== board.m_board[index]) ||
    last.scores.some(
      (score, index) => score !== board.m_players[index]?.m_score,
    )
  )
    return fallback();
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
