import type { RankingsResponse, RankingsShareRow } from "../shared/types/api";
import { fetchJsonRecord } from "./fetch-json";

export type LoadedRankings = RankingsResponse & {
  hvh: RankingsShareRow[];
  hva: RankingsShareRow[];
};

/** Load the live boards without presenting transport failures as empty results. */
export async function fetchRankings(
  signal?: AbortSignal,
): Promise<LoadedRankings> {
  const record = await fetchJsonRecord(
    "/api/rankings",
    "Unable to load the leaderboard.",
    signal,
  );
  if (
    !record ||
    (record.hvh !== undefined && !Array.isArray(record.hvh)) ||
    (record.hva !== undefined && !Array.isArray(record.hva))
  ) {
    throw new Error("The leaderboard response could not be read. Try again.");
  }

  const rankings = record as RankingsResponse;
  return {
    hvh: rankings.hvh ?? [],
    hva: rankings.hva ?? [],
    ...(rankings.hvaRules ? { hvaRules: rankings.hvaRules } : {}),
    ...(rankings.preview === true ? { preview: true } : {}),
  };
}
