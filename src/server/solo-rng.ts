import type { RandomSource } from "../shared/game/engine";

/**
 * Builds a reproducible RNG stream for one AI turn. Deriving each turn from
 * its ordinal keeps replay stable even when earlier turns consume a different
 * number of random values after an engine refactor.
 */
export function createSoloTurnRng(
  privateSeed: string,
  aiTurnOrdinal: number,
): RandomSource {
  if (!privateSeed || !privateSeed.trim()) {
    throw new TypeError("privateSeed must be a non-empty string.");
  }
  if (!Number.isSafeInteger(aiTurnOrdinal) || aiTurnOrdinal < 0) {
    throw new RangeError("aiTurnOrdinal must be a non-negative safe integer.");
  }

  let state = hash(`${privateSeed}\u0000${aiTurnOrdinal}`);
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 0x1_0000_0000;
  };
}

function hash(value: string): number {
  let result = 0x811c9dc5;
  for (let index = 0; index < value.length; index++) {
    result ^= value.charCodeAt(index);
    result = Math.imul(result, 0x01000193);
  }
  return result >>> 0;
}
