import { describe, expect, it } from "vitest";
import { Board, Player } from "./engine";
import { TIDE_MOVE_LIMIT } from "./rules";

function tide() {
  return new Board(new Player(Board.PS_OFFENSIVE), new Player(), {
    variant: "tide",
    rng: () => 0,
  });
}

function play(board: Board, index: number) {
  expect(board.m_board[index]).toBe(0);
  board.placePiece(board.pointAt(index % board.W, Math.floor(index / board.W)));
  board.advanceTurn();
}

describe("shared Tide rules", () => {
  it("expires each player's unanchored pieces before their seventh personal turn", () => {
    const board = tide();
    for (const index of [0, 56, 1, 57, 2, 58, 3, 59, 4, 60, 5])
      play(board, index);
    expect(board.m_board[0]).toBe(1);
    expect(board.tide!.expires[0]).toBe(12);
    play(board, 61);
    expect(board.m_board[0]).toBe(0);
    expect(board.tide!.expires[0]).toBe(0);
    expect(board.m_board[56]).toBe(2);
    play(board, 0);
    expect(board.m_board[56]).toBe(0);
    expect(board.m_board[0]).toBe(1);
    expect(board.tide!.expires[0]).toBe(24);
    expect(board.m_history.filter((point) => point.index === 0)).toHaveLength(
      2,
    );
  });

  it("anchors a completed square on the oldest corner's final personal turn", () => {
    const board = tide();
    for (const index of [0, 56, 1, 57, 8, 58, 2, 59, 3, 60, 9, 61])
      play(board, index);
    expect(board.m_players[0].m_score).toBe(4);
    for (const index of [0, 1, 8, 9]) {
      expect(board.m_board[index]).toBe(1);
      expect(board.tide!.anchored[index]).toBe(true);
    }
    for (const index of [4, 62, 5, 63, 6, 56, 7, 57]) play(board, index);
    expect(board.m_board[0]).toBe(1);
    expect(board.m_players[0].m_score).toBe(4);
    expect(board.m_players[0].m_squares).toHaveLength(1);
  });

  it("ends at 60 moves even with open cells, resolving the scores or a draw", () => {
    const board = tide();
    for (let ply = 0; ply < TIDE_MOVE_LIMIT; ply++) {
      const start = board.m_turn === 0 ? 0 : 56;
      const index = Array.from(
        { length: 8 },
        (_, offset) => start + offset,
      ).find((cell) => board.m_board[cell] === 0)!;
      play(board, index);
      if (ply < TIDE_MOVE_LIMIT - 1)
        expect(board.getOutcome().status).toBe("running");
    }
    expect(board.m_board).toContain(0);
    expect(board.getOutcome().status).toBe("tie");
    const frozen = board.toJSON();
    board.placePiece(board.pointAt(3, 3));
    expect(board.toJSON()).toEqual(frozen);
    board.m_players[0].m_score = 4;
    expect(board.getOutcome().winner).toBe(1);
    board.m_players[1].m_score = 9;
    expect(board.getOutcome().winner).toBe(2);
  });

  it("retains the normal immediate score victory and freezes expiration on that move", () => {
    const board = tide();
    for (const index of [0, 56, 1, 57, 8, 58]) play(board, index);
    board.m_players[0].m_score = 146;
    board.tide!.expires[56] = board.m_history.length + 1;
    play(board, 9);
    expect(board.getOutcome().winner).toBe(1);
    expect(board.m_board[56]).toBe(2);
  });

  it("preserves independent lifetimes and anchors through restoration and cloning", () => {
    const board = tide();
    for (const index of [0, 56, 1, 57, 8, 58, 9]) play(board, index);
    const restored = Board.fromJSON(board.toJSON());
    const clone = restored.clone();
    expect(clone.variant).toBe("tide");
    expect(clone.toJSON()).toEqual(board.toJSON());
    clone.tide!.expires[56] = 999;
    clone.tide!.anchored[0] = false;
    expect(restored.toJSON()).toEqual(board.toJSON());
  });

  it("abandons an AI target whose existing corner would expire before completion", () => {
    const board = tide();
    board.m_board[0] = 1;
    board.tide!.expires[0] = 2;
    board.m_targets[0] = "0,7,56,63";
    board.findBestMove();
    expect(board.m_targets[0]).not.toBe("0,7,56,63");
    expect(board.m_targets[0]!.split(",").map(Number)).not.toContain(0);
  });

  it("takes available points instead of blocking a square that expires before the opponent's turn", () => {
    const board = tide();
    board.m_players[0].m_playStyle = Board.PS_BRUTAL;
    for (const index of [63, 0, 61, 2, 59, 16, 54, 40, 55, 42, 62, 44])
      play(board, index);

    // Blue could complete a nine-point square at 18, but corner 0 disappears
    // after this Red move. Red can safely complete a four-point square at 53.
    expect(board.tide!.expires[0]).toBe(board.m_history.length + 1);
    expect(board.m_players.map((player) => player.m_score)).toEqual([4, 0]);
    const move = board.findBestMove();
    expect(move.index).toBe(53);
    play(board, move.index);
    expect(board.m_players[0].m_score).toBe(8);
    expect(board.m_board[0]).toBe(0);
    play(board, 18);
    expect(board.m_players[1].m_score).toBe(0);
  });

  it("wins on the final move instead of blocking a threat beyond the move limit", () => {
    const board = tide();
    board.m_players[1].m_playStyle = Board.PS_BRUTAL;
    for (const index of [
      32, 34, 39, 37, 55, 31, 4, 33, 41, 25, 27, 54, 23, 44, 45, 9, 11, 17, 24,
      22, 38, 6, 39, 37, 28, 55, 52, 49, 18, 41, 14, 2, 47, 62, 17, 8, 45, 23,
      35, 37, 54, 9, 55, 51, 24, 1, 5, 53, 31, 32, 17, 33, 46, 6, 42, 3, 28, 41,
      63,
    ])
      play(board, index);

    // Red's 25-point completion at 60 cannot occur after Blue's final move.
    // Taking four points at 40 wins; blocking at 60 would leave a draw.
    expect(board.m_history).toHaveLength(TIDE_MOVE_LIMIT - 1);
    expect(board.m_players.map((player) => player.m_score)).toEqual([0, 0]);
    const move = board.findBestMove();
    expect(move.index).toBe(40);
    play(board, move.index);
    expect(board.m_history).toHaveLength(TIDE_MOVE_LIMIT);
    expect(board.m_players.map((player) => player.m_score)).toEqual([0, 4]);
    expect(board.getOutcome().status).toBe("player2_win");
  });

  it("leaves Standard snapshots free of Tide state", () => {
    const board = new Board(new Player(), new Player());
    expect(board.variant).toBe("standard");
    expect(board.toJSON()).not.toHaveProperty("variant");
    expect(board.toJSON()).not.toHaveProperty("tide");
  });
});
