import { isRecord } from "../shared/guards";
import type { RatingRecord } from "../shared/types/api";
import { parseJson } from "./stored-json";

/** A stored rating with every count present; anything else reads as none. */
export function readRatingRecord(
  raw: string | null | undefined,
): RatingRecord | null {
  const parsed = parseJson(raw);
  if (!isRecord(parsed)) return null;
  const record = parsed as Partial<RatingRecord>;
  return typeof record.rating === "number" &&
    typeof record.games === "number" &&
    typeof record.wins === "number" &&
    typeof record.losses === "number" &&
    typeof record.draws === "number"
    ? {
        rating: record.rating,
        games: record.games,
        wins: record.wins,
        losses: record.losses,
        draws: record.draws,
      }
    : null;
}
