import { describe, expect, it } from "vitest";
import { Board, Player } from "../shared/game/engine";
import type {
  LegacyRankingsSharePayload,
  ResultSharePayload,
} from "../shared/types/api";
import { readStoredSharePayload } from "./stored-share";

const shared = {
  shareId: "share-1",
  subredditName: "EuclidTheGame",
  sharedAt: "2026-09-01T12:00:00.000Z",
  title: "sample_player Wins!",
  subtitle: "Redditor vs Euclid • September 1, 2026",
};
const result: ResultSharePayload = {
  ...shared,
  kind: "result",
  mode: "ai",
  headline: "sample_player Wins!",
  details: "150-96",
  footer: "First to 150 points",
  board: new Board(new Player(), new Player()).toJSON(),
  p1Name: "sample_player",
  p2Name: "Euclid",
  winnerSide: 1,
};
const rankings: LegacyRankingsSharePayload = {
  ...shared,
  kind: "rankings",
  bucket: "hvh",
  rows: [],
};
const stored = (value: unknown) => JSON.stringify(value);

describe("stored share snapshots", () => {
  it.each([
    ["result", result],
    ["rankings", rankings],
  ])("reads a stored %s snapshot unchanged", (_kind, payload) => {
    expect(readStoredSharePayload(stored(payload), "share-1")).toEqual(
      JSON.parse(stored(payload)),
    );
  });

  it.each([
    ["nothing stored", undefined],
    ["unreadable text", "{not json"],
    ["another share's snapshot", stored({ ...result, shareId: "share-2" })],
    ["an unknown kind", stored({ ...result, kind: "poll" })],
    ["a missing title", stored({ ...result, title: undefined })],
    ["a missing headline", stored({ ...result, headline: 7 })],
    ["no winner", stored({ ...result, winnerSide: 0 })],
    ["no board", stored({ ...result, board: null })],
    [
      "a one-player board",
      stored({
        ...result,
        board: { ...result.board, m_players: [result.board.m_players[0]] },
      }),
    ],
    ["rankings without rows", stored({ ...rankings, rows: undefined })],
  ])("treats %s as unavailable", (_label, raw) => {
    expect(readStoredSharePayload(raw, "share-1")).toBeNull();
  });
});
