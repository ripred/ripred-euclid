import { describe, expect, it } from "vitest";

import type {
  CanonicalBoardSnapshot,
  H2HCanonicalState,
  H2HMoveResponse,
  SharePoint,
  ShareSquare,
  SoloMoveEvent,
} from "../shared/types/api";
import {
  didH2HHistoryReset,
  formatScoreFeedback,
  formatSquareCount,
  gridFootprintBounds,
  normalizeSoloScoreFeedback,
  resolvePendingH2HScoreFeedback,
  scoreFeedbackFromH2HMove,
  scoreFeedbackFromH2HSnapshot,
  scoreFeedbackId,
  selectSquareLines,
  squareSignature,
} from "./score-feedback";

const point = (x: number, y: number, width = 8): SharePoint => ({
  x,
  y,
  index: x < 0 || y < 0 ? -1 : y * width + x,
});

const h2hScoringHistory = [
  point(0, 0),
  point(7, 7),
  point(1, 0),
  point(6, 7),
  point(0, 1),
  point(5, 7),
  point(1, 1),
];

function cellsFromHistory(history: readonly SharePoint[]): number[] {
  const cells = new Array<number>(64).fill(0);
  history.forEach((move, moveIndex) => {
    cells[move.index] = (moveIndex % 2) + 1;
  });
  return cells;
}

const square = (
  corners: readonly [SharePoint, SharePoint, SharePoint, SharePoint],
  clr: 1 | 2,
  points = 4,
): ShareSquare => ({
  p1: corners[0],
  p2: corners[1],
  p3: corners[2],
  p4: corners[3],
  points,
  remain: 0,
  clr,
});

const firstSquare = square(
  [point(0, 0), point(1, 0), point(0, 1), point(1, 1)],
  1,
);
const secondSquare = square(
  [point(2, 0), point(3, 0), point(2, 1), point(3, 1)],
  2,
);

function boardSnapshot({
  history = [],
  cells = new Array<number>(64).fill(0),
  last = point(-1, -1),
  lastPoints = 0,
  firstSquares = [],
  secondSquares = [],
  scoring = "bbox",
}: {
  history?: SharePoint[];
  cells?: number[];
  last?: SharePoint;
  lastPoints?: number;
  firstSquares?: ShareSquare[];
  secondSquares?: ShareSquare[];
  scoring?: "bbox" | "true";
} = {}): CanonicalBoardSnapshot {
  return {
    W: 8,
    H: 8,
    scoring,
    winScore: 150,
    m_board: cells,
    m_players: [
      {
        m_squares: firstSquares,
        m_score: firstSquares.reduce((total, item) => total + item.points, 0),
        m_lastNumSquares: firstSquares.length,
        m_playStyle: 0,
        m_goofs: false,
        m_computer: false,
        userId: "first",
      },
      {
        m_squares: secondSquares,
        m_score: secondSquares.reduce((total, item) => total + item.points, 0),
        m_lastNumSquares: secondSquares.length,
        m_playStyle: 0,
        m_goofs: false,
        m_computer: false,
        userId: "second",
      },
    ],
    m_turn: 0,
    m_history: history,
    m_displayed_game_over: false,
    m_onlyShowLastSquares: false,
    m_createRandomizedRangeOrder: false,
    m_stopAt150: true,
    m_last: last,
    m_lastPoints: lastPoints,
    revision: history.length,
    rulesVersion: 1,
  };
}

function h2hState(
  gameId: string,
  board: CanonicalBoardSnapshot,
): H2HCanonicalState {
  return {
    gameId,
    board,
    revision: board.revision,
    rulesVersion: board.rulesVersion,
    ended: false,
    endedReason: null,
    endedBy: null,
    victorSide: null,
  };
}

describe("solo score feedback", () => {
  it("filters non-scoring moves and preserves two-event response order", () => {
    const events: SoloMoveEvent[] = [
      {
        type: "move",
        revision: 8,
        actor: "human",
        player: 0,
        point: point(1, 1),
        pointsScored: 4,
        completedSquares: [firstSquare],
      },
      {
        type: "move",
        revision: 9,
        actor: "ai",
        player: 1,
        point: point(3, 1),
        pointsScored: 0,
        completedSquares: [],
      },
      {
        type: "move",
        revision: 10,
        actor: "ai",
        player: 1,
        point: point(3, 1),
        pointsScored: 4,
        completedSquares: [secondSquare],
      },
    ];

    expect(normalizeSoloScoreFeedback("solo:one", events, "bbox")).toEqual([
      expect.objectContaining({
        id: "solo:one:8",
        moveCount: 8,
        player: 0,
        pointsScored: 4,
      }),
      expect.objectContaining({
        id: "solo:one:10",
        moveCount: 10,
        player: 1,
        pointsScored: 4,
      }),
    ]);
  });

  it("copies canonical square data before it is queued", () => {
    const source = square(
      [point(0, 0), point(1, 0), point(0, 1), point(1, 1)],
      1,
    );
    const feedback = normalizeSoloScoreFeedback(
      "solo-copy",
      [
        {
          type: "move",
          revision: 4,
          actor: "human",
          player: 0,
          point: point(1, 1),
          pointsScored: 4,
          completedSquares: [source],
        },
      ],
      "bbox",
    )[0];

    source.p1.x = 7;
    expect(feedback?.completedSquares[0]?.p1.x).toBe(0);
  });
});

