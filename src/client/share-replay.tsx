import { useEffect, useState } from 'react';

import type {
  SerializableBoard,
  SharePoint,
  ShareSquare,
} from '../shared/types/api';

export type ReplayTheme = 'dark' | 'light';

type ReplayOwner = 1 | 2;

type ReplayCorner = {
  x: number;
  y: number;
  index: number;
};

type ReplayMove = SharePoint & {
  owner: ReplayOwner;
};

type ReplaySquare = {
  key: string;
  owner: ReplayOwner;
  points: number;
  corners: ReplayCorner[];
};

type ReplayFrame = {
  board: number[];
  scores: [number, number];
  moveNumber: number;
  move?: ReplayMove;
  newSquares: ReplaySquare[];
  allSquares: ReplaySquare[];
};

const replayPalette: Record<ReplayTheme, {
  cardBg: string;
  cardBorder: string;
  boardBg: string;
  boardLine: string;
  text: string;
  muted: string;
  title: string;
  accent: string;
  emptyDot: string;
  squareBlue: string;
  squareRed: string;
}> = {
  dark: {
    cardBg: '#09121f',
    cardBorder: '#294466',
    boardBg: 'radial-gradient(circle at top, rgba(59,130,246,.12), transparent 44%), rgba(3,12,24,.92)',
    boardLine: 'rgba(148,163,184,.18)',
    text: '#cbd5e1',
    muted: '#94a3b8',
    title: '#f8fafc',
    accent: '#93c5fd',
    emptyDot: 'rgba(148,163,184,.18)',
    squareBlue: 'rgba(59,130,246,.88)',
    squareRed: 'rgba(239,68,68,.9)',
  },
  light: {
    cardBg: '#f8fbff',
    cardBorder: '#bfd1e6',
    boardBg: 'radial-gradient(circle at top, rgba(59,130,246,.08), transparent 40%), rgba(255,255,255,.94)',
    boardLine: 'rgba(100,116,139,.18)',
    text: '#334155',
    muted: '#64748b',
    title: '#0f172a',
    accent: '#0369a1',
    emptyDot: 'rgba(148,163,184,.18)',
    squareBlue: 'rgba(37,99,235,.84)',
    squareRed: 'rgba(220,38,38,.86)',
  },
};

function pointIndex(x: number, y: number, width: number) {
  return y * width + x;
}

function orderSquareCorners(corners: ReplayCorner[]): ReplayCorner[] {
  const centerX = corners.reduce((sum, point) => sum + point.x, 0) / corners.length;
  const centerY = corners.reduce((sum, point) => sum + point.y, 0) / corners.length;

  const ordered = [...corners].sort((left, right) => {
    const leftAngle = Math.atan2(left.y - centerY, left.x - centerX);
    const rightAngle = Math.atan2(right.y - centerY, right.x - centerX);
    return leftAngle - rightAngle;
  });

  let startIndex = 0;
  for (let index = 1; index < ordered.length; index++) {
    const point = ordered[index];
    const current = ordered[startIndex];
    if (point.y < current.y || (point.y === current.y && point.x < current.x)) {
      startIndex = index;
    }
  }

  return ordered.slice(startIndex).concat(ordered.slice(0, startIndex));
}

function squareKey(corners: ReplayCorner[]) {
  return corners
    .map((point) => point.index)
    .sort((left, right) => left - right)
    .join(',');
}

function scoreSquare(corners: ReplayCorner[], scoring: SerializableBoard['scoring']) {
  if (scoring === 'bbox') {
    const xs = corners.map((point) => point.x);
    const ys = corners.map((point) => point.y);
    return (Math.max(...xs) - Math.min(...xs) + 1) * (Math.max(...ys) - Math.min(...ys) + 1);
  }

  let minDistanceSquared = Infinity;
  for (let i = 0; i < corners.length; i++) {
    for (let j = i + 1; j < corners.length; j++) {
      const dx = corners[i].x - corners[j].x;
      const dy = corners[i].y - corners[j].y;
      const distanceSquared = dx * dx + dy * dy;
      if (distanceSquared > 0 && distanceSquared < minDistanceSquared) {
        minDistanceSquared = distanceSquared;
      }
    }
  }

  return Number.isFinite(minDistanceSquared) ? minDistanceSquared : 0;
}

