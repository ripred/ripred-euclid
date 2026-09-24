import { useEffect, useState } from "react";

import type { SerializableBoard } from "../shared/types/api";
import {
  buildReplayFrames,
  type ReplayFrame,
  type ReplayOwner,
} from "./share-replay-model";

export type ReplayTheme = "dark" | "light";

const replayPalette: Record<
  ReplayTheme,
  {
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
  }
> = {
  dark: {
    cardBg: "#09121f",
    cardBorder: "#294466",
    boardBg:
      "radial-gradient(circle at top, rgba(59,130,246,.12), transparent 44%), rgba(3,12,24,.92)",
    boardLine: "rgba(148,163,184,.18)",
    text: "#cbd5e1",
    muted: "#94a3b8",
    title: "#f8fafc",
    accent: "#93c5fd",
    emptyDot: "rgba(148,163,184,.18)",
    squareBlue: "rgba(59,130,246,.88)",
    squareRed: "rgba(239,68,68,.9)",
  },
  light: {
    cardBg: "#f8fbff",
    cardBorder: "#bfd1e6",
    boardBg:
      "radial-gradient(circle at top, rgba(59,130,246,.08), transparent 40%), rgba(255,255,255,.94)",
    boardLine: "rgba(100,116,139,.18)",
    text: "#334155",
    muted: "#64748b",
    title: "#0f172a",
    accent: "#0369a1",
    emptyDot: "rgba(148,163,184,.18)",
    squareBlue: "rgba(37,99,235,.84)",
    squareRed: "rgba(220,38,38,.86)",
  },
};

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
  const dotColor = owner === 1 ? "#ef4444" : "#3b82f6";

  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        padding: "6px 10px",
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
          borderRadius: "50%",
          background: dotColor,
          boxShadow:
            owner === 1
              ? "0 0 0 4px rgba(239,68,68,.16)"
              : "0 0 0 4px rgba(59,130,246,.16)",
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
  const gap = Math.max(
    18,
    Math.round((compact ? 204 : 280) / Math.max(board.W - 1, board.H - 1, 1)),
  );
  const start = compact ? 20 : 24;
  const viewWidth = start * 2 + gap * (board.W - 1);
  const viewHeight = start * 2 + gap * (board.H - 1);
  const pointAt = (x: number, y: number) => ({
    x: start + x * gap,
    y: start + y * gap,
  });
  const newSquareKeys = new Set(frame.newSquares.map((square) => square.key));
  const priorSquares = frame.allSquares.filter(
    (square) => !newSquareKeys.has(square.key),
  );
  const dotRadius = compact ? 6.25 : 7.25;

  return (
    <div
      style={{
        borderRadius: compact ? 24 : 28,
        border: `1px solid ${palette.cardBorder}`,
        background: palette.boardBg,
        padding: compact ? "12px 12px 10px" : "16px 16px 14px",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "center",
          gap: 8,
          flexWrap: "wrap",
        }}
      >
        <ScorePill
          label="Red"
          score={frame.scores[0]}
          owner={1}
          palette={palette}
        />
        <ScorePill
          label="Blue"
          score={frame.scores[1]}
          owner={2}
          palette={palette}
        />
      </div>

      <svg
        viewBox={`0 0 ${viewWidth} ${viewHeight}`}
        style={{
          width: "100%",
          maxWidth: compact ? 320 : 420,
          height: "auto",
          display: "block",
          margin: compact ? "10px auto 0" : "14px auto 0",
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
            points={square.corners
              .map((corner) => {
                const point = pointAt(corner.x, corner.y);
                return `${point.x},${point.y}`;
              })
              .join(" ")}
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
          const isCurrentMove =
            frame.move?.index === index && frame.move?.owner === owner;

          return (
            <circle
              key={`dot-${index}-${owner}`}
              cx={point.x}
              cy={point.y}
              r={dotRadius}
              fill={owner === 1 ? "#ef4444" : "#3b82f6"}
              stroke="rgba(255,255,255,.18)"
              strokeWidth="1.5"
              style={
                isCurrentMove
                  ? { animation: "shareReplayPlaceDot .7s ease-out both" }
                  : undefined
              }
            />
          );
        })}

        {frame.move ? (
          <circle
            cx={pointAt(frame.move.x, frame.move.y).x}
            cy={pointAt(frame.move.x, frame.move.y).y}
            r={compact ? 15 : 18}
            fill="none"
            stroke={
              frame.move.owner === 1
                ? "rgba(239,68,68,.52)"
                : "rgba(59,130,246,.52)"
            }
            strokeWidth="3"
            style={{ animation: "shareReplayPulse 1.25s ease-in-out infinite" }}
          />
        ) : null}

        {frame.newSquares.map((square) => (
          <polygon
            key={`new-${frame.moveNumber}-${square.key}`}
            points={square.corners
              .map((corner) => {
                const point = pointAt(corner.x, corner.y);
                return `${point.x},${point.y}`;
              })
              .join(" ")}
            fill="none"
            stroke={square.owner === 1 ? palette.squareRed : palette.squareBlue}
            strokeWidth="4.4"
            strokeLinejoin="round"
            strokeLinecap="round"
            pathLength={1}
            strokeDasharray="1"
            strokeDashoffset="1"
            style={{ animation: "shareReplayDrawSquare .7s ease-out forwards" }}
          />
        ))}
      </svg>
    </div>
  );
}

