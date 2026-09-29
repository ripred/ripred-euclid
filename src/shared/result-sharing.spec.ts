import { describe, expect, it } from "vitest";
import { Board, Player } from "./game/engine";
import type { GameOutcome, PlayerColor } from "./game/rules";
import { canShareSoloResult, describeSharedResult } from "./result-sharing";

const win = (winner: PlayerColor): GameOutcome =>
  winner === 1
    ? { state: 1, status: "player1_win", winner: 1 }
    : { state: 2, status: "player2_win", winner: 2 };
const tie: GameOutcome = { state: 3, status: "tie", winner: null };
const running: GameOutcome = { state: 0, status: "running", winner: null };

describe("canonical shared result text", () => {
  it.each([
    ["trent", "Euclid", 1, "trent beat Euclid, 156–132"],
    ["Euclid", "trent", 2, "trent beat Euclid, 156–132"],
    ["trent", "Euclid", 2, "Euclid beat trent, 156–132"],
    ["Euclid", "trent", 1, "Euclid beat trent, 156–132"],
  ] as const)(
    "orders %s and %s scores by winning side %s",
    (p1Name, p2Name, winnerSide, title) => {
      const board = new Board(new Player(), new Player()).toJSON();
      board.m_players[0]!.m_score = winnerSide === 1 ? 156 : 132;
      board.m_players[1]!.m_score = winnerSide === 2 ? 156 : 132;
      expect(
        describeSharedResult({
          board,
          p1Name,
          p2Name,
          outcome: win(winnerSide),
        }),
      ).toEqual({
        title,
        headline: `${title.split(",")[0]}!`,
        details: "156–132",
        winnerSide,
      });
    },
  );

  it("keeps an authoritative winner with their own score rather than inferring a different winner", () => {
    const board = new Board(new Player(), new Player()).toJSON();
    board.m_players[0]!.m_score = 12;
    board.m_players[1]!.m_score = 40;
    expect(
      describeSharedResult({
        board,
        p1Name: "trent",
        p2Name: "Euclid",
        outcome: win(1),
      }).title,
    ).toBe("trent beat Euclid, 12–40");
  });

  it("describes a draw honestly and rejects a running game", () => {
    const board = new Board(new Player(), new Player()).toJSON();
    for (const player of board.m_players) player.m_score = 40;
    const players = { board, p1Name: "trent", p2Name: "Euclid" };
    expect(describeSharedResult({ ...players, outcome: tie })).toMatchObject({
      title: "trent drew with Euclid, 40–40",
      winnerSide: null,
    });
    expect(() =>
      describeSharedResult({ ...players, outcome: running }),
    ).toThrow("unfinished game");
  });
});

describe("solo share eligibility", () => {
  it("allows either canonical winner only after the game completes", () => {
    for (const outcome of [win(1), win(2)]) {
      expect(canShareSoloResult({ status: "completed", outcome })).toBe(true);
      expect(canShareSoloResult({ status: "active", outcome })).toBe(false);
      expect(canShareSoloResult({ status: "abandoned", outcome })).toBe(false);
    }
    expect(canShareSoloResult({ status: "completed", outcome: tie })).toBe(
      false,
    );
    expect(canShareSoloResult({ status: "active", outcome: running })).toBe(
      false,
    );
  });
});