describe("H2H score feedback", () => {
  it("uses the exact accepted-move delta and canonical history count", () => {
    const last = h2hScoringHistory.at(-1)!;
    const board = boardSnapshot({
      history: h2hScoringHistory,
      cells: cellsFromHistory(h2hScoringHistory),
      last,
      lastPoints: 4,
      firstSquares: [firstSquare],
    });
    const response: H2HMoveResponse = {
      ...h2hState("h2h-one", board),
      ok: true,
      accepted: true,
      pointsScored: 4,
      completedSquares: [firstSquare],
    };

    expect(scoreFeedbackFromH2HMove(response)).toMatchObject({
      id: "h2h-one:7",
      player: 0,
      point: last,
      pointsScored: 4,
      completedSquares: [firstSquare],
    });
  });

  it("filters rejected and accepted zero-score responses", () => {
    const emptyBoard = boardSnapshot();
    const rejected: H2HMoveResponse = {
      ...h2hState("h2h-one", emptyBoard),
      ok: false,
      accepted: false,
      reason: "cell_occupied",
      message: "Occupied.",
      pointsScored: 0,
      completedSquares: [],
    };
    expect(scoreFeedbackFromH2HMove(rejected)).toBeNull();

    const last = point(0, 0);
    const cells = new Array<number>(64).fill(0);
    cells[last.index] = 1;
    const accepted: H2HMoveResponse = {
      ...h2hState("h2h-one", boardSnapshot({ history: [last], cells, last })),
      ok: true,
      accepted: true,
      pointsScored: 0,
      completedSquares: [],
    };
    expect(scoreFeedbackFromH2HMove(accepted)).toBeNull();
  });

  it("derives only the latest polling delta from a previously empty point", () => {
    const latest = h2hScoringHistory.at(-1)!;
    const previousHistory = h2hScoringHistory.slice(0, -1);
    const previousCells = cellsFromHistory(previousHistory);
    const currentCells = cellsFromHistory(h2hScoringHistory);
    const unrelatedSquare = square(
      [point(4, 4), point(5, 4), point(4, 5), point(5, 5)],
      1,
    );
    const previous = h2hState(
      "h2h-poll",
      boardSnapshot({
        history: previousHistory,
        cells: previousCells,
        last: previousHistory.at(-1)!,
      }),
    );
    const current = h2hState(
      "h2h-poll",
      boardSnapshot({
        history: h2hScoringHistory,
        cells: currentCells,
        last: latest,
        lastPoints: 4,
        firstSquares: [unrelatedSquare, firstSquare],
      }),
    );

    expect(scoreFeedbackFromH2HSnapshot(previous, current)).toMatchObject({
      id: "h2h-poll:7",
      player: 0,
      point: latest,
      pointsScored: 4,
      completedSquares: [firstSquare],
    });
  });

  it("establishes quiet baselines and suppresses equal or inconsistent polls", () => {
    const baseline = h2hState("h2h-poll", boardSnapshot());
    expect(scoreFeedbackFromH2HSnapshot(null, baseline)).toBeNull();
    expect(scoreFeedbackFromH2HSnapshot(baseline, baseline)).toBeNull();

    const occupiedBefore = new Array<number>(64).fill(0);
    occupiedBefore[point(1, 1).index] = 2;
    const previous = h2hState(
      "h2h-poll",
      boardSnapshot({ cells: occupiedBefore }),
    );
    const current = h2hState(
      "h2h-poll",
      boardSnapshot({
        history: [point(1, 1)],
        cells: occupiedBefore,
        last: point(1, 1),
        lastPoints: 4,
        secondSquares: [firstSquare],
      }),
    );
    expect(scoreFeedbackFromH2HSnapshot(previous, current)).toBeNull();
  });

  it("recognizes same-ID rematches without treating another game as a reset", () => {
    const longGame = h2hState(
      "same",
      boardSnapshot({ history: [point(0, 0), point(7, 7)] }),
    );
    const rematch = h2hState("same", boardSnapshot());
    const fastRematch = h2hState(
      "same",
      boardSnapshot({ history: [point(3, 3), point(4, 4)] }),
    );
    const anotherGame = h2hState("different", boardSnapshot());
    const emptyEndedRound = {
      ...h2hState("same", boardSnapshot()),
      ended: true,
      endedReason: "player_left" as const,
      endedBy: "first",
      victorSide: 2 as const,
    };

    expect(didH2HHistoryReset(longGame, rematch)).toBe(true);
    expect(didH2HHistoryReset(longGame, fastRematch)).toBe(true);
    expect(didH2HHistoryReset(emptyEndedRound, rematch)).toBe(true);
    expect(didH2HHistoryReset(longGame, anotherGame)).toBe(false);
    expect(didH2HHistoryReset(null, rematch)).toBe(false);
  });

  it("orders an exact pending move before a newer terminal poll tail", () => {
    const history = [
      point(0, 0),
      point(2, 0),
      point(1, 0),
      point(3, 0),
      point(0, 1),
      point(2, 1),
      point(1, 1),
      point(3, 1),
    ];
    const baseline = h2hState(
      "pending-race",
      boardSnapshot({
        history: history.slice(0, 6),
        cells: cellsFromHistory(history.slice(0, 6)),
        last: history[5]!,
      }),
    );
    const acceptedBoard = boardSnapshot({
      history: history.slice(0, 7),
      cells: cellsFromHistory(history.slice(0, 7)),
      last: history[6]!,
      lastPoints: 4,
      firstSquares: [firstSquare],
    });
    const acceptedResponse: H2HMoveResponse = {
      ...h2hState("pending-race", acceptedBoard),
      ok: true,
      accepted: true,
      pointsScored: 4,
      completedSquares: [firstSquare],
    };
    const deferred: H2HCanonicalState = {
      ...h2hState(
        "pending-race",
        boardSnapshot({
          history,
          cells: cellsFromHistory(history),
          last: history[7]!,
          lastPoints: 4,
          firstSquares: [firstSquare],
          secondSquares: [secondSquare],
        }),
      ),
      ended: true,
      endedReason: "game_over",
      victorSide: 2,
    };

    const resolution = resolvePendingH2HScoreFeedback({
      acceptedFeedback: scoreFeedbackFromH2HMove(acceptedResponse),
      submittedRoundEpoch: 3,
      currentRoundEpoch: 3,
      baseline,
      deferred,
    });

    expect(resolution.baseline).toBe(deferred);
    expect(resolution.events.map((event) => event.id)).toEqual([
      "pending-race:7",
      "pending-race:8",
    ]);
    expect(resolution.events.map((event) => event.player)).toEqual([0, 1]);
  });

  it("suppresses delayed exact feedback after a same-ID round reset", () => {
    const oldRound = h2hState(
      "same-game",
      boardSnapshot({ history: h2hScoringHistory }),
    );
    const acceptedFeedback = scoreFeedbackFromH2HMove({
      ...oldRound,
      ok: true,
      accepted: true,
      board: boardSnapshot({
        history: h2hScoringHistory,
        cells: cellsFromHistory(h2hScoringHistory),
        last: h2hScoringHistory.at(-1)!,
        lastPoints: 4,
        firstSquares: [firstSquare],
      }),
      pointsScored: 4,
      completedSquares: [firstSquare],
    });
    const newRound = h2hState("same-game", boardSnapshot());

    expect(
      resolvePendingH2HScoreFeedback({
        acceptedFeedback,
        submittedRoundEpoch: 4,
        currentRoundEpoch: 5,
        baseline: newRound,
        deferred: null,
      }),
    ).toEqual({ baseline: newRound, events: [] });
  });
});

