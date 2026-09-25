import { useEffect, useState } from "react";

import { buildDemoBoard, DEMO_STEPS } from "./demo/recording";
import { buildReplayFrames, frameShapes } from "./demo/replay-model";
import { BoardDiagram } from "./ui/BoardDiagram";
import {
  blockedSquares,
  boardAspectRatio,
  type BoardMarker,
} from "./ui/board-geometry";
import { Icon } from "./ui/Icon";
import { PageShell } from "./ui/PageShell";
import { ScoreChips } from "./ui/ScoreChips";
import { useReducedMotion } from "./ui/use-reduced-motion";
import "./demo-screen.css";

/* The recorded teaching game, replayed move by move. */
const DEMO_BOARD = buildDemoBoard();
const DEMO_FRAMES = buildReplayFrames(DEMO_BOARD);
const LAST_FRAME = DEMO_FRAMES.length - 1;
const STEP_AT_MOVE = new Map(
  DEMO_STEPS.map((step, index) => [step.after.moveNumber, index]),
);

/* Choreography: quick moves between narrated beats. Each lesson's move is
   announced by a pulse, lands, then holds while its caption is read. */
const FAST_MOVE_MS = 260;
const BEAT_ANTICIPATION_MS = 750;
const BEAT_HOLD_MS = 4200;
const REDUCED_BEAT_HOLD_MS = 5200;

interface Playback {
  frameIndex: number;
  stepIndex: number | null;
  pendingBeat: boolean;
}

const START: Playback = { frameIndex: 0, stepIndex: null, pendingBeat: false };

function advance(playback: Playback): Playback {
  const next = DEMO_FRAMES[playback.frameIndex + 1];
  if (!next) return playback;
  const nextStep = STEP_AT_MOVE.get(next.moveNumber);
  if (playback.pendingBeat) {
    return {
      frameIndex: playback.frameIndex + 1,
      stepIndex: nextStep ?? playback.stepIndex,
      pendingBeat: false,
    };
  }
  return nextStep === undefined
    ? { ...playback, frameIndex: playback.frameIndex + 1 }
    : { ...playback, pendingBeat: true };
}

function DemoCaption({ stepIndex }: { stepIndex: number | null }) {
  const step = stepIndex === null ? null : DEMO_STEPS[stepIndex];
  return (
    <div className="demo-caption" aria-live="polite">
      <p className="eyebrow">
        {step
          ? `Lesson ${stepIndex! + 1} of ${DEMO_STEPS.length}`
          : "A full game, narrated"}
      </p>
      <div className="demo-steps" aria-hidden="true">
        {DEMO_STEPS.map((demoStep, index) => (
          <span
            key={demoStep.id}
            className={
              stepIndex !== null && index <= stepIndex
                ? "demo-steps__pip demo-steps__pip--done"
                : "demo-steps__pip"
            }
          />
        ))}
      </div>
      <div key={step?.id ?? "intro"} className="demo-caption__copy">
        <h2 className="demo-caption__title">
          {step?.title ?? "Watch the board fill up"}
        </h2>
        <p className="demo-caption__body">
          {step?.body ??
            "Red and blue take turns placing one piece each. Every lesson pauses on the move that teaches it."}
        </p>
      </div>
    </div>
  );
}

