import { describe, expect, it } from "vitest";

import {
  calculateBoardLayout,
  getH2HExitAction,
  getH2HResultPresentation,
  isLocalVictory,
  shouldRunVictoryEffects,
  shouldAdoptH2HState,
} from "./game-ui";

describe("isLocalVictory", () => {
  it("celebrates only the winning participant", () => {
    expect(isLocalVictory(1, 1, false)).toBe(true);
    expect(isLocalVictory(2, 2, false)).toBe(true);
    expect(isLocalVictory(1, 2, false)).toBe(false);
    expect(isLocalVictory(2, 1, false)).toBe(false);
  });

  it("never celebrates a tie, missing local side, or spectator", () => {
    expect(isLocalVictory(null, 1, false)).toBe(false);
    expect(isLocalVictory(1, null, false)).toBe(false);
    expect(isLocalVictory(1, 1, true)).toBe(false);
    expect(isLocalVictory(2, 2, true)).toBe(false);
  });
});

describe("shouldRunVictoryEffects", () => {
  it("allows effects only for a terminal local victory", () => {
    expect(shouldRunVictoryEffects(true, true)).toBe(true);
    expect(shouldRunVictoryEffects(true, false)).toBe(false);
    expect(shouldRunVictoryEffects(false, true)).toBe(false);
    expect(shouldRunVictoryEffects(false, false)).toBe(false);
  });
});

describe("getH2HExitAction", () => {
  it("keeps spectator exit local and participant leave server-backed", () => {
    expect(getH2HExitAction(true)).toEqual({
      label: "Stop Watching",
      notifyServer: false,
    });
    expect(getH2HExitAction(false)).toEqual({
      label: "Leave Game",
      notifyServer: true,
    });
  });
});

describe("shouldAdoptH2HState", () => {
  it("rejects responses for a closed or different game", () => {
    expect(shouldAdoptH2HState(null, 0, "game-a", 0)).toBe(false);
    expect(shouldAdoptH2HState("game-a", 2, "game-b", 3)).toBe(false);
  });

  it("prevents an older poll response from rolling canonical state back", () => {
    expect(shouldAdoptH2HState("game-a", 3, "game-a", 2)).toBe(false);
    expect(shouldAdoptH2HState("game-a", 3, "game-a", 3)).toBe(true);
    expect(shouldAdoptH2HState("game-a", 3, "game-a", 4)).toBe(true);
  });

  it("accepts a legacy response without revision only for the active game", () => {
    expect(shouldAdoptH2HState("game-a", 3, undefined, undefined)).toBe(true);
  });
});

describe("getH2HResultPresentation", () => {
  it("uses participant-relative copy only for the local winner", () => {
    expect(getH2HResultPresentation(1, 1, false, "Ada", "Grace")).toEqual({
      headline: "You Win!",
      isLocalVictory: true,
    });
    expect(getH2HResultPresentation(2, 1, false, "Ada", "Grace")).toEqual({
      headline: "Grace Wins!",
      isLocalVictory: false,
    });
  });

  it("uses neutral winner copy for spectators", () => {
    expect(getH2HResultPresentation(1, null, true, "Ada", "Grace")).toEqual({
      headline: "Ada Wins!",
      isLocalVictory: false,
    });
    expect(getH2HResultPresentation(2, null, true, "Ada", "Grace")).toEqual({
      headline: "Grace Wins!",
      isLocalVictory: false,
    });
  });
});

describe("calculateBoardLayout", () => {
  it("responds to width changes within the same breakpoint", () => {
    const wideMobile = calculateBoardLayout(700, 900, 16, 16);
    const narrowMobile = calculateBoardLayout(500, 900, 16, 16);

    expect(wideMobile.isMobile).toBe(true);
    expect(narrowMobile.isMobile).toBe(true);
    expect(wideMobile.cellSize).toBe(40);
    expect(narrowMobile.cellSize).toBe(30);
  });

  it("responds to height-only changes", () => {
    const tall = calculateBoardLayout(700, 900, 16, 16);
    const short = calculateBoardLayout(700, 700, 16, 16);

    expect(tall.cellSize).toBe(40);
    expect(short.cellSize).toBe(27);
  });

  it("recalculates for portrait and landscape viewport dimensions", () => {
    const portrait = calculateBoardLayout(390, 844, 8, 8);
    const landscape = calculateBoardLayout(844, 390, 8, 8);

    expect(portrait).toMatchObject({
      isMobile: true,
      cellSize: 46,
      boardWidth: 368,
      stackScores: true,
    });
    expect(landscape).toMatchObject({
      isMobile: false,
      cellSize: 22,
      boardWidth: 176,
      stackScores: false,
    });
  });

  it("preserves cell-size clamps and large-board dot scaling", () => {
    expect(calculateBoardLayout(1_200, 900, 8, 8)).toMatchObject({
      cellSize: 64,
      dotSize: 52,
      boardWidth: 512,
      boardHeight: 512,
      stackScores: false,
    });

    expect(calculateBoardLayout(200, 300, 16, 16)).toMatchObject({
      cellSize: 16,
      dotSize: 10,
      boardWidth: 256,
      boardHeight: 256,
      stackScores: true,
    });
  });

  it("rejects invalid dimensions instead of producing unusable CSS", () => {
    expect(() => calculateBoardLayout(0, 900, 8, 8)).toThrow(RangeError);
    expect(() => calculateBoardLayout(700, 900, 0, 8)).toThrow(RangeError);
  });
});