describe("score presentation geometry and copy", () => {
  it("creates stable signatures regardless of corner ordering", () => {
    const reordered = square(
      [firstSquare.p4, firstSquare.p2, firstSquare.p1, firstSquare.p3],
      1,
    );
    expect(squareSignature(reordered)).toBe(squareSignature(firstSquare));
    expect(scoreFeedbackId("game", 12)).toBe("game:12");
  });

  it("returns footprint bounds only when the rule is Grid Footprint", () => {
    const rotated = square(
      [point(2, 0), point(4, 2), point(2, 4), point(0, 2)],
      1,
      25,
    );
    expect(gridFootprintBounds(rotated, "bbox")).toEqual({
      x: 0,
      y: 0,
      width: 5,
      height: 5,
    });
    expect(gridFootprintBounds(rotated, "true")).toBeNull();
  });

  it("uses singular and plural square copy", () => {
    expect(formatSquareCount(1)).toBe("1 square");
    expect(formatSquareCount(2)).toBe("2 squares");
    expect(
      formatScoreFeedback({
        pointsScored: 8,
        completedSquares: [firstSquare, secondSquare],
      }),
    ).toBe("+8 · 2 squares");
  });

  it("keeps active lines visible and out of the optional historical layer", () => {
    expect(
      selectSquareLines(
        [firstSquare, secondSquare, firstSquare],
        [secondSquare, secondSquare],
        true,
      ),
    ).toEqual({ historical: [firstSquare], active: [secondSquare] });
    expect(
      selectSquareLines([firstSquare, secondSquare], [secondSquare], false),
    ).toEqual({ historical: [], active: [secondSquare] });
  });
});