/** A narrated demo game: the fastest way to see every rule in play. */
export function DemoScreen({
  onPlay,
  onDone,
}: {
  onPlay: () => void;
  onDone: () => void;
}) {
  const reduced = useReducedMotion();
  const [playback, setPlayback] = useState<Playback>(START);
  const [playing, setPlaying] = useState(true);
  const finished = playback.frameIndex >= LAST_FRAME;

  useEffect(() => {
    if (!playing || finished) return;
    const onLesson = STEP_AT_MOVE.has(
      DEMO_FRAMES[playback.frameIndex]!.moveNumber,
    );
    const delay = playback.pendingBeat
      ? reduced
        ? 0
        : BEAT_ANTICIPATION_MS
      : onLesson
        ? reduced
          ? REDUCED_BEAT_HOLD_MS
          : BEAT_HOLD_MS
        : FAST_MOVE_MS;
    const timer = window.setTimeout(() => setPlayback(advance), delay);
    return () => window.clearTimeout(timer);
  }, [finished, playback, playing, reduced]);

  const frame = DEMO_FRAMES[playback.frameIndex]!;
  const shapes = frameShapes(frame);
  const lessonId =
    playback.stepIndex !== null &&
    STEP_AT_MOVE.get(frame.moveNumber) === playback.stepIndex
      ? DEMO_STEPS[playback.stepIndex]?.id
      : undefined;
  // The blocking lesson also shows the square the move denied.
  const squares =
    lessonId === "block" && frame.move
      ? [
          ...shapes.squares,
          ...blockedSquares(
            frame.board,
            DEMO_BOARD.W,
            DEMO_BOARD.H,
            frame.move.x,
            frame.move.y,
            frame.move.owner === 1 ? 2 : 1,
          ).map((corners, index) => ({
            key: `blocked-${index}`,
            owner: (frame.move!.owner === 1 ? 2 : 1) as 1 | 2,
            tone: "blocked" as const,
            corners,
          })),
        ]
      : shapes.squares;
  const next = DEMO_FRAMES[playback.frameIndex + 1];
  const markers: BoardMarker[] =
    playback.pendingBeat && next?.move
      ? [
          {
            x: next.move.x,
            y: next.move.y,
            owner: next.move.owner,
            kind: "pending",
          },
        ]
      : lessonId
        ? shapes.markers
        : [];

  const restart = () => {
    setPlayback(START);
    setPlaying(true);
  };

  return (
    <PageShell
      title="Watch a demo game"
      titleId="demo-title"
      back={{ label: "Home", onClick: onDone }}
      narrow={false}
      className="demo"
    >
      <div className="demo-layout">
        <div
          className="demo-layout__board"
          style={{ aspectRatio: boardAspectRatio(DEMO_BOARD.W, DEMO_BOARD.H) }}
        >
          <BoardDiagram
            width={DEMO_BOARD.W}
            height={DEMO_BOARD.H}
            cells={frame.board}
            squares={squares}
            markers={markers}
            arrivingIndex={frame.move?.index ?? null}
            title={`Demo board after move ${frame.moveNumber} of ${LAST_FRAME}`}
          />
        </div>

        <div className="panel demo-panel">
          <ScoreChips scores={frame.scores} />
          {finished ? (
            <div className="demo-caption" aria-live="polite">
              <p className="eyebrow">Demo complete</p>
              <h2 className="demo-caption__title">Your turn</h2>
              <p className="demo-caption__body">
                That is every rule. Practice lets you pick Euclid's difficulty
                and the board; Ranked puts your rating on the line.
              </p>
            </div>
          ) : (
            <DemoCaption stepIndex={playback.stepIndex} />
          )}
          <div className="demo-progress" aria-hidden="true">
            <span className="num">
              Move {frame.moveNumber} of {LAST_FRAME}
            </span>
            <span className="demo-progress__bar">
              <span
                style={{
                  transform: `scaleX(${frame.moveNumber / LAST_FRAME})`,
                }}
              />
            </span>
          </div>
          <div className="demo-actions">
            {finished ? (
              <button type="button" className="btn" onClick={restart}>
                <Icon name="refresh" size={18} />
                Watch again
              </button>
            ) : (
              <>
                <button
                  type="button"
                  className="btn"
                  aria-pressed={!playing}
                  onClick={() => setPlaying(!playing)}
                >
                  {playing ? "Pause" : "Resume"}
                </button>
                <button
                  type="button"
                  className="btn btn--ghost"
                  onClick={restart}
                >
                  <Icon name="refresh" size={18} />
                  Restart
                </button>
              </>
            )}
            <button
              type="button"
              className="btn btn--primary demo-actions__play"
              onClick={onPlay}
            >
              Play Euclid
              <Icon name="arrow" size={18} />
            </button>
          </div>
        </div>
      </div>
    </PageShell>
  );
}
