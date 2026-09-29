import type { RankingsResponse, RankingsShareRow } from "../shared/types/api";
import { fetchJsonRecord } from "./fetch-json";
import type { GameVariant } from "../shared/game/rules";

export type LoadedRankings = RankingsResponse & {
  hvh: RankingsShareRow[];
  hva: RankingsShareRow[];
};

/** Load the live boards without presenting transport failures as empty results. */
export async function fetchRankings(
  signal?: AbortSignal,
  variant: GameVariant = "standard",
): Promise<LoadedRankings> {
  const record = await fetchJsonRecord(
    `/api/rankings${variant === "tide" ? "?variant=tide" : ""}`,
    "Unable to load the leaderboard.",
    { signal: signal ?? null },
  );
  if (
    !record ||
    (record.hvh !== undefined && !Array.isArray(record.hvh)) ||
    (record.hva !== undefined && !Array.isArray(record.hva)) ||
    (record.variant !== undefined && record.variant !== variant)
  ) {
    throw new Error("The leaderboard response could not be read. Try again.");
  }

  const rankings = record as RankingsResponse;
  return {
    hvh: rankings.hvh ?? [],
    hva: rankings.hva ?? [],
    ...(rankings.variant ? { variant: rankings.variant } : {}),
    ...(rankings.hvaRules ? { hvaRules: rankings.hvaRules } : {}),
    ...(rankings.preview === true ? { preview: true } : {}),
  };
}
