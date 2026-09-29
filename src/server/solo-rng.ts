import { seededRandom } from "../shared/game/random";
import { isCount, isNonBlankString } from "../shared/guards";
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
  if (!isNonBlankString(privateSeed)) {
    throw new TypeError("privateSeed must be a non-empty string.");
  }
  if (!isCount(aiTurnOrdinal)) {
    throw new RangeError("aiTurnOrdinal must be a non-negative safe integer.");
  }

  return seededRandom(`${privateSeed}\u0000${aiTurnOrdinal}`);
}
