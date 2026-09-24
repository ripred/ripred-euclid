import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
} from "react";

import type { ScoreFeedbackEvent } from "../score-feedback";
import {
  PIECE_LANDING,
  SILENT_SOUNDS,
  type GameSounds,
  type SoundEmphasis,
  type SoundOwner,
} from "./engine";

export const SoundContext = createContext<GameSounds>(SILENT_SOUNDS);

export function useSounds(): GameSounds {
  return useContext(SoundContext);
}

/** Replays more than this in one update read as a resync, not moves. */
const AUDIBLE_BATCH = 3;
const BATCH_SPACING = 0.11;
/** Repeated taps on one move make one sound. */
const TAP_DEBOUNCE_MS = 300;

const emphasisFor = (
  owner: SoundOwner,
  localSide: SoundOwner | null,
): SoundEmphasis =>
  localSide === null || owner === localSide ? "mine" : "theirs";

interface BoardSoundInput {
  history: readonly { x: number; y: number }[];
  cells: readonly number[];
  width: number;
  localSide: SoundOwner | null;
  feedback: ScoreFeedbackEvent | null;
}

/**
 * Board sounds follow what the player sees: their own tap clicks at once,
 * other pieces click as they land, and squares ring after the piece.
 */
export function useBoardSounds(
  input: BoardSoundInput,
): (owner: SoundOwner) => void {
  const sounds = useSounds();
  // Effects key on the move count and feedback id; the board object itself
  // is rebuilt on every poll, so the rest is read from the latest render.
  const latestRef = useRef({ ...input, sounds });
  useLayoutEffect(() => {
    latestRef.current = { ...input, sounds };
  });
  const seenRef = useRef<number | null>(null);
  const tapPendingRef = useRef(false);
  const lastTapRef = useRef(-Infinity);

  const moveCount = input.history.length;
  useEffect(() => {
    const { history, cells, width, localSide, sounds } = latestRef.current;
    const seen = seenRef.current;
    seenRef.current = moveCount;
    // The first board and any reset are a baseline, not moves.
    if (seen === null || moveCount <= seen) return;
    // The player's own tap already clicked; only the rest sound on landing.
    let skipOwnTap = tapPendingRef.current;
    tapPendingRef.current = false;
    const owners = history
      .slice(seen)
      .map((point) => cells[point.y * width + point.x])
      .filter((owner): owner is SoundOwner => owner === 1 || owner === 2)
      .filter((owner) => {
        if (!skipOwnTap || owner !== localSide) return true;
        skipOwnTap = false;
        return false;
      })
      .slice(-AUDIBLE_BATCH);
    owners.forEach((owner, index) => {
      sounds.place(
        owner,
        emphasisFor(owner, localSide),
        PIECE_LANDING + index * BATCH_SPACING,
      );
    });
  }, [moveCount]);

  // Each feedback event rings once, when it becomes the one shown.
  const feedbackId = input.feedback?.id ?? null;
  useEffect(() => {
    const { feedback, localSide, sounds } = latestRef.current;
    if (!feedbackId || !feedback) return;
    const owner: SoundOwner = feedback.player === 0 ? 1 : 2;
    sounds.score(
      feedback.pointsScored,
      feedback.completedSquares.length,
      emphasisFor(owner, localSide),
      PIECE_LANDING + 0.1,
    );
  }, [feedbackId]);

  return useCallback(
    (owner: SoundOwner) => {
      const now = performance.now();
      if (now - lastTapRef.current < TAP_DEBOUNCE_MS) return;
      lastTapRef.current = now;
      tapPendingRef.current = true;
      sounds.place(owner, "mine");
    },
    [sounds],
  );
}
