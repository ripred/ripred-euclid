import { describe, expect, it } from "vitest";
import { Board, Player } from "../shared/game/engine";
import type { H2HCanonicalState } from "../shared/types/api";
import { captureWatchRecording } from "./watch-recording";

function snapshot(ended = false): H2HCanonicalState {
  const engine = new Board(
    new Player(1, false, "red"),
    new Player(1, false, "blue"),
  );
  return {
    gameId: "game",
    board: {
      ...engine.toJSON(),
      m_players: engine.m_players,
      m_turn: 0,
      revision: 0,
      rulesVersion: 1,
    },
    revision: 0,
    rulesVersion: 1,
    ended,
    endedReason: ended ? "player_left" : null,
    endedBy: ended ? "red" : null,
    victorSide: ended ? 2 : null,
  };
}

describe("spectator recordings", () => {
  it("never labels an unfinished board as a finished recording", () => {
    const live = snapshot();
    expect(captureWatchRecording(live, null)).toBeNull();
  });

  it("freezes canonical history and names without sharing mutable board data", () => {
    const state = snapshot(true);
    state.board.playerNames = { blue: "Blue player", red: "Red player" };
    const recording = captureWatchRecording(state, state.victorSide)!;
    expect(recording.headline).toBe("Blue player Wins!");
    expect(recording.board).toEqual(state.board);
    state.board.m_board[0] = 1;
    state.board.m_history.push({ x: 0, y: 0, index: 0 });
    state.board.playerNames!.blue = "Renamed player";
    expect(recording.board.m_board[0]).toBe(0);
    expect(recording.board.m_history).toHaveLength(0);
    expect(recording.board.playerNames?.blue).toBe("Blue player");
  });

  it("preserves a forfeit winner even when the departed player led on points", () => {
    const state = snapshot(true);
    state.board.playerNames = { red: "Red", blue: "Blue" };
    state.board.m_players[0].m_score = 100;
    expect(captureWatchRecording(state, state.victorSide)).toMatchObject({
      headline: "Blue Wins!",
      board: { m_players: [{ m_score: 100 }, { m_score: 0 }] },
    });
  });

  it("retains neutral tie wording", () => {
    const state = snapshot();
    state.ended = true;
    state.endedReason = "tie";
    expect(captureWatchRecording(state, null)?.headline).toBe("Tie game!");
  });
});
