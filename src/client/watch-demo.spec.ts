import { describe, expect, it } from "vitest";

import { DEMO_RECORDING, DEMO_STEPS } from "./preview-demo";
import { buildReplayFrames } from "./share-replay-model";
import { buildWatchDemo } from "./watch-demo";

describe("spectator teaching demo", () => {
  it("reuses every legal splash move and the shared scoring engine", () => {
    const board = buildWatchDemo();
    const frames = buildReplayFrames(board);

    expect([board.W, board.H]).toEqual([
      DEMO_RECORDING.width,
      DEMO_RECORDING.height,
    ]);
    expect(board.m_history).toHaveLength(DEMO_RECORDING.moves.length);
    expect(frames).toHaveLength(DEMO_RECORDING.moves.length + 1);
    for (const [index, move] of DEMO_RECORDING.moves.entries()) {
      expect(frames[index + 1]?.move).toMatchObject(move);
      expect(board.m_board[move.y * board.W + move.x]).toBe(move.owner);
    }

    for (const step of DEMO_STEPS) {
      const frame = frames[step.after.moveNumber];
      expect(frame?.scores).toEqual(step.after.scores);
      expect(frame?.newSquares.map((square) => square.points).sort()).toEqual(
        step.after.newSquares.map((square) => square.points).sort(),
      );
    }
    expect(frames.at(-1)?.board).toEqual(board.m_board);
    expect(frames.at(-1)?.scores).toEqual(
      board.m_players.map((player) => player.m_score),
    );
  });

  it("is deterministic, independent, and not represented as a completed match", () => {
    const first = buildWatchDemo();
    const second = buildWatchDemo();
    expect(first).toEqual(second);
    expect(first.ended).toBeUndefined();
    expect(first.m_displayed_game_over).toBe(false);
    expect(
      first.m_players.every((player) => player.m_score < first.winScore),
    ).toBe(true);
    first.m_board[0] = 0;
    first.m_players[0]!.m_score = 0;
    expect(second.m_board[0]).toBe(1);
    expect(second.m_players[0]!.m_score).toBeGreaterThan(0);
  });
});
