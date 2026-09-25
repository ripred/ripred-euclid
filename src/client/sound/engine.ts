/*
 * Game sounds, synthesized with Web Audio so nothing is downloaded. Every
 * cue is built from one enveloped tone and one filtered click, scheduled on
 * the audio clock so sequences stay in time whatever the main thread does.
 */

export type SoundOwner = 1 | 2;

/** "mine" is the local player (or anyone, when spectating); "theirs" recedes. */
export type SoundEmphasis = "mine" | "theirs";

export type ResultTone = "win" | "loss" | "neutral";

export interface GameSounds {
  /** A piece meeting the board. Red sits a little lower than blue. */
  place(owner: SoundOwner, emphasis: SoundEmphasis, delay?: number): void;
  /** Completed squares: bigger scores ring longer. */
  score(
    points: number,
    squares: number,
    emphasis: SoundEmphasis,
    delay?: number,
  ): void;
  /** The result dialog arriving. */
  result(tone: ResultTone): void;
  /** Matchmaking paired you with another player. */
  matchFound(): void;
}

export interface SoundEngine extends GameSounds {
  setEnabled(enabled: boolean): void;
  /** Resume audio inside a user gesture; browsers start it suspended. */
  unlock(): void;
}

/** Seconds from a move appearing to its piece landing (see piece-drop). */
export const PIECE_LANDING = 0.3;

const STEP_LIMIT = 6;
const RISING = [523.25, 587.33, 659.25, 783.99, 880, 1046.5]; // C major pentatonic
const FALLING = [440, 392, 329.63, 293.66, 261.63, 220]; // A minor pentatonic
const PIECE_PITCH: Record<SoundOwner, number> = { 1: 220, 2: 261.63 };

export interface ScoreNote {
  frequency: number;
  at: number;
  hold: number;
}

/**
 * The notes for a scoring move. The run grows with the score, so a 16 point
 * square is audibly bigger than a 4, and several squares add a top note.
 */
export function scoreNotes(
  points: number,
  squares: number,
  emphasis: SoundEmphasis,
): ScoreNote[] {
  const steps = Math.min(
    STEP_LIMIT,
    Math.max(2, Math.round(Math.log2(Math.max(0, points) + 1))),
  );
  const scale = emphasis === "mine" ? RISING : FALLING;
  const spacing = emphasis === "mine" ? 0.075 : 0.09;
  const notes = scale.slice(0, steps).map((frequency, index) => ({
    frequency,
    at: index * spacing,
    hold: index === steps - 1 ? 0.9 : 0.4,
  }));
  const last = notes[notes.length - 1];
  if (squares > 1 && last && emphasis === "mine") {
    notes.push({ frequency: last.frequency * 2, at: last.at + 0.08, hold: 1 });
  }
  return notes;
}

type AudioWindow = Window & { webkitAudioContext?: typeof AudioContext };

interface ToneOptions {
  frequency: number;
  at: number;
  hold: number;
  gain: number;
  type?: OscillatorType;
  /** Start this many times higher and settle, like a struck body. */
  glide?: number;
  /** Adds a quiet octave partial for a bell-like ring. */
  bell?: boolean;
  lowpass?: number;
}

