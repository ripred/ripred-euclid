import { describe, expect, it } from "vitest";

import {
  RANKED_SOLO_RULES,
  validatePracticeRules,
  type PracticeRules,
} from "../game/rules";
import {
  abandonSoloGame,
  countsAsForfeit,
  createSoloGame,
  humanResult,
  isEuclidTurn,
  isHumanTurn,
  playEuclidMove,
  playHumanMove,
  restoreSoloGame,
  saveSoloGame,
  type SoloGame,
} from "./session";

const NOW = 1_700_000_000_000;

/** A 4×4 Practice game where one small square wins. */
const QUICK_RULES: PracticeRules = validatePracticeRules({
  W: 4,
  H: 4,
  scoring: "bbox",
  winScore: 4,
  difficulty: "doofus",
});

const practice = () =>
  createSoloGame(QUICK_RULES, { id: "practice-game", now: NOW });

/** Replays moves through the same path a saved game takes. */
function fromMoves(rules: SoloGame["rules"], moves: Array<[number, number]>) {
  const game = createSoloGame(rules, { id: "replayed", now: NOW });
  const restored = restoreSoloGame({ ...saveSoloGame(game), moves });
  if (!restored) throw new Error("Fixture moves must replay legally.");
  return restored;
}

describe("starting a game", () => {
  it("starts Ranked on the fixed preset with the player to move", () => {
    const game = createSoloGame(RANKED_SOLO_RULES, { id: "r", now: NOW });
    expect(game.rules).toEqual(RANKED_SOLO_RULES);
    expect(game.board.m_board).toHaveLength(64);
    expect(game.board.m_board.every((cell) => cell === 0)).toBe(true);
    expect(game.status).toBe("active");
    expect(isHumanTurn(game)).toBe(true);
    expect(game.settled).toBe(false);
  });
});

describe("the player's move", () => {
  it("places a piece and hands the turn to Euclid", () => {
    const played = playHumanMove(practice(), 1, 2, NOW + 1)!;
    expect(played.move).toMatchObject({
      moveNumber: 1,
      actor: "human",
      player: 0,
      point: { x: 1, y: 2, index: 9 },
      pointsScored: 0,
    });
    expect(played.game.board.m_board[9]).toBe(1);
    expect(played.game.humanMoves).toBe(1);
    expect(isEuclidTurn(played.game)).toBe(true);
    expect(played.game.updatedAt).toBe(NOW + 1);
  });

  it("refuses occupied, off-board and out-of-turn points", () => {
    const game = practice();
    expect(playHumanMove(game, -1, 0, NOW)).toBeNull();
    expect(playHumanMove(game, 4, 0, NOW)).toBeNull();
    expect(playHumanMove(game, 0.5, 0, NOW)).toBeNull();
    const played = playHumanMove(game, 0, 0, NOW)!.game;
    // Euclid is on turn now, and the point is taken either way.
    expect(playHumanMove(played, 1, 1, NOW)).toBeNull();
    expect(
      playHumanMove(
        fromMoves(QUICK_RULES, [
          [0, 0],
          [3, 3],
        ]),
        0,
        0,
        NOW,
      ),
    ).toBeNull();
  });
});

describe("Euclid's move", () => {
  it("answers only on its own turn and returns the turn to the player", () => {
    const game = practice();
    expect(playEuclidMove(game, NOW)).toBeNull();
    const afterHuman = playHumanMove(game, 0, 0, NOW)!.game;
    const reply = playEuclidMove(afterHuman, NOW + 2, () => 0)!;
    expect(reply.move.actor).toBe("euclid");
    expect(reply.move.player).toBe(1);
    expect(reply.move.moveNumber).toBe(2);
    expect(reply.game.board.m_board[reply.move.point.index]).toBe(2);
    expect(isHumanTurn(reply.game)).toBe(true);
  });

  it("blocks a square the player is one move from completing", () => {
    // The player holds three corners of the top-left square.
    const game = fromMoves(
      validatePracticeRules({
        W: 4,
        H: 4,
        scoring: "bbox",
        winScore: 4,
        difficulty: "brutal",
      }),
      [
        [0, 0],
        [3, 3],
        [1, 0],
        [3, 2],
        [0, 1],
      ],
    );
    const reply = playEuclidMove(game, NOW, () => 0)!;
    expect(reply.move.point).toMatchObject({ x: 1, y: 1 });
  });
});

