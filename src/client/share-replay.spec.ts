import { describe, expect, it } from "vitest";

import { SOLO_RULES_VERSION, type PracticeRules } from "../shared/game/rules";
import type { SerializableBoard, SharePlayer } from "../shared/types/api";
import { buildReplayFrames } from "./share-replay-model";

const PLAYER_TWO_FIRST_RULES: PracticeRules = {
  rulesVersion: SOLO_RULES_VERSION,
  mode: "practice",
  W: 4,
  H: 4,
  scoring: "bbox",
  winScore: 5,
  humanPlayer: 1,
  firstPlayer: 1,
  difficulty: "coffee",
};

function player(userId: string): SharePlayer {
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
    ...(playerTwoFirst
      ? {
          solo: {
            mode: "practice" as const,
            ranked: false as const,
            rulesVersion: SOLO_RULES_VERSION,
            rules: PLAYER_TWO_FIRST_RULES,
          },
        }
      : {}),
  };
}

describe("shared game replay orientation", () => {
  it("round-trips a player-two-first canonical solo history", () => {
    const board = replayFixture(true);
    const frames = buildReplayFrames(board);

    expect(frames).toHaveLength(4);
    expect(frames.slice(1).map((frame) => frame.move?.owner)).toEqual([
      2, 1, 2,
    ]);
    expect(frames.at(-1)?.board).toEqual(board.m_board);
  });

  it("retains the player-one-first fallback for legacy share payloads", () => {
    const board = replayFixture(false);
    const frames = buildReplayFrames(board);

    expect(frames).toHaveLength(4);
    expect(frames.slice(1).map((frame) => frame.move?.owner)).toEqual([
      1, 2, 1,
    ]);
    expect(frames.at(-1)?.board).toEqual(board.m_board);
  });
});