function computeCompletedSquares(
  board: number[],
  move: ReplayMove,
  width: number,
  height: number,
  scoring: SerializableBoard['scoring'],
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
        x1 < 0 || x1 >= width ||
        y1 < 0 || y1 >= height ||
        x2 < 0 || x2 >= width ||
        y2 < 0 || y2 >= height ||
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
        points: scoreSquare(corners, scoring),
      });
    }
  }

  return squares;
}

function squareFromStored(square: ShareSquare, owner: ReplayOwner): ReplaySquare {
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
    ...(board.m_players[0]?.m_squares || []).map((square) => squareFromStored(square, 1)),
    ...(board.m_players[1]?.m_squares || []).map((square) => squareFromStored(square, 2)),
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

function buildReplayFrames(board: SerializableBoard): ReplayFrame[] {
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
  const frames: ReplayFrame[] = [emptyFrame];

  for (let index = 0; index < board.m_history.length; index++) {
    const historyPoint = board.m_history[index];
    const owner: ReplayOwner = index % 2 === 0 ? 1 : 2;
    const moveIndex = historyPoint.index >= 0 ? historyPoint.index : pointIndex(historyPoint.x, historyPoint.y, board.W);
    const move: ReplayMove = { ...historyPoint, index: moveIndex, owner };

    if (move.x < 0 || move.x >= board.W || move.y < 0 || move.y >= board.H) {
      return [emptyFrame, buildFinalFrame(board)];
    }
    if (boardState[moveIndex] !== 0) {
      return [emptyFrame, buildFinalFrame(board)];
    }

    boardState[moveIndex] = owner;
    const newSquares = computeCompletedSquares(boardState, move, board.W, board.H, board.scoring);
    for (const square of newSquares) allSquares.set(square.key, square);
    scores[owner - 1] += newSquares.reduce((sum, square) => sum + square.points, 0);

    frames.push({
      board: [...boardState],
      scores: [...scores] as [number, number],
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
  const matchesFinalBoard = boardState.length === board.m_board.length
    && boardState.every((value, index) => value === board.m_board[index]);
  if (!matchesFinalBoard || scores[0] !== finalScores[0] || scores[1] !== finalScores[1]) {
    return [emptyFrame, buildFinalFrame(board)];
  }

  return frames;
}

function ScorePill({
  label,
  score,
  owner,
  palette,
}: {
  label: string;
  score: number;
  owner: ReplayOwner;
  palette: typeof replayPalette.dark;
}) {
  const dotColor = owner === 1 ? '#ef4444' : '#3b82f6';

  return (
    <div
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 8,
        padding: '6px 10px',
        borderRadius: 999,
        border: `1px solid ${palette.cardBorder}`,
        background: palette.cardBg,
        color: palette.text,
        fontSize: 13,
        fontWeight: 700,
      }}
    >
      <span
        style={{
          width: 10,
          height: 10,
          borderRadius: '50%',
          background: dotColor,
          boxShadow: owner === 1 ? '0 0 0 4px rgba(239,68,68,.16)' : '0 0 0 4px rgba(59,130,246,.16)',
        }}
      />
      <span>{label}</span>
      <span style={{ color: palette.title }}>{score}</span>
    </div>
  );
}

function ReplayBoard({
  board,
  frame,
  palette,
  compact,
}: {
  board: SerializableBoard;
  frame: ReplayFrame;
  palette: typeof replayPalette.dark;
  compact: boolean;
}) {
  const gap = Math.max(18, Math.round((compact ? 204 : 280) / Math.max(board.W - 1, board.H - 1, 1)));
  const start = compact ? 20 : 24;
  const viewWidth = start * 2 + gap * (board.W - 1);
  const viewHeight = start * 2 + gap * (board.H - 1);
  const pointAt = (x: number, y: number) => ({
    x: start + x * gap,
    y: start + y * gap,
  });
  const newSquareKeys = new Set(frame.newSquares.map((square) => square.key));
  const priorSquares = frame.allSquares.filter((square) => !newSquareKeys.has(square.key));
  const dotRadius = compact ? 6.25 : 7.25;

  return (
    <div
      style={{
        borderRadius: compact ? 24 : 28,
        border: `1px solid ${palette.cardBorder}`,
        background: palette.boardBg,
        padding: compact ? '12px 12px 10px' : '16px 16px 14px',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'center', gap: 8, flexWrap: 'wrap' }}>
        <ScorePill label="Red" score={frame.scores[0]} owner={1} palette={palette} />
        <ScorePill label="Blue" score={frame.scores[1]} owner={2} palette={palette} />
      </div>

      <svg
        viewBox={`0 0 ${viewWidth} ${viewHeight}`}
        style={{
          width: '100%',
          maxWidth: compact ? 320 : 420,
          height: 'auto',
          display: 'block',
          margin: compact ? '10px auto 0' : '14px auto 0',
        }}
      >
        {Array.from({ length: board.W }).map((_, col) => {
          const top = pointAt(col, 0);
          const bottom = pointAt(col, board.H - 1);
          return (
            <line
              key={`col-${col}`}
              x1={top.x}
              y1={top.y}
              x2={bottom.x}
              y2={bottom.y}
              stroke={palette.boardLine}
              strokeWidth="1"
            />
          );
        })}
        {Array.from({ length: board.H }).map((_, row) => {
          const left = pointAt(0, row);
          const right = pointAt(board.W - 1, row);
          return (
            <line
              key={`row-${row}`}
              x1={left.x}
              y1={left.y}
              x2={right.x}
              y2={right.y}
              stroke={palette.boardLine}
              strokeWidth="1"
            />
          );
        })}

        {priorSquares.map((square) => (
          <polygon
            key={`prior-${square.key}`}
            points={square.corners.map((corner) => {
              const point = pointAt(corner.x, corner.y);
              return `${point.x},${point.y}`;
            }).join(' ')}
            fill="none"
            stroke={square.owner === 1 ? palette.squareRed : palette.squareBlue}
            strokeWidth="2.4"
            strokeOpacity="0.48"
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        ))}

        {frame.board.map((owner, index) => {
          if (owner !== 1 && owner !== 2) return null;
          const x = index % board.W;
          const y = Math.floor(index / board.W);
          const point = pointAt(x, y);
          const isCurrentMove = frame.move?.index === index && frame.move?.owner === owner;

          return (
            <circle
              key={`dot-${index}-${owner}`}
              cx={point.x}
              cy={point.y}
              r={dotRadius}
              fill={owner === 1 ? '#ef4444' : '#3b82f6'}
              stroke="rgba(255,255,255,.18)"
              strokeWidth="1.5"
              style={isCurrentMove ? { animation: 'shareReplayPlaceDot .7s ease-out both' } : undefined}
            />
          );
        })}

        {frame.move ? (
          <circle
            cx={pointAt(frame.move.x, frame.move.y).x}
            cy={pointAt(frame.move.x, frame.move.y).y}
            r={compact ? 15 : 18}
            fill="none"
            stroke={frame.move.owner === 1 ? 'rgba(239,68,68,.52)' : 'rgba(59,130,246,.52)'}
            strokeWidth="3"
            style={{ animation: 'shareReplayPulse 1.25s ease-in-out infinite' }}
          />
        ) : null}

        {frame.newSquares.map((square) => (
          <polygon
            key={`new-${frame.moveNumber}-${square.key}`}
            points={square.corners.map((corner) => {
              const point = pointAt(corner.x, corner.y);
              return `${point.x},${point.y}`;
            }).join(' ')}
            fill="none"
            stroke={square.owner === 1 ? palette.squareRed : palette.squareBlue}
            strokeWidth="4.4"
            strokeLinejoin="round"
            strokeLinecap="round"
            pathLength={1}
            strokeDasharray="1"
            strokeDashoffset="1"
            style={{ animation: 'shareReplayDrawSquare .7s ease-out forwards' }}
          />
        ))}
      </svg>
    </div>
  );
}

export function ReplayBoardCard({
  board,
  theme = 'dark',
  compact = false,
}: {
  board: SerializableBoard;
  theme?: ReplayTheme;
  compact?: boolean;
}) {
  const palette = replayPalette[theme];
  const frames = buildReplayFrames(board);
  const totalMoves = Math.max(0, frames.length - 1);
  const finalScores: [number, number] = [
    board.m_players[0]?.m_score ?? 0,
    board.m_players[1]?.m_score ?? 0,
  ];
  const [reduceMotion, setReduceMotion] = useState(false);
  const [frameIndex, setFrameIndex] = useState(0);

  useEffect(() => {
    const media = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
    const sync = () => setReduceMotion(Boolean(media?.matches));
    sync();
    if (!media) return;
    if (typeof media.addEventListener === 'function') media.addEventListener('change', sync);
    else if (typeof media.addListener === 'function') media.addListener(sync);
    return () => {
      if (typeof media.removeEventListener === 'function') media.removeEventListener('change', sync);
      else if (typeof media.removeListener === 'function') media.removeListener(sync);
    };
  }, []);

  useEffect(() => {
    setFrameIndex(reduceMotion ? Math.max(frames.length - 1, 0) : 0);
  }, [board.m_history?.length, reduceMotion, frames.length]);

  const currentFrame = frames[Math.min(frameIndex, frames.length - 1)] ?? frames[0];

  useEffect(() => {
    if (reduceMotion || frames.length <= 1) return;
    const atEnd = frameIndex >= frames.length - 1;
    const delay = atEnd ? 2100 : currentFrame.newSquares.length > 0 ? 1025 : 640;
    const timer = window.setTimeout(() => {
      setFrameIndex(atEnd ? 0 : frameIndex + 1);
    }, delay);
    return () => window.clearTimeout(timer);
  }, [currentFrame.newSquares.length, frameIndex, frames.length, reduceMotion]);

  const replayLabel = reduceMotion
    ? 'Final board'
    : totalMoves > 0
      ? currentFrame.moveNumber === 0
        ? 'Replay starting position'
        : `Move ${currentFrame.moveNumber} of ${totalMoves}`
      : 'Final board';
  const replayDetail = currentFrame.newSquares.length > 0
    ? `This move completed ${currentFrame.newSquares.length} square${currentFrame.newSquares.length === 1 ? '' : 's'} for ${currentFrame.newSquares.reduce((sum, square) => sum + square.points, 0)} points.`
    : currentFrame.moveNumber === 0
      ? 'Watching a passive replay of the real finished game.'
      : 'No square scored on this move.';

  return (
    <div
      style={{
        borderRadius: compact ? 28 : 30,
        border: `1px solid ${palette.cardBorder}`,
        background: palette.cardBg,
        padding: compact ? '16px 16px 18px' : '18px 18px 20px',
      }}
    >
      <style>{`
        @keyframes shareReplayPulse {
          0%, 100% { transform: scale(.88); opacity: .36; }
          50% { transform: scale(1.05); opacity: 1; }
        }
        @keyframes shareReplayPlaceDot {
          0% { opacity: 0; transform: scale(.2); }
          70% { opacity: 1; transform: scale(1.16); }
          100% { opacity: 1; transform: scale(1); }
        }
        @keyframes shareReplayDrawSquare {
          to { stroke-dashoffset: 0; }
        }
      `}</style>

      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <div style={{ color: palette.accent, fontSize: compact ? 12 : 13, fontWeight: 800, letterSpacing: '0.12em', textTransform: 'uppercase' }}>
            Real Game Replay
          </div>
          <div style={{ marginTop: 5, color: palette.title, fontSize: compact ? 17 : 18, fontWeight: 800 }}>
            {replayLabel}
          </div>
        </div>
        <div style={{ color: palette.muted, fontSize: compact ? 12 : 13, fontWeight: 700 }}>
          Final {finalScores[0]}-{finalScores[1]}
        </div>
      </div>

      <div style={{ marginTop: 6, color: palette.text, fontSize: compact ? 13 : 14, lineHeight: 1.45 }}>
        {replayDetail}
      </div>

      <div style={{ marginTop: 14 }}>
        <ReplayBoard board={board} frame={currentFrame} palette={palette} compact={compact} />
      </div>
    </div>
  );
}
