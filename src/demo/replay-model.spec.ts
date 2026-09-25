import { describe, expect, it } from "vitest";

import type { BoardPlayer, SerializableBoard } from "../game/types";
import { buildReplayFrames } from "./replay-model";

function player(userId: string): BoardPlayer {
  return {
    m_squares: [],
    m_score: 0,
    m_lastNumSquares: 0,
    m_playStyle: 0,
    m_goofs: false,
    m_computer: false,
    userId,
  };
}

function replayFixture(playerTwoFirst: boolean): SerializableBoard {
  const owners = playerTwoFirst ? [2, 1, 2] : [1, 2, 1];
  return {
    W: 4,
    H: 4,
    scoring: "bbox",
    winScore: 5,
    m_board: [...owners, ...new Array<number>(13).fill(0)],
    m_players: [player("player-one"), player("player-two")],
    m_turn: playerTwoFirst ? 0 : 1,
    m_history: [
      { x: 0, y: 0, index: 0 },
      { x: 1, y: 0, index: 1 },
      { x: 2, y: 0, index: 2 },
    ],
    m_displayed_game_over: false,
    m_onlyShowLastSquares: false,
    m_createRandomizedRangeOrder: true,
    m_stopAt150: true,
    m_last: { x: 2, y: 0, index: 2 },
    m_lastPoints: 0,
  };
}

describe("replay orientation", () => {
  it("assigns moves from the first player", () => {
    const board = replayFixture(true);
    const frames = buildReplayFrames(board, 1);

    expect(frames).toHaveLength(4);
    expect(frames.slice(1).map((frame) => frame.move?.owner)).toEqual([
      2, 1, 2,
    ]);
    expect(frames.at(-1)?.board).toEqual(board.m_board);
  });

  it("starts with player one by default", () => {
    const board = replayFixture(false);
    const frames = buildReplayFrames(board);

    expect(frames).toHaveLength(4);
    expect(frames.slice(1).map((frame) => frame.move?.owner)).toEqual([
      1, 2, 1,
    ]);
    expect(frames.at(-1)?.board).toEqual(board.m_board);
  });

  it("falls back to an opening and final frame for inconsistent history", () => {
    const board = replayFixture(false);
    board.m_board[0] = 2;
    const frames = buildReplayFrames(board);

    expect(frames).toHaveLength(2);
    expect(frames[0].moveNumber).toBe(0);
    expect(frames[1]?.board).toEqual(board.m_board);
  });
});
