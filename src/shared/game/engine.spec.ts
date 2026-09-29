import { describe, expect, it } from "vitest";

import type { SerializableBoard } from "../types/api";
import { Board, Player, Point, Square, type RandomSource } from "./engine";
import { seededRandom } from "./random";
import { GAME_STATES } from "./rules";

const stationaryRng = () => 0;

function createBoard(
  style: number = Board.PS_BRUTAL,
  options: {
    W?: number;
    H?: number;
    winScore?: number;
    rng?: RandomSource;
  } = {},
): Board {
  return new Board(new Player(style), new Player(style, true), {
    W: options.W ?? 4,
    H: options.H ?? options.W ?? 4,
    winScore: options.winScore ?? 150,
    rng: options.rng ?? stationaryRng,
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

  it("round-trips the existing SerializableBoard shape into class instances", () => {
    const board = createBoard(Board.PS_BEGINNER, {
      W: 6,
      H: 4,
      winScore: 25,
    });
    board.m_players[0].userId = "human";
    board.m_players[1].userId = "euclid";
    board.playerNames = { human: "You", euclid: "Euclid" };
    board.m_targets = ["0,1,6,7", null];
    board.chat = {
      seq: 1,
      items: [{ id: 1, ts: 2, sender: "You", text: "Good game" }],
    };
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

  it("takes a larger immediate gain while Defensive prioritizes blocking", () => {
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

  it("falls back to an oblique long-term square target", () => {
    const board = createBoard(Board.PS_BRUTAL);

    const move = board.findBestMove();
    expect(OBLIQUE_TARGETS).toContain(board.m_targets[0]);
    expect(targetCorners(board)).toContain(move.index);
  });
});

// Both oblique squares share the outer aligned square's 16-point footprint.
const OBLIQUE_TARGETS = ["1,7,8,14", "2,4,11,13"];

function targetCorners(board: Board): number[] {
  return board.m_targets[0]!.split(",").map(Number);
}

describe("shared offensive square targeting", () => {
  it.each([
    Board.PS_OFFENSIVE,
    Board.PS_DEFENSIVE,
    Board.PS_CASUAL,
    Board.PS_TENDERFOOT,
    Board.PS_COFFEE,
    Board.PS_BEGINNER,
    Board.PS_GOLDFISH,
    Board.PS_DOOFUS,
  ])("prefers an oblique target among equal options for style %s", (style) => {
    const board = createBoard(style);

    board.findBestMove();

    expect(OBLIQUE_TARGETS).toContain(board.m_targets[0]);
  });

  it("keeps point value ahead of how close a smaller square is to completion", () => {
    const board = createBoard(Board.PS_OFFENSIVE);
    // One more dot at 9 completes a 9-point tilted square; a 16-point target
    // still takes three moves and must remain the offensive plan.
    placeTestPieces(board, [1, 4, 6], []);

    board.findBestMove();

    expect(OBLIQUE_TARGETS).toContain(board.m_targets[0]);
    expect(
      targetCorners(board).filter((index) => board.m_board[index] === 0),
    ).toHaveLength(3);
  });

  it("keeps fewer missing corners ahead of the oblique preference", () => {
    const board = createBoard(Board.PS_OFFENSIVE);
    placeTestPieces(board, [0], []);

    board.findBestMove();

    expect(board.m_targets[0]).toBe("0,3,12,15");
  });

  it("uses an aligned target when the tied oblique choices are blocked", () => {
    const board = createBoard(Board.PS_OFFENSIVE);
    placeTestPieces(board, [], [1, 2]);

    board.findBestMove();

    expect(board.m_targets[0]).toBe("0,3,12,15");
  });

  it("uses the injected RNG to vary equally strong oblique targets", () => {
    const first = createBoard(Board.PS_OFFENSIVE, { rng: () => 0 });
    const last = createBoard(Board.PS_OFFENSIVE, { rng: () => 0.999999 });

    first.findBestMove();
    last.findBestMove();

    expect(new Set([first.m_targets[0], last.m_targets[0]])).toEqual(
      new Set(OBLIQUE_TARGETS),
    );
  });

  it("repeats each seed while allowing different seeds to choose different targets", () => {
    const targets = new Set<string | null>();
    for (let seed = 0; seed < 24; seed++) {
      const first = createBoard(Board.PS_OFFENSIVE, {
        rng: seededRandom(`target-${seed}`),
      });
      const replay = createBoard(Board.PS_OFFENSIVE, {
        rng: seededRandom(`target-${seed}`),
      });

      expect(first.findBestMove()).toEqual(replay.findBestMove());
      expect(first.m_targets).toEqual(replay.m_targets);
      targets.add(first.m_targets[0]);
    }
    expect(targets).toEqual(new Set(OBLIQUE_TARGETS));
  });

  it("keeps an existing target until an opponent blocks it", () => {
    const board = createBoard(Board.PS_OFFENSIVE);
    board.findBestMove();
    const original = board.m_targets[0];
    const corners = targetCorners(board);
    // A newly available, nearly finished target does not replace the plan.
    placeTestPieces(board, [0, 3, 12], []);

    expect(corners).toContain(board.findBestMove().index);
    expect(board.m_targets[0]).toBe(original);

    board.m_board[corners[0]!] = 2;
    const replacement = board.findBestMove();
    expect(board.m_targets[0]).toBe("0,3,12,15");
    expect(targetCorners(board)).not.toContain(corners[0]);
    expect(replacement.index).toBe(15);
  });

  it("replaces a target after its square is complete", () => {
    const board = createBoard(Board.PS_OFFENSIVE);
    board.findBestMove();
    const original = board.m_targets[0];
    placeTestPieces(board, targetCorners(board), []);

    const move = board.findBestMove();

    expect(OBLIQUE_TARGETS).toContain(board.m_targets[0]);
    expect(board.m_targets[0]).not.toBe(original);
    expect(targetCorners(board)).toContain(move.index);
    expect(board.m_board[move.index]).toBe(0);
  });
});
