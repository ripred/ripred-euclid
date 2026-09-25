import { describe, expect, it } from "vitest";

import {
  calculateBoardLayout,
  isFreshGameplayKey,
  shouldPlaceFromKey,
  shouldRunVictoryEffects,
} from "./game-ui";

describe("shouldRunVictoryEffects", () => {
  it("allows effects only for a terminal local victory", () => {
    expect(shouldRunVictoryEffects(true, true)).toBe(true);
    expect(shouldRunVictoryEffects(true, false)).toBe(false);
    expect(shouldRunVictoryEffects(false, true)).toBe(false);
    expect(shouldRunVictoryEffects(false, false)).toBe(false);
  });
});

describe("calculateBoardLayout", () => {
  it("uses the space remaining after measured controls, not a fixed viewport allowance", () => {
    // A 744x614 frame with 32px horizontal padding and 345px of non-board
    // content must leave its action row visible even with stacked scores.
    expect(calculateBoardLayout(712, 269, 8, 8)).toMatchObject({
      cellSize: 33,
      boardWidth: 264,
      boardHeight: 264,
    });
  });

  it("responds to width and height changes without changing breakpoints", () => {
    expect(calculateBoardLayout(640, 640, 16, 16).cellSize).toBe(40);
    expect(calculateBoardLayout(480, 640, 16, 16).cellSize).toBe(30);
    expect(calculateBoardLayout(640, 432, 16, 16).cellSize).toBe(27);
  });

  it.each([
    [358, 499, 8, 8],
    [812, 141, 8, 8],
    [712, 269, 8, 16],
    [712, 269, 16, 8],
    [400.5, 256.5, 16, 16],
  ])(
    "fits rectangular boards within the available %s x %s area",
    (width, height, columns, rows) => {
      const layout = calculateBoardLayout(width, height, columns, rows);
      expect(layout.boardWidth).toBeLessThanOrEqual(width);
      expect(layout.boardHeight).toBeLessThanOrEqual(height);
      expect(layout.boardWidth / columns).toBe(layout.boardHeight / rows);
      expect(Number.isInteger(layout.cellSize)).toBe(true);
    },
  );

  it("preserves cell-size clamps and large-board dot scaling", () => {
    expect(calculateBoardLayout(1_200, 900, 8, 8)).toMatchObject({
      cellSize: 88,
      dotSize: 72,
      boardWidth: 704,
      boardHeight: 704,
    });

    expect(calculateBoardLayout(168, 0, 16, 16)).toMatchObject({
      cellSize: 16,
      dotSize: 10,
      boardWidth: 256,
      boardHeight: 256,
    });
  });

  it("preserves usable cells before measurement or when controls fill the viewport", () => {
    expect(calculateBoardLayout(0, 0, 8, 8)).toMatchObject({
      cellSize: 16,
      dotSize: 12,
      boardWidth: 128,
      boardHeight: 128,
    });
  });

  it.each([
    [-1, 900, 8, 8],
    [700, -1, 8, 8],
    [NaN, 900, 8, 8],
    [700, Infinity, 8, 8],
    [700, 900, 0, 8],
    [700, 900, 8, 0],
    [700, 900, 8.5, 8],
  ])("rejects invalid geometry %s,%s,%s,%s", (width, height, columns, rows) => {
    expect(() => calculateBoardLayout(width, height, columns, rows)).toThrow(
      RangeError,
    );
  });
});

describe("isFreshGameplayKey", () => {
  it("accepts a fresh press after the human turn begins", () => {
    expect(isFreshGameplayKey({ repeat: false, timeStamp: 101 }, 100)).toBe(
      true,
    );
  });

  it.each([50, 99, 100])(
    "discards a buffered key timestamped %s before input reopened at 100",
    (timeStamp) => {
      expect(isFreshGameplayKey({ repeat: false, timeStamp }, 100)).toBe(false);
    },
  );

  it("does not let a held key make moves on successive human turns", () => {
    expect(isFreshGameplayKey({ repeat: false, timeStamp: 101 }, 100)).toBe(
      true,
    );
    for (const turnStartedAt of [200, 300, 400]) {
      expect(
        isFreshGameplayKey(
          { repeat: true, timeStamp: turnStartedAt + 1 },
          turnStartedAt,
        ),
      ).toBe(false);
    }
    expect(isFreshGameplayKey({ repeat: false, timeStamp: 402 }, 400)).toBe(
      true,
    );
  });

  it("rejects keys while input is closed, including after game over", () => {
    expect(
      isFreshGameplayKey({ repeat: false, timeStamp: 101 }, Infinity),
    ).toBe(false);
  });

  it("drops keys pressed while Euclid was moving once the turn reopens", () => {
    const bufferedPress = { repeat: false, timeStamp: 150 };
    expect(isFreshGameplayKey(bufferedPress, Infinity)).toBe(false);
    expect(isFreshGameplayKey(bufferedPress, 200)).toBe(false);
    expect(isFreshGameplayKey({ repeat: false, timeStamp: 201 }, 200)).toBe(
      true,
    );
  });

  it.each([NaN, Infinity, -Infinity])(
    "rejects an invalid event timestamp: %s",
    (timeStamp) => {
      expect(isFreshGameplayKey({ repeat: false, timeStamp }, 100)).toBe(false);
    },
  );
});

describe("shouldPlaceFromKey", () => {
  const key = (timeStamp: number, repeat = false) => ({ timeStamp, repeat });

  it("places only on a fresh press during a placeable turn", () => {
    expect(shouldPlaceFromKey(key(120), 100, true)).toBe(true);
  });

  it("drops keystrokes that queued before the turn became placeable", () => {
    expect(shouldPlaceFromKey(key(80), 100, true)).toBe(false);
    expect(shouldPlaceFromKey(key(120), Infinity, true)).toBe(false);
  });

  it("ignores held-key repeats and presses while no placement is allowed", () => {
    expect(shouldPlaceFromKey(key(120, true), 100, true)).toBe(false);
    expect(shouldPlaceFromKey(key(120), 100, false)).toBe(false);
  });
});