describe("finishing a game", () => {
  it("scores a completed square and ends the game at the target", () => {
    const game = fromMoves(QUICK_RULES, [
      [0, 0],
      [3, 3],
      [1, 0],
      [3, 2],
      [0, 1],
      [2, 3],
    ]);
    const played = playHumanMove(game, 1, 1, NOW)!;
    expect(played.move.pointsScored).toBe(4);
    expect(played.move.completedSquares).toHaveLength(1);
    expect(played.game.status).toBe("completed");
    expect(played.game.endedReason).toBe("score_target");
    expect(played.game.outcome.winner).toBe(1);
    expect(humanResult(played.game)).toBe(1);
  });

  it("ends a Practice game without a result when the player leaves", () => {
    const left = abandonSoloGame(
      playHumanMove(practice(), 0, 0, NOW)!.game,
      NOW,
    );
    expect(left.status).toBe("abandoned");
    expect(countsAsForfeit(left)).toBe(false);
    expect(humanResult(left)).toBeNull();
  });

  it("cancels Ranked freely before the first move and forfeits after it", () => {
    const ranked = createSoloGame(RANKED_SOLO_RULES, { id: "r", now: NOW });
    expect(humanResult(abandonSoloGame(ranked, NOW))).toBeNull();

    const moved = playHumanMove(ranked, 3, 3, NOW)!.game;
    const forfeited = abandonSoloGame(moved, NOW);
    expect(countsAsForfeit(forfeited)).toBe(true);
    expect(forfeited.outcome.winner).toBe(2);
    expect(humanResult(forfeited)).toBe(0);
  });

  it("leaves a finished game unchanged when it is abandoned", () => {
    const game = fromMoves(QUICK_RULES, [
      [0, 0],
      [3, 3],
      [1, 0],
      [3, 2],
      [0, 1],
      [2, 3],
    ]);
    const finished = playHumanMove(game, 1, 1, NOW)!.game;
    expect(abandonSoloGame(finished, NOW + 5)).toBe(finished);
  });
});

describe("saving and resuming", () => {
  const midGame = () => {
    const first = playHumanMove(practice(), 0, 0, NOW)!.game;
    const reply = playEuclidMove(first, NOW + 1, () => 0)!.game;
    return playHumanMove(reply, 2, 2, NOW + 2)!.game;
  };

  it("replays a saved game to the same position", () => {
    const game = midGame();
    const saved = JSON.parse(JSON.stringify(saveSoloGame(game)));
    const restored = restoreSoloGame(saved)!;
    expect(restored.board.m_board).toEqual(game.board.m_board);
    expect(restored.board.m_turn).toBe(game.board.m_turn);
    expect(restored.board.m_targets).toEqual(game.board.m_targets);
    expect(restored.humanMoves).toBe(2);
    expect(restored.id).toBe(game.id);
  });

  it("discards saves that do not replay to a legal, unfinished game", () => {
    const saved = saveSoloGame(midGame());
    expect(restoreSoloGame(null)).toBeNull();
    expect(restoreSoloGame({ ...saved, v: 2 })).toBeNull();
    expect(
      restoreSoloGame({
        ...saved,
        moves: [
          [0, 0],
          [0, 0],
        ],
      }),
    ).toBeNull();
    expect(restoreSoloGame({ ...saved, moves: [[9, 9]] })).toBeNull();
    expect(restoreSoloGame({ ...saved, moves: [["a", 1]] })).toBeNull();
    expect(
      restoreSoloGame({
        ...saved,
        rules: { ...RANKED_SOLO_RULES, winScore: 10 },
      }),
    ).toBeNull();
    // A game that already ended is not resumable.
    expect(
      restoreSoloGame({
        ...saved,
        moves: [
          [0, 0],
          [3, 3],
          [1, 0],
          [3, 2],
          [0, 1],
          [2, 3],
          [1, 1],
        ],
      }),
    ).toBeNull();
  });
});

