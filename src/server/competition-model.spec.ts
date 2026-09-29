import { describe, expect, it } from "vitest";
import { readStoredCompetitionResult } from "./competition-model";
import { competitionRankMember } from "./competition-gameplay";

const result = {
  username: "sample_player",
  userId: "t2_sample",
  moves: 3,
  squares: 4,
  elapsedMs: 41_250,
  achievedAt: 1_700_000_000_000,
  order: 2,
};
const stored = { ...result, member: competitionRankMember(result) };

describe("stored competition results", () => {
  it("reads a stored best result unchanged", () => {
    expect(readStoredCompetitionResult(JSON.stringify(stored))).toEqual(stored);
  });

  it.each([
    ["nothing stored", undefined],
    ["unreadable text", "{not json"],
    ["a blank player", JSON.stringify({ ...stored, userId: "" })],
    ["a negative time", JSON.stringify({ ...stored, elapsedMs: -1 })],
    ["a missing rank key", JSON.stringify({ ...stored, member: undefined })],
    ["a negative square count", JSON.stringify({ ...stored, squares: -1 })],
    ["a fractional square count", JSON.stringify({ ...stored, squares: 1.5 })],
  ])("treats %s as no result", (_label, raw) => {
    expect(readStoredCompetitionResult(raw)).toBeNull();
  });

  it("keeps legacy results readable when squares were not stored", () => {
    const legacy = { ...stored, squares: undefined };
    expect(readStoredCompetitionResult(JSON.stringify(legacy))).toMatchObject({
      moves: 3,
      username: "sample_player",
    });
    expect(
      readStoredCompetitionResult(JSON.stringify({ ...legacy, squares: null })),
    ).toEqual({ ...legacy, squares: null });
  });
});
