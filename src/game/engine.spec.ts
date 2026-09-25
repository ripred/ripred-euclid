import { describe, expect, it } from "vitest";

import type { SerializableBoard } from "./types";
import { Board, Player, Point, Square } from "./engine";
import { GAME_STATES } from "./rules";

const stationaryRng = () => 0;

function createBoard(
  style: number = Board.PS_BRUTAL,
  options: { W?: number; H?: number; winScore?: number } = {},
): Board {
  return new Board(new Player(style), new Player(style, true), {
    W: options.W ?? 4,
    H: options.H ?? options.W ?? 4,
    winScore: options.winScore ?? 150,
    scoring: "bbox",
    rng: stationaryRng,
  });
}

function placeTestPieces(
  board: Board,
  playerOne: readonly number[],
  playerTwo: readonly number[],
): void {
  board.m_board.fill(0);
  for (const index of playerOne) board.m_board[index] = 1;
  for (const index of playerTwo) board.m_board[index] = 2;
}

describe("Board moves and serialization", () => {
  it("accepts legal cells, rejects occupied or out-of-range cells, and scores", () => {
    const board = createBoard();

    expect(board.placePiece(board.pointAt(0, 0))).toBe(0);
    expect(board.m_history).toHaveLength(1);
    expect(board.placePiece(board.pointAt(0, 0))).toBe(0);
    expect(board.placePiece(board.pointAt(-1, 0))).toBe(0);
    expect(board.placePiece(board.pointAt(4, 0))).toBe(0);
    expect(board.m_history).toHaveLength(1);

    board.placePiece(board.pointAt(1, 0));
    board.placePiece(board.pointAt(0, 1));
    expect(board.placePiece(board.pointAt(1, 1))).toBe(4);
    expect(board.m_players[0].m_score).toBe(4);
    expect(board.m_players[0].m_squares).toHaveLength(1);
    expect(board.m_history.map((point) => point.index)).toEqual([0, 1, 4, 5]);
  });

  it("round-trips the SerializableBoard shape into class instances", () => {
    const board = createBoard(Board.PS_BEGINNER, {
      W: 6,
      H: 4,
      winScore: 25,
    });
    board.m_players[0].userId = "human";
    board.m_players[1].userId = "euclid";
    board.m_targets = ["0,1,6,7", null];
    board.placePiece(board.pointAt(2, 1));

    const serialized: SerializableBoard = board.toJSON();
    const restored = Board.fromJSON(serialized, stationaryRng);

    expect(restored.toJSON()).toEqual(serialized);
    expect(restored.m_last).toBeInstanceOf(Point);
    expect(restored.m_players[0]).toBeInstanceOf(Player);
    expect(restored.m_history[0]).toBeInstanceOf(Point);
    expect(restored.clone().toJSON()).toEqual(serialized);
  });

  it("reconstructs target wins and full-board score or tie outcomes", () => {
    const targetWin = createBoard(Board.PS_BRUTAL, { winScore: 4 });
    for (const [x, y] of [
      [0, 0],
      [1, 0],
      [0, 1],
      [1, 1],
    ] as const) {
      targetWin.placePiece(targetWin.pointAt(x, y));
    }
    expect(targetWin.getOutcome()).toEqual({
      state: GAME_STATES.PLAYER_1_WIN,
      status: "player1_win",
      winner: 1,
    });

    const fullBoard = createBoard();
    fullBoard.m_board.fill(1);
    fullBoard.m_players[0].m_score = 12;
    fullBoard.m_players[1].m_score = 8;
    expect(fullBoard.getOutcome().status).toBe("player1_win");

    fullBoard.m_players[1].m_score = 12;
    expect(fullBoard.getOutcome()).toEqual({
      state: GAME_STATES.TIE,
      status: "tie",
      winner: null,
    });
  });

  it("normalizes square corners identically after JSON restoration", () => {
    const square = new Square(
      new Point(0, 0, 0),
      new Point(0, 1, 4),
      new Point(1, 0, 1),
      new Point(1, 1, 5),
      1,
      4,
      0,
    );
    const restored = Square.fromJSON(square);

    expect([
      restored.p1.index,
      restored.p2.index,
      restored.p3.index,
      restored.p4.index,
    ]).toEqual([
      square.p1.index,
      square.p2.index,
      square.p3.index,
      square.p4.index,
    ]);
  });

  it("uses the injected RNG for randomized engine operations", () => {
    const values = [0.1, 0.9];
    const board = new Board(new Player(), new Player(), {
      W: 4,
      H: 4,
      rng: () => values.shift() ?? 0,
    });

    expect(board.createRandomizedRange(4)).toEqual([3, 1, 2, 0]);
  });
});

describe("Brutal move priorities", () => {
  it("takes its own immediate win before blocking the opponent's win", () => {
    const board = createBoard(Board.PS_BRUTAL, { winScore: 4 });
    placeTestPieces(board, [0, 1, 4], [10, 11, 14]);

    expect(board.findBestMove().index).toBe(5);
  });

  it("blocks an opponent's immediate win when it cannot win", () => {
    const board = createBoard(Board.PS_BRUTAL, { winScore: 4 });
    placeTestPieces(board, [], [0, 1, 4]);

    expect(board.findBestMove().index).toBe(5);
  });

  it("takes a larger immediate gain while weaker defensive play stays legacy", () => {
    const brutal = createBoard(Board.PS_BRUTAL, {
      W: 6,
      H: 6,
      winScore: 150,
    });
    placeTestPieces(brutal, [0, 2, 12], [28, 29, 34]);
    expect(brutal.findBestMove().index).toBe(14);

    const defensive = createBoard(Board.PS_DEFENSIVE, {
      W: 6,
      H: 6,
      winScore: 150,
    });
    placeTestPieces(defensive, [0, 2, 12], [28, 29, 34]);
    expect(defensive.findBestMove().index).toBe(35);
  });

  it("prevents a larger opponent gain", () => {
    const board = createBoard(Board.PS_BRUTAL, {
      W: 6,
      H: 6,
      winScore: 150,
    });
    placeTestPieces(board, [0, 1, 6], [21, 23, 33]);

    expect(board.findBestMove().index).toBe(35);
  });

  it("favors offense on equal gains and uses stable board-index ties", () => {
    const board = createBoard(Board.PS_BRUTAL, {
      W: 6,
      H: 6,
      winScore: 150,
    });
    placeTestPieces(board, [0, 1, 6], [28, 29, 34]);

    expect(board.findBestMove().index).toBe(7);
    expect(board.findBestMove().index).toBe(7);
  });

  it("falls back to the established long-term square target", () => {
    const board = createBoard(Board.PS_BRUTAL);

    expect(board.findBestMove().index).toBe(0);
    expect(board.m_targets[0]).toBe("0,3,12,15");
  });
});
