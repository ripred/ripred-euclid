import { describe, expect, it } from "vitest";
import { readRatingRecord } from "./rating-record";

const rating = { rating: 1_216, games: 3, wins: 2, losses: 1, draws: 0 };

describe("stored rating records", () => {
  it("reads a stored rating, keeping only its counts", () => {
    expect(
      readRatingRecord(JSON.stringify({ ...rating, legacyField: "kept out" })),
    ).toEqual(rating);
  });

  it.each([
    ["nothing stored", undefined],
    ["an empty value", ""],
    ["unreadable text", "{not json"],
    ["a list", "[]"],
    ["a missing count", JSON.stringify({ ...rating, draws: undefined })],
    ["a count stored as text", JSON.stringify({ ...rating, wins: "2" })],
  ])("treats %s as no rating", (_label, raw) => {
    expect(readRatingRecord(raw)).toBeNull();
  });
});
