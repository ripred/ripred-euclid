import { describe, expect, it } from "vitest";

import { RANKED_SOLO_RULES } from "./game/rules";
import {
  continuationPresentation,
  playEuclidSubtitle,
  recordPresentations,
} from "./home-ui";
import { EMPTY_RECORDS } from "./solo/records";
import { createSoloGame, playHumanMove } from "./solo/session";

describe("home records", () => {
  it("invites a first game before any results exist", () => {
    const [ranked, practice] = recordPresentations(EMPTY_RECORDS);
    expect(ranked).toMatchObject({
      label: "Ranked",
      statLabel: "Rating",
      stat: "1,200",
      record: "No rated games yet",
    });
    expect(practice).toMatchObject({
      label: "Practice",
      stat: "0",
      record: "No practice games yet",
      detail: "0 practice games",
    });
  });

  it("summarizes results once games are played", () => {
    const [ranked, practice] = recordPresentations({
      ranked: {
        games: 3,
        wins: 2,
        losses: 1,
        draws: 0,
        rating: 1251,
        best: 1262,
      },
      practice: { games: 1, wins: 1, losses: 0, draws: 0 },
    });
    expect(ranked.record).toBe("2W · 1L · 0D");
    expect(ranked.detail).toBe("Best 1,262 · 3 rated games");
    expect(practice.detail).toBe("1 practice game");
  });
});

describe("home copy", () => {
  it("describes the selected path", () => {
    expect(playEuclidSubtitle("ranked", "brutal")).toBe(
      "Ranked · Tenderfoot · fixed rules · rating on the line",
    );
    expect(playEuclidSubtitle("practice", "coffee")).toBe(
      "Practice · Coffee-Deprived · no rating changes",
    );
    expect(playEuclidSubtitle("practice", "casual", 6)).toBe(
      "Practice · Casual · stones fade after 6 turns · no rating changes",
    );
  });

  it("summarizes a saved game for the continue card", () => {
    const game = playHumanMove(
      createSoloGame(RANKED_SOLO_RULES, { id: "g", now: 1 }),
      0,
      0,
      2,
    )!.game;
    expect(continuationPresentation(game)).toEqual({
      title: "Continue Ranked game",
      detail: "Euclid's turn",
      score: "You 0 · Euclid 0",
      rules: "8×8 · Grid Footprint · first to 150",
    });
  });
});
