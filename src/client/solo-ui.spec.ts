import { describe, expect, it } from "vitest";

import {
  GAME_STATES,
  RANKED_SOLO_RULES,
  SOLO_RULES_VERSION,
  type PracticeRules,
} from "../shared/game/rules";
import type { SharePlayer, SoloSessionSnapshot } from "../shared/types/api";
import {
  createPracticeSoloStartIntent,
  createRankedSoloStartIntent,
  createSoloStartIntentKey,
  createSoloAbandonIntent,
  createSoloMoveIntent,
  getOrCreateSoloStartCommand,
  getSoloAssistancePolicy,
  getSoloExitAction,
  getSoloResultPresentation,
  getSoloSharePresentation,
  isSoloHumanTurn,
  shouldAdoptSoloSnapshot,
} from "./solo-ui";

const PRACTICE_RULES: PracticeRules = {
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

function player(userId: string, computer: boolean): SharePlayer {
  return {
    m_squares: [],
    m_score: 0,
    m_lastNumSquares: 0,
    m_playStyle: 0,
    m_goofs: false,
    m_computer: computer,
    userId,
  };
}

function boardFor(
  rules: PracticeRules | typeof RANKED_SOLO_RULES,
  historyLength = 0,
): SoloSessionSnapshot["board"] {
  const history = Array.from({ length: historyLength }, (_, index) => ({
    x: index % rules.W,
    y: Math.floor(index / rules.W),
    index,
  }));
  return {
    W: rules.W,
    H: rules.H,
    scoring: rules.scoring,
    winScore: rules.winScore,
    m_board: new Array<number>(rules.W * rules.H).fill(0),
    m_players:
      rules.humanPlayer === 0
        ? [player("human", false), player("euclid", true)]
        : [player("euclid", true), player("human", false)],
    m_turn: rules.firstPlayer,
    m_history: history,
    m_displayed_game_over: false,
    m_onlyShowLastSquares: false,
    m_createRandomizedRangeOrder: true,
    m_stopAt150: true,
    m_last: history.at(-1) ?? { x: -1, y: -1, index: -1 },
    m_lastPoints: 0,
    revision: 3,
    rulesVersion: SOLO_RULES_VERSION,
  };
}

function practiceSnapshot(
  overrides: Partial<SoloSessionSnapshot> = {},
  historyLength = 0,
): SoloSessionSnapshot {
  return {
    mode: "practice",
    ranked: false,
    rulesVersion: SOLO_RULES_VERSION,
    rules: PRACTICE_RULES,
    gameId: "practice-game",
    revision: 3,
    board: boardFor(PRACTICE_RULES, historyLength),
    status: "active",
    outcome: {
      state: GAME_STATES.RUNNING,
      status: "running",
      winner: null,
    },
    endedReason: null,
    canShare: false,
    humanMoveCount: Math.ceil(historyLength / 2),
    aiMoveCount: Math.floor(historyLength / 2),
    rankedAbandonCountsAsLoss: false,
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
    ...overrides,
  } as SoloSessionSnapshot;
}

function rankedSnapshot(historyLength = 0): SoloSessionSnapshot {
  return {
    mode: "ranked",
    ranked: true,
    rulesVersion: SOLO_RULES_VERSION,
    rules: RANKED_SOLO_RULES,
    gameId: "ranked-game",
    revision: 2,
    board: boardFor(RANKED_SOLO_RULES, historyLength),
    status: "active",
    outcome: {
      state: GAME_STATES.RUNNING,
      status: "running",
      winner: null,
    },
    endedReason: null,
    canShare: false,
    humanMoveCount: historyLength,
    aiMoveCount: 0,
    rankedAbandonCountsAsLoss: historyLength > 0,
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
  };
}

describe("shouldAdoptSoloSnapshot", () => {
  it("rejects snapshots for a closed or different game", () => {
    const incoming = { gameId: "game-a", revision: 4 };
    expect(shouldAdoptSoloSnapshot(null, 3, incoming)).toBe(false);
    expect(shouldAdoptSoloSnapshot("game-b", 3, incoming)).toBe(false);
  });

  it("accepts the same or newer revision but rejects rollback", () => {
    expect(
      shouldAdoptSoloSnapshot("game-a", 3, {
        gameId: "game-a",
        revision: 2,
      }),
    ).toBe(false);
    expect(
      shouldAdoptSoloSnapshot("game-a", 3, {
        gameId: "game-a",
        revision: 3,
      }),
    ).toBe(true);
    expect(
      shouldAdoptSoloSnapshot("game-a", 3, {
        gameId: "game-a",
        revision: 4,
      }),
    ).toBe(true);
  });
});

describe("solo player orientation and presentation", () => {
  it("treats player two as the human when Practice rules say so", () => {
    const snapshot = practiceSnapshot({
      status: "completed",
      outcome: {
        state: GAME_STATES.PLAYER_2_WIN,
        status: "player2_win",
        winner: 2,
      },
      endedReason: "score_target",
      canShare: true,
    });

    expect(getSoloResultPresentation(snapshot)).toEqual({
      result: "win",
      headline: "You Win!",
      terminal: true,
      humanSide: 2,
      euclidSide: 1,
      winnerSide: 2,
      isLocalVictory: true,
      shouldCelebrate: true,
    });
  });

  it("distinguishes a loss, tie, active turn, and unrated cancellation", () => {
    const loss = practiceSnapshot({
      status: "completed",
      outcome: {
        state: GAME_STATES.PLAYER_1_WIN,
        status: "player1_win",
        winner: 1,
      },
      endedReason: "board_full",
    });
    expect(getSoloResultPresentation(loss)).toMatchObject({
      result: "loss",
      headline: "Euclid Wins!",
      shouldCelebrate: false,
    });

    const tie = practiceSnapshot({
      status: "completed",
      outcome: { state: GAME_STATES.TIE, status: "tie", winner: null },
      endedReason: "board_full",
    });
    expect(getSoloResultPresentation(tie)).toMatchObject({
      result: "tie",
      headline: "Tie game!",
    });

    expect(isSoloHumanTurn(practiceSnapshot())).toBe(true);
    expect(getSoloResultPresentation(practiceSnapshot()).headline).toBe(
      "Your move",
    );

    const canceled = practiceSnapshot({
      status: "abandoned",
      endedReason: "abandoned",
    });
    expect(getSoloResultPresentation(canceled)).toMatchObject({
      result: "abandoned",
      headline: "Practice ended",
      shouldCelebrate: false,
    });

    const forfeit = {
      ...rankedSnapshot(1),
      status: "abandoned" as const,
      endedReason: "abandoned" as const,
    };
    expect(getSoloResultPresentation(forfeit)).toMatchObject({
      result: "loss",
      headline: "Ranked game forfeited",
      winnerSide: null,
      shouldCelebrate: false,
    });
  });
});

describe("solo assistance and exit policy", () => {
  it("disables every built-in assistance path in Ranked by default", () => {
    expect(getSoloAssistancePolicy("ranked")).toEqual({
      allowAssistHighlights: false,
      allowAutoMove: false,
      allowSecretAutoMove: false,
    });
    expect(getSoloAssistancePolicy("practice")).toEqual({
      allowAssistHighlights: true,
      allowAutoMove: true,
      allowSecretAutoMove: true,
    });
  });

  it("allows only the secret Ranked shortcut for the testing account", () => {
    for (const username of ["ripred3", "RipRed3"]) {
      expect(getSoloAssistancePolicy("ranked", username)).toEqual({
        allowAssistHighlights: false,
        allowAutoMove: false,
        allowSecretAutoMove: true,
      });
    }
    for (const username of ["", "another-player", "ripred", "ripred30"]) {
      expect(getSoloAssistancePolicy("ranked", username)).toEqual({
        allowAssistHighlights: false,
        allowAutoMove: false,
        allowSecretAutoMove: false,
      });
    }
    expect(getSoloAssistancePolicy("practice", "ripred3")).toEqual(
      getSoloAssistancePolicy("practice"),
    );
  });

  it("warns about a Ranked loss only after the first human move", () => {
    expect(getSoloExitAction(rankedSnapshot())).toEqual({
      label: "Cancel Ranked",
      notifyServer: true,
      countsAsLoss: false,
    });
    expect(getSoloExitAction(rankedSnapshot(1))).toEqual({
      label: "Abandon Ranked",
      notifyServer: true,
      countsAsLoss: true,
    });
    expect(
      getSoloExitAction({
        ...rankedSnapshot(1),
        rankedAbandonCountsAsLoss: false,
      }),
    ).toEqual({
      label: "Cancel Ranked",
      notifyServer: true,
      countsAsLoss: false,
    });
    expect(
      getSoloExitAction(practiceSnapshot({ status: "completed" })),
    ).toEqual({
      label: "Close",
      notifyServer: false,
      countsAsLoss: false,
    });
  });
});

describe("solo request intents", () => {
  it("builds Ranked and orientation-preserving Practice start intents", () => {
    expect(createRankedSoloStartIntent("ranked-start")).toEqual({
      mode: "ranked",
      commandId: "ranked-start",
    });
    expect(
      createPracticeSoloStartIntent(PRACTICE_RULES, "practice-start"),
    ).toEqual({
      mode: "practice",
      commandId: "practice-start",
      rules: {
        W: 4,
        H: 4,
        scoring: "bbox",
        winScore: 5,
        difficulty: "coffee",
        humanPlayer: 1,
        firstPlayer: 1,
      },
    });
    expect(() => createRankedSoloStartIntent(" ")).toThrow(TypeError);
  });

  it("retains a start command for retries until the selected intent changes", () => {
    const practiceIntentKey = createSoloStartIntentKey({
      mode: "practice",
      rules: PRACTICE_RULES,
    });
    let commandSequence = 0;
    const createCommandId = () => `start-${++commandSequence}`;

    const firstAttempt = getOrCreateSoloStartCommand(
      null,
      practiceIntentKey,
      createCommandId,
    );
    const retry = getOrCreateSoloStartCommand(
      firstAttempt,
      practiceIntentKey,
      createCommandId,
    );
    expect(retry).toBe(firstAttempt);
    expect(commandSequence).toBe(1);

    const changedIntent = getOrCreateSoloStartCommand(
      retry,
      createSoloStartIntentKey({
        mode: "practice",
        rules: { ...PRACTICE_RULES, difficulty: "brutal" },
      }),
      createCommandId,
    );
    expect(changedIntent.commandId).toBe("start-2");
    expect(commandSequence).toBe(2);
  });

  it("uses the canonical game and revision for move and abandon intents", () => {
    const snapshot = practiceSnapshot();
    expect(createSoloMoveIntent(snapshot, 2, 1, "move-command")).toEqual({
      gameId: "practice-game",
      x: 2,
      y: 1,
      expectedRevision: 3,
      commandId: "move-command",
    });
    expect(createSoloAbandonIntent(snapshot, "leave-command")).toEqual({
      gameId: "practice-game",
      expectedRevision: 3,
      commandId: "leave-command",
    });
    expect(() => createSoloMoveIntent(snapshot, 1.5, 1, "command")).toThrow(
      RangeError,
    );
    expect(() => createSoloAbandonIntent(snapshot, " ")).toThrow(TypeError);
  });
});

describe("solo share presentation", () => {
  it("marks only a confirmed posted response as complete", () => {
    expect(
      getSoloSharePresentation({
        status: "posted",
        message: "Win shared to r/Euclid.",
      }),
    ).toEqual({
      completed: true,
      notice: "Win shared to r/Euclid.",
    });

    expect(
      getSoloSharePresentation({
        status: "pending",
        message: "The win is prepared.",
      }),
    ).toEqual({
      completed: false,
      notice: "The win is prepared. Posting has not been confirmed yet.",
    });
  });

  it("does not report completion when the API status is missing", () => {
    expect(getSoloSharePresentation({})).toEqual({
      completed: false,
      notice:
        "Reddit did not return a confirmed share status. Please try again.",
    });
  });
});