describe("fading pieces", () => {
  const fading = (fadeTurns: 4 | 6) =>
    validatePracticeRules({
      W: 6,
      H: 6,
      scoring: "bbox",
      winScore: 500,
      difficulty: "doofus",
      fadeTurns,
    });

  it("washes a stone away just before its owner's turn after its last", () => {
    // The player's first stone lasts their turns 1–4, then washes away.
    const moves: Array<[number, number]> = [
      [0, 0],
      [5, 5],
      [2, 3],
      [5, 3],
      [3, 1],
      [4, 5],
      [1, 4],
    ];
    const beforeLast = fromMoves(fading(4), moves);
    expect(beforeLast.board.m_board[0]).toBe(1);
    const reply = playEuclidMove(beforeLast, NOW, () => 0)!;
    expect(reply.move.washed).toEqual([{ x: 0, y: 0, index: 0, owner: 1 }]);
    expect(reply.game.board.m_board[0]).toBe(0);
    // Euclid's own first stone is one move younger and still in play.
    expect(reply.game.board.m_board[35]).toBe(2);
  });

  it("anchors every corner of a completed square for the rest of the game", () => {
    const game = fromMoves(fading(4), [
      [0, 0],
      [5, 5],
      [1, 0],
      [5, 4],
      [0, 1],
      [4, 5],
    ]);
    const played = playHumanMove(game, 1, 1, NOW)!;
    expect(played.move.pointsScored).toBe(4);
    expect(played.game.board.m_anchored?.[0]).toBe(true);
    // Many moves later the anchored corner is still there.
    const later = fromMoves(fading(4), [
      [0, 0],
      [5, 5],
      [1, 0],
      [5, 4],
      [0, 1],
      [4, 5],
      [1, 1],
      [3, 3],
      [2, 2],
      [3, 4],
      [2, 4],
      [4, 3],
    ]);
    expect(later.board.m_board[0]).toBe(1);
    expect(later.board.m_board[35]).toBe(0);
  });

  it("replays washed-away stones identically when a game is resumed", () => {
    const moves: Array<[number, number]> = [
      [0, 0],
      [5, 5],
      [2, 3],
      [5, 3],
      [3, 1],
      [4, 5],
      [1, 4],
      [2, 0],
      [0, 0],
    ];
    const restored = fromMoves(fading(4), moves);
    expect(restored.board.m_board[0]).toBe(1);
    expect(restored.board.m_history).toHaveLength(9);
    expect(saveSoloGame(restored).rules.fadeTurns).toBe(4);
  });

  it("ends a game that reaches the move limit on score", () => {
    let game = createSoloGame(
      validatePracticeRules({
        W: 4,
        H: 4,
        scoring: "bbox",
        winScore: 64,
        difficulty: "doofus",
        fadeTurns: 4,
      }),
      { id: "limit", now: NOW },
    );
    // Both sides play the first open point until play stops.
    for (let move = 0; move < 100 && game.status === "active"; move++) {
      const open = game.board.m_board.indexOf(0);
      const next = isHumanTurn(game)
        ? playHumanMove(game, open % 4, Math.floor(open / 4), NOW)
        : playEuclidMove(game, NOW, () => 0);
      game = next!.game;
    }
    expect(game.status).toBe("completed");
    expect(game.board.m_history.length).toBeLessThanOrEqual(2 * 4 * 4);
    expect(["score_target", "board_full", "move_limit"]).toContain(
      game.endedReason,
    );
  });
});
