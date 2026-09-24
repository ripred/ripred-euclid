import { useEffect, useState } from "react";

import type { SerializableBoard } from "../shared/types/api";
import { buildReplayFrames, frameShapes } from "./share-replay-model";
import { BoardDiagram, PieceGlyph } from "./ui/BoardDiagram";
import { boardAspectRatio } from "./ui/board-geometry";
import { useReducedMotion } from "./ui/use-reduced-motion";
import "./share-replay.css";

export type ReplayTheme = "dark" | "light";

export function ScoreChips({
  scores,
  labels = ["Red", "Blue"],
}: {
  scores: readonly [number, number];
  labels?: readonly [string, string];
}) {
  return (
    <div className="score-chips">
      {([1, 2] as const).map((owner) => (
        <span key={owner} className="score-chip">
          <PieceGlyph owner={owner} size={16} />
          <span className="score-chip__label">{labels[owner - 1]}</span>
          <span className="score-chip__value num">{scores[owner - 1]}</span>
        </span>
      ))}
    </div>
  );
}

export function ReplayBoardCard({
  board,
  theme = "dark",
  compact = false,
  kind = "replay",
}: {
  board: SerializableBoard;
  theme?: ReplayTheme;
  compact?: boolean;
  kind?: "replay" | "demo";
}) {
  const frames = buildReplayFrames(board);
  const isDemo = kind === "demo";
  const totalMoves = Math.max(0, frames.length - 1);
  const finalScores: [number, number] = [
    board.m_players[0]?.m_score ?? 0,
    board.m_players[1]?.m_score ?? 0,
  ];
  const reduceMotion = useReducedMotion();
  const [frameIndex, setFrameIndex] = useState(0);

  useEffect(() => {
    setFrameIndex(reduceMotion ? Math.max(frames.length - 1, 0) : 0);
  }, [board.m_history?.length, reduceMotion, frames.length]);

  const currentFrame =
    frames[Math.min(frameIndex, frames.length - 1)] ?? frames[0];

  // Scoring moves hold longer so the square has time to land.
  useEffect(() => {
    if (reduceMotion || frames.length <= 1) return;
    const atEnd = frameIndex >= frames.length - 1;
    const delay = atEnd
      ? 2400
      : currentFrame.newSquares.length > 0
        ? 1400
        : 640;
    const timer = window.setTimeout(() => {
      setFrameIndex(atEnd ? 0 : frameIndex + 1);
    }, delay);
    return () => window.clearTimeout(timer);
  }, [currentFrame.newSquares.length, frameIndex, frames.length, reduceMotion]);

  // The tutorial uses the same renderer, but never claims a real match or win.
  const endLabel = isDemo ? "Demo overview" : "Final board";
  const replayLabel = reduceMotion
    ? endLabel
    : totalMoves > 0
      ? currentFrame.moveNumber === 0
        ? `${isDemo ? "Demo" : "Replay"} starting position`
        : `Move ${currentFrame.moveNumber} of ${totalMoves}`
      : endLabel;
  const scored = currentFrame.newSquares.reduce(
    (sum, square) => sum + square.points,
    0,
  );
  const replayDetail =
    currentFrame.newSquares.length > 0
      ? `This move completed ${currentFrame.newSquares.length} square${currentFrame.newSquares.length === 1 ? "" : "s"} for ${scored} points.`
      : currentFrame.moveNumber === 0
        ? isDemo
          ? "Watching a recorded teaching demo, not a live match."
          : "Watching a passive replay of the real finished game."
        : "No square scored on this move.";
  const { squares, markers } = frameShapes(currentFrame);
  const progress = totalMoves > 0 ? currentFrame.moveNumber / totalMoves : 1;

  return (
    <div
      className={`replay${compact ? " replay--compact" : ""}`}
      data-theme={theme}
    >
      <div className="replay__head">
        <div>
          <p className="eyebrow">
            {isDemo ? "Teaching demo" : "Real game replay"}
          </p>
          <p className="replay__label">{replayLabel}</p>
        </div>
        <p className="replay__final num">
          {isDemo ? "Demo total" : "Final"} {finalScores[0]}-{finalScores[1]}
        </p>
      </div>
      <p className="replay__detail">{replayDetail}</p>
      <div className="replay__progress" aria-hidden="true">
        <span style={{ transform: `scaleX(${progress})` }} />
      </div>
      <ScoreChips scores={currentFrame.scores} />
      <div
        className="replay__board"
        style={{
          aspectRatio: boardAspectRatio(board.W, board.H),
        }}
      >
        <BoardDiagram
          width={board.W}
          height={board.H}
          cells={currentFrame.board}
          squares={squares}
          markers={markers}
          arrivingIndex={currentFrame.move?.index ?? null}
        />
      </div>
    </div>
  );
}
