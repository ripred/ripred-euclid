import type { SoloGame } from "./session";
import { humanResult } from "./session";

/**
 * The player's results against Euclid. Ranked games move an Elo rating
 * against Euclid's fixed reference rating; Practice only keeps a tally.
 */

export const START_RATING = 1200;
export const EUCLID_RATING = 1600;
export const K_FACTOR = 32;

export interface Tally {
  games: number;
  wins: number;
  losses: number;
  draws: number;
}

export interface RankedRecord extends Tally {
  rating: number;
  best: number;
}

export interface PlayerRecords {
  ranked: RankedRecord;
  practice: Tally;
}

const EMPTY_TALLY: Tally = { games: 0, wins: 0, losses: 0, draws: 0 };

export const EMPTY_RECORDS: PlayerRecords = {
  ranked: { ...EMPTY_TALLY, rating: START_RATING, best: START_RATING },
  practice: { ...EMPTY_TALLY },
};

const tallied = <T extends Tally>(tally: T, result: 1 | 0.5 | 0): T => ({
  ...tally,
  games: tally.games + 1,
  wins: tally.wins + (result === 1 ? 1 : 0),
  losses: tally.losses + (result === 0 ? 1 : 0),
  draws: tally.draws + (result === 0.5 ? 1 : 0),
});

export function expectedScore(rating: number): number {
  return 1 / (1 + Math.pow(10, (EUCLID_RATING - rating) / 400));
}

export function settleRating(rating: number, result: 1 | 0.5 | 0): number {
  return Math.round(rating + K_FACTOR * (result - expectedScore(rating)));
}

/**
 * Adds a finished game to the records exactly once. Games that do not count
 * (a canceled Ranked start, an ended Practice) are marked settled unchanged.
 */
export function settleGame(
  game: SoloGame,
  records: PlayerRecords,
): { game: SoloGame; records: PlayerRecords } {
  if (game.status === "active" || game.settled) return { game, records };
  const result = humanResult(game);
  if (result === null) return { game: { ...game, settled: true }, records };

  if (game.rules.mode === "practice") {
    return {
      game: { ...game, settled: true },
      records: { ...records, practice: tallied(records.practice, result) },
    };
  }

  const before = records.ranked.rating;
  const after = settleRating(before, result);
  return {
    game: { ...game, settled: true, rating: { before, after } },
    records: {
      ...records,
      ranked: {
        ...tallied(records.ranked, result),
        rating: after,
        best: Math.max(records.ranked.best, after),
      },
    },
  };
}

const isCount = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

function restoreTally(value: unknown): Tally | null {
  if (!value || typeof value !== "object") return null;
  const { games, wins, losses, draws } = value as Record<string, unknown>;
  if (![games, wins, losses, draws].every(isCount)) return null;
  const tally = { games, wins, losses, draws } as Tally;
  return tally.games === tally.wins + tally.losses + tally.draws ? tally : null;
}

/** Stored records that fail validation fall back to a fresh start. */
export function restoreRecords(value: unknown): PlayerRecords | null {
  if (!value || typeof value !== "object") return null;
  const source = value as Record<string, unknown>;
  const rankedSource = source.ranked as Record<string, unknown> | undefined;
  const ranked = restoreTally(rankedSource);
  const practice = restoreTally(source.practice);
  const rating = rankedSource?.rating;
  const best = rankedSource?.best;
  const isRating = (item: unknown): item is number =>
    typeof item === "number" && Number.isSafeInteger(item);
  if (!ranked || !practice || !isRating(rating) || !isRating(best)) return null;
  return { ranked: { ...ranked, rating, best }, practice };
}