export function createSoundEngine(): SoundEngine {
  let enabled = false;
  let context: AudioContext | null = null;
  let output: AudioNode | null = null;
  let noise: AudioBuffer | null = null;

  const audio = (): AudioContext | null => {
    if (context) return context;
    if (typeof window === "undefined") return null;
    const Constructor =
      window.AudioContext ?? (window as AudioWindow).webkitAudioContext;
    if (!Constructor) return null;
    context = new Constructor();
    const master = context.createGain();
    master.gain.value = 0.55;
    const limiter = context.createDynamicsCompressor();
    limiter.threshold.value = -12;
    limiter.ratio.value = 6;
    master.connect(limiter).connect(context.destination);
    output = master;
    noise = context.createBuffer(
      1,
      context.sampleRate * 0.05,
      context.sampleRate,
    );
    const samples = noise.getChannelData(0);
    for (let i = 0; i < samples.length; i++) samples[i] = Math.random() * 2 - 1;
    return context;
  };

  /** The live context and output, only while sound is on and running. */
  const ready = (): [AudioContext, AudioNode] | null => {
    if (!enabled) return null;
    const ctx = audio();
    if (!ctx || !output) return null;
    if (ctx.state === "suspended") void ctx.resume();
    return [ctx, output];
  };

  const tone = (
    ctx: AudioContext,
    destination: AudioNode,
    options: ToneOptions,
  ) => {
    const start = ctx.currentTime + options.at;
    const end = start + options.hold;
    const envelope = ctx.createGain();
    envelope.gain.setValueAtTime(0, start);
    envelope.gain.linearRampToValueAtTime(options.gain, start + 0.005);
    envelope.gain.exponentialRampToValueAtTime(0.0001, end);
    let chain: AudioNode = envelope;
    if (options.lowpass) {
      const filter = ctx.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.value = options.lowpass;
      envelope.connect(filter);
      chain = filter;
    }
    chain.connect(destination);

    const partials = options.bell ? [1, 2] : [1];
    for (const multiple of partials) {
      const oscillator = ctx.createOscillator();
      oscillator.type = options.type ?? "sine";
      const frequency = options.frequency * multiple;
      oscillator.frequency.setValueAtTime(
        frequency * (options.glide ?? 1),
        start,
      );
      if (options.glide) {
        oscillator.frequency.exponentialRampToValueAtTime(
          frequency,
          start + 0.05,
        );
      }
      const partial = ctx.createGain();
      partial.gain.value = multiple === 1 ? 1 : 0.22;
      oscillator.connect(partial).connect(envelope);
      oscillator.start(start);
      oscillator.stop(end + 0.02);
    }
  };

  const click = (
    ctx: AudioContext,
    destination: AudioNode,
    at: number,
    brightness: number,
    gain: number,
  ) => {
    if (!noise) return;
    const start = ctx.currentTime + at;
    const source = ctx.createBufferSource();
    source.buffer = noise;
    const band = ctx.createBiquadFilter();
    band.type = "bandpass";
    band.frequency.value = brightness;
    band.Q.value = 1.4;
    const envelope = ctx.createGain();
    envelope.gain.setValueAtTime(gain, start);
    envelope.gain.exponentialRampToValueAtTime(0.0001, start + 0.035);
    source.connect(band).connect(envelope).connect(destination);
    source.start(start);
    source.stop(start + 0.05);
  };

  const place: GameSounds["place"] = (owner, emphasis, delay = 0) => {
    const live = ready();
    if (!live) return;
    const [ctx, out] = live;
    const mine = emphasis === "mine";
    click(ctx, out, delay, mine ? 2600 : 1900, mine ? 0.5 : 0.3);
    tone(ctx, out, {
      frequency: PIECE_PITCH[owner],
      at: delay,
      hold: 0.16,
      gain: mine ? 0.42 : 0.26,
      glide: 2,
    });
    tone(ctx, out, {
      frequency: PIECE_PITCH[owner] * 3,
      at: delay,
      hold: 0.07,
      gain: mine ? 0.1 : 0.05,
      type: "triangle",
    });
  };

  const score: GameSounds["score"] = (points, squares, emphasis, delay = 0) => {
    const live = ready();
    if (!live) return;
    const [ctx, out] = live;
    const mine = emphasis === "mine";
    for (const note of scoreNotes(points, squares, emphasis)) {
      tone(ctx, out, {
        frequency: note.frequency,
        at: delay + note.at,
        hold: note.hold,
        gain: mine ? 0.2 : 0.13,
        bell: mine,
        type: mine ? "sine" : "triangle",
        ...(mine ? {} : { lowpass: 1800 }),
      });
    }
  };

  const RESULT_PHRASES: Record<ResultTone, ScoreNote[]> = {
    win: [
      { frequency: 523.25, at: 0, hold: 0.35 },
      { frequency: 659.25, at: 0.11, hold: 0.35 },
      { frequency: 783.99, at: 0.22, hold: 0.35 },
      { frequency: 523.25, at: 0.36, hold: 1.3 },
      { frequency: 659.25, at: 0.36, hold: 1.3 },
      { frequency: 1046.5, at: 0.36, hold: 1.4 },
    ],
    loss: [
      { frequency: 392, at: 0, hold: 0.45 },
      { frequency: 329.63, at: 0.2, hold: 0.45 },
      { frequency: 261.63, at: 0.4, hold: 1 },
    ],
    neutral: [
      { frequency: 392, at: 0, hold: 0.5 },
      { frequency: 523.25, at: 0.16, hold: 0.9 },
    ],
  };

  const result: GameSounds["result"] = (resultTone) => {
    const live = ready();
    if (!live) return;
    const [ctx, out] = live;
    const bright = resultTone === "win";
    for (const note of RESULT_PHRASES[resultTone]) {
      tone(ctx, out, {
        ...note,
        gain: bright ? 0.16 : 0.13,
        bell: bright,
        type: bright ? "sine" : "triangle",
        ...(bright ? {} : { lowpass: 1600 }),
      });
    }
  };

  // Two pieces meet the board, then a bright call to the table.
  const matchFound: GameSounds["matchFound"] = () => {
    place(1, "mine");
    place(2, "mine", 0.1);
    const live = ready();
    if (!live) return;
    const [ctx, out] = live;
    for (const [index, frequency] of [783.99, 1046.5].entries()) {
      tone(ctx, out, {
        frequency,
        at: 0.26 + index * 0.1,
        hold: 0.6,
        gain: 0.16,
        bell: true,
      });
    }
  };

  return {
    setEnabled(next) {
      enabled = next;
    },
    unlock() {
      const ctx = audio();
      if (ctx?.state === "suspended") void ctx.resume();
    },
    place,
    score,
    result,
    matchFound,
  };
}

/** Cues that do nothing: the default outside the game shell and in tests. */
export const SILENT_SOUNDS: GameSounds = {
  place: () => undefined,
  score: () => undefined,
  result: () => undefined,
  matchFound: () => undefined,
};

const SOUND_KEY = "euclid_sound_on";

export function readSoundPreference(): boolean {
  try {
    return window.localStorage.getItem(SOUND_KEY) === "on";
  } catch {
    return false;
  }
}

export function saveSoundPreference(on: boolean): void {
  try {
    window.localStorage.setItem(SOUND_KEY, on ? "on" : "off");
  } catch {
    // Restricted browser storage must not prevent toggling sound.
  }
}
