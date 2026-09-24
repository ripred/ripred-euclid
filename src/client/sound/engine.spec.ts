import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createSoundEngine,
  readSoundPreference,
  saveSoundPreference,
  scoreNotes,
} from "./engine";

afterEach(() => vi.unstubAllGlobals());

/** Just enough Web Audio to count the voices each cue schedules. */
function fakeAudio() {
  const started: number[] = [];
  const param = () => ({
    value: 0,
    setValueAtTime: () => undefined,
    linearRampToValueAtTime: () => undefined,
    exponentialRampToValueAtTime: () => undefined,
  });
  const node = () => ({
    gain: param(),
    frequency: param(),
    Q: param(),
    threshold: param(),
    ratio: param(),
    type: "",
    buffer: null,
    connect(next: unknown) {
      return next;
    },
    start: (at: number) => started.push(at),
    stop: () => undefined,
  });
  let resumed = 0;
  class FakeContext {
    currentTime = 10;
    sampleRate = 8000;
    state = "suspended";
    destination = node();
    createGain = node;
    createOscillator = node;
    createBiquadFilter = node;
    createBufferSource = node;
    createDynamicsCompressor = node;
    createBuffer = () => ({ getChannelData: () => new Float32Array(4) });
    resume() {
      resumed++;
      return Promise.resolve();
    }
  }
  vi.stubGlobal("window", { AudioContext: FakeContext });
  return { started, resumed: () => resumed };
}

describe("score notes", () => {
  it("rings longer for bigger scores", () => {
    const small = scoreNotes(4, 1, "mine");
    const big = scoreNotes(16, 1, "mine");
    expect(small).toHaveLength(2);
    expect(big.length).toBeGreaterThan(small.length);
    expect(scoreNotes(10_000, 1, "mine")).toHaveLength(6);
  });

  it("rises for the player and falls for the opponent", () => {
    const mine = scoreNotes(16, 1, "mine").map((note) => note.frequency);
    const theirs = scoreNotes(16, 1, "theirs").map((note) => note.frequency);
    expect(mine).toEqual([...mine].sort((a, b) => a - b));
    expect(theirs).toEqual([...theirs].sort((a, b) => b - a));
  });

  it("adds a top note when one move finishes several squares", () => {
    const single = scoreNotes(9, 1, "mine");
    const double = scoreNotes(9, 2, "mine");
    expect(double).toHaveLength(single.length + 1);
    expect(double.at(-1)?.frequency).toBe((single.at(-1)?.frequency ?? 0) * 2);
  });
});

describe("sound engine", () => {
  it("stays silent until enabled and schedules on the audio clock", () => {
    const audio = fakeAudio();
    const engine = createSoundEngine();
    engine.place(1, "mine");
    expect(audio.started).toHaveLength(0);

    engine.setEnabled(true);
    engine.place(2, "theirs", 0.3);
    expect(audio.started.length).toBeGreaterThan(0);
    expect(audio.started.every((at) => at === 10.3)).toBe(true);
    expect(audio.resumed()).toBeGreaterThan(0);
  });

  it("does nothing where Web Audio is missing", () => {
    vi.stubGlobal("window", {});
    const engine = createSoundEngine();
    engine.setEnabled(true);
    expect(() => {
      engine.unlock();
      engine.place(1, "mine");
      engine.score(16, 2, "mine");
      engine.result("win");
      engine.matchFound();
    }).not.toThrow();
  });
});

describe("sound preference", () => {
  it("defaults to off and remembers the choice", () => {
    const values = new Map<string, string>();
    vi.stubGlobal("window", {
      localStorage: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value),
      },
    });
    expect(readSoundPreference()).toBe(false);
    saveSoundPreference(true);
    expect(readSoundPreference()).toBe(true);
    saveSoundPreference(false);
    expect(readSoundPreference()).toBe(false);
  });

  it("works when browser storage is blocked", () => {
    vi.stubGlobal("window", {
      get localStorage() {
        throw new Error("Blocked");
      },
    });
    expect(readSoundPreference()).toBe(false);
    expect(() => saveSoundPreference(true)).not.toThrow();
  });
});
