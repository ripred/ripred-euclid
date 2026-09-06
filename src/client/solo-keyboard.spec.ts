import { describe, expect, it } from "vitest";

import { isFreshSoloGameplayKey } from "./solo-keyboard";

describe("solo gameplay keyboard input", () => {
  it("accepts a fresh press after the human turn begins", () => {
    expect(isFreshSoloGameplayKey({ repeat: false, timeStamp: 101 }, 100)).toBe(
      true,
    );
  });

  it.each([50, 99, 100])(
    "discards a buffered key timestamped %s before input reopened at 100",
    (timeStamp) => {
      expect(isFreshSoloGameplayKey({ repeat: false, timeStamp }, 100)).toBe(
        false,
      );
    },
  );

  it("does not let a held key make moves on successive human turns", () => {
    expect(isFreshSoloGameplayKey({ repeat: false, timeStamp: 101 }, 100)).toBe(
      true,
    );
    for (const turnStartedAt of [200, 300, 400]) {
      expect(
        isFreshSoloGameplayKey(
          { repeat: true, timeStamp: turnStartedAt + 1 },
          turnStartedAt,
        ),
      ).toBe(false);
    }
    expect(isFreshSoloGameplayKey({ repeat: false, timeStamp: 402 }, 400)).toBe(
      true,
    );
  });

  it("rejects keys while input is closed, including after game over", () => {
    expect(
      isFreshSoloGameplayKey({ repeat: false, timeStamp: 101 }, Infinity),
    ).toBe(false);
  });

  it("drops keys from a pending or failed request when the turn reopens", () => {
    const bufferedPress = { repeat: false, timeStamp: 150 };
    expect(isFreshSoloGameplayKey(bufferedPress, Infinity)).toBe(false);
    expect(isFreshSoloGameplayKey(bufferedPress, 200)).toBe(false);
    expect(isFreshSoloGameplayKey({ repeat: false, timeStamp: 201 }, 200)).toBe(
      true,
    );
  });

  it.each([NaN, Infinity, -Infinity])(
    "rejects an invalid event timestamp: %s",
    (timeStamp) => {
      expect(isFreshSoloGameplayKey({ repeat: false, timeStamp }, 100)).toBe(
        false,
      );
    },
  );
});