export function ReplayBoardCard({
  board,
  theme = "dark",
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
    const media = window.matchMedia
      ? window.matchMedia("(prefers-reduced-motion: reduce)")
      : null;
    const sync = () => setReduceMotion(Boolean(media?.matches));
    sync();
    if (!media) return;
    if (typeof media.addEventListener === "function")
      media.addEventListener("change", sync);
    else if (typeof media.addListener === "function") media.addListener(sync);
    return () => {
      if (typeof media.removeEventListener === "function")
        media.removeEventListener("change", sync);
      else if (typeof media.removeListener === "function")
        media.removeListener(sync);
    };
  }, []);

  useEffect(() => {
    setFrameIndex(reduceMotion ? Math.max(frames.length - 1, 0) : 0);
  }, [board.m_history?.length, reduceMotion, frames.length]);

  const currentFrame =
    frames[Math.min(frameIndex, frames.length - 1)] ?? frames[0];

  useEffect(() => {
    if (reduceMotion || frames.length <= 1) return;
    const atEnd = frameIndex >= frames.length - 1;
    const delay = atEnd
      ? 2100
      : currentFrame.newSquares.length > 0
        ? 1025
        : 640;
    const timer = window.setTimeout(() => {
      setFrameIndex(atEnd ? 0 : frameIndex + 1);
    }, delay);
    return () => window.clearTimeout(timer);
  }, [currentFrame.newSquares.length, frameIndex, frames.length, reduceMotion]);

  const replayLabel = reduceMotion
    ? "Final board"
    : totalMoves > 0
      ? currentFrame.moveNumber === 0
        ? "Replay starting position"
        : `Move ${currentFrame.moveNumber} of ${totalMoves}`
      : "Final board";
  const replayDetail =
    currentFrame.newSquares.length > 0
      ? `This move completed ${currentFrame.newSquares.length} square${currentFrame.newSquares.length === 1 ? "" : "s"} for ${currentFrame.newSquares.reduce((sum, square) => sum + square.points, 0)} points.`
      : currentFrame.moveNumber === 0
        ? "Watching a passive replay of the real finished game."
        : "No square scored on this move.";

  return (
    <div
      style={{
        borderRadius: compact ? 28 : 30,
        border: `1px solid ${palette.cardBorder}`,
        background: palette.cardBg,
        padding: compact ? "16px 16px 18px" : "18px 18px 20px",
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

      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <div>
          <div
            style={{
              color: palette.accent,
              fontSize: compact ? 12 : 13,
              fontWeight: 800,
              letterSpacing: "0.12em",
            }}
          >
            Real Game Replay
          </div>
          <div
            style={{
              marginTop: 5,
              color: palette.title,
              fontSize: compact ? 17 : 18,
              fontWeight: 800,
            }}
          >
            {replayLabel}
          </div>
        </div>
        <div
          style={{
            color: palette.muted,
            fontSize: compact ? 12 : 13,
            fontWeight: 700,
          }}
        >
          Final {finalScores[0]}-{finalScores[1]}
        </div>
      </div>

      <div
        style={{
          marginTop: 6,
          color: palette.text,
          fontSize: compact ? 13 : 14,
          lineHeight: 1.45,
        }}
      >
        {replayDetail}
      </div>

      <div style={{ marginTop: 14 }}>
        <ReplayBoard
          board={board}
          frame={currentFrame}
          palette={palette}
          compact={compact}
        />
      </div>
    </div>
  );
}
