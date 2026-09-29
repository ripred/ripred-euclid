import { describe, expect, it } from "vitest";

import type { SharePoint } from "../shared/types/api";
import type { GameVariant } from "../shared/game/rules";
import {
  H2H_CHAT_MAX_ITEMS,
  H2H_CHAT_MAX_LENGTH,
  H2H_SCHEMA_VERSION,
  H2HDomainError,
  H2H_RULES,
  appendH2HChat,
  applyH2HMove,
  createH2HCanonicalState,
  createH2HRematch,
  createInitialH2HBoard,
  endH2HByDeparture,
  normalizeH2HBoard,
  type H2HBoardSnapshot,
  type H2HMoveAcceptedResponse,
} from "./h2h";

const INITIAL_TIME = 100;

function point(index: number): SharePoint {
  return {
    x: index % H2H_RULES.W,
    y: Math.floor(index / H2H_RULES.W),
    index,
  };
}

function initialBoard(
  now = INITIAL_TIME,
  variant: GameVariant = "standard",
): H2HBoardSnapshot {
  return createInitialH2HBoard("p1", "p2", { now, variant });
}

function expectDomainError(
  action: () => unknown,
  code: string,
): H2HDomainError {
  try {
    action();
  } catch (error) {
    expect(error).toBeInstanceOf(H2HDomainError);
    expect(error).toMatchObject({ code });
    return error as H2HDomainError;
  }
  throw new Error(`Expected H2H domain error: ${code}`);
}

function applyIndex(
  board: H2HBoardSnapshot,
  index: number,
  now: number,
): H2HMoveAcceptedResponse {
  const userId = board.m_players[board.m_turn].userId;
  return applyH2HMove(
    board,
    userId,
    {
      gameId: "game",
      x: index % H2H_RULES.W,
      y: Math.floor(index / H2H_RULES.W),
      expectedRevision: board.revision,
    },
    now,
  );
}

function playMoves(
  indexes: readonly number[],
  startTime = INITIAL_TIME,
  variant: GameVariant = "standard",
): H2HBoardSnapshot {
  let board = initialBoard(startTime, variant);
  indexes.forEach((index, offset) => {
    const result = applyIndex(board, index, startTime + offset + 1);
    if (result.ended && offset !== indexes.length - 1) {
      throw new Error("Fixture attempted to continue a completed game.");
    }
    board = result.board;
  });
  return board;
}

function squareBoard(): H2HBoardSnapshot {
  return playMoves([0, 63, 1, 62, 8, 61, 9]);
}

function terminalBoard(
  source: H2HBoardSnapshot = initialBoard(),
  startTime = source.lastSaved,
): H2HBoardSnapshot {
  let board = source;
  const firstPlayerIndexes = [
    0, 7, 56, 63, 1, 6, 49, 54, 8, 15, 48, 55, 2, 5, 42, 45,
  ];
  const reserved = new Set(firstPlayerIndexes);
  const secondPlayerIndexes = [...Array(H2H_RULES.W * H2H_RULES.H).keys()]
    .filter((index) => !reserved.has(index))
    .reverse();
  let firstOffset = 0;
  let secondOffset = 0;

  for (let moveNumber = 0; moveNumber < 64; moveNumber++) {
    const index =
      board.m_turn === 0
        ? firstPlayerIndexes[firstOffset++]
        : secondPlayerIndexes[secondOffset++];
    if (index === undefined) break;
    const result = applyIndex(board, index, startTime + moveNumber + 1);
    board = result.board;
    if (result.ended) return board;
  }
  throw new Error("Terminal fixture did not reach a legal outcome.");
}

function asRecord(board: H2HBoardSnapshot): Record<string, unknown> {
  return structuredClone(board) as unknown as Record<string, unknown>;
}

describe("H2H Tide replay", () => {
  const rowMoves = (count: number) =>
    Array.from(
      { length: count },
      (_, index) => (Math.floor(index / 2) % 6) + (index % 2 === 0 ? 0 : 56),
    );

  it("replays expired positions and permits the next player to reuse them", () => {
    const board = playMoves(rowMoves(12), INITIAL_TIME, "tide");
    expect(board.m_board[0]).toBe(0);
    expect(board.m_history[0]).toEqual(point(0));
    const next = applyIndex(board, 0, 113);
    expect(next.board.m_board[0]).toBe(1);
    expect(next.board.m_history[12]).toEqual(point(0));
    expect(normalizeH2HBoard(JSON.parse(JSON.stringify(next.board)))).toEqual(
      next.board,
    );
    expectDomainError(() => applyIndex(next.board, 1, 114), "cell_occupied");
  });

  it("keeps square corners anchored after their original expiration", () => {
    const board = playMoves(
      [0, 56, 1, 57, 8, 58, 9, 59, 2, 60, 3, 61, 4, 62, 5, 63],
      INITIAL_TIME,
      "tide",
    );
    for (const index of [0, 1, 8, 9]) {
      expect(board.m_board[index]).toBe(1);
      expect(board.tide?.anchored[index]).toBe(true);
    }
    expect(board.m_players[0].m_score).toBe(4);
    expect(normalizeH2HBoard(board)).toEqual(board);
  });

  it("ends a tied 60-move round and rejects continuation", () => {
    const board = playMoves(rowMoves(60), INITIAL_TIME, "tide");
    expect(createH2HCanonicalState("game", board)).toMatchObject({
      ended: true,
      endedReason: "tie",
      victorSide: null,
    });
    expectDomainError(() => applyIndex(board, 0, 161), "game_ended");
    const forged = structuredClone(board);
    forged.m_history.push(point(0));
    expectDomainError(() => normalizeH2HBoard(forged), "invalid_board");
  });

  it("awards the higher score at the Tide move limit without reaching 150", () => {
    const indexes = [0, 56, 1, 57, 8, 58, 9];
    let firstOffset = 0;
    let secondOffset = 3;
    while (indexes.length < 60) {
      indexes.push(
        indexes.length % 2 === 0
          ? 2 + (firstOffset++ % 6)
          : 56 + (secondOffset++ % 6),
      );
    }
    const board = playMoves(indexes, INITIAL_TIME, "tide");
    expect(board.m_players.map((player) => player.m_score)).toEqual([4, 0]);
    expect(createH2HCanonicalState("game", board)).toMatchObject({
      ended: true,
      endedReason: "game_over",
      victorSide: 1,
    });
  });

  it.each(["expires", "anchored", "missing", "standard", "unknown"])(
    "rejects forged %s Tide metadata",
    (field) => {
      const source = asRecord(playMoves(rowMoves(13), INITIAL_TIME, "tide"));
      const tide = source.tide as { expires: number[]; anchored: boolean[] };
      if (field === "expires") tide.expires[0] = 999;
      else if (field === "anchored") tide.anchored[0] = true;
      else if (field === "missing") delete source.tide;
      else source.variant = field;
      expectDomainError(() => normalizeH2HBoard(source), "invalid_board");
    },
  );

  it("creates rematches using the explicitly selected new variant", () => {
    const completed = playMoves(rowMoves(60), INITIAL_TIME, "tide");
    const standard = createH2HRematch(completed, "p1", "game", 200, "standard");
    expect(standard.board.variant).toBeUndefined();
    expect(standard.board.tide).toBeUndefined();
    const tide = createH2HRematch(terminalBoard(), "p1", "game", 200, "tide");
    expect(tide.board.variant).toBe("tide");
    expect(tide.board.m_history).toHaveLength(0);
    expect(tide.board.tide?.anchored.every((value) => !value)).toBe(true);
  });
});

describe("H2H replay normalization", () => {
  it.each([
    "W",
    "H",
    "winScore",
    "rulesVersion",
    "schemaVersion",
    "revision",
    "m_board",
    "m_players",
    "m_turn",
    "m_history",
    "m_last",
    "m_lastPoints",
    "m_targets",
    "m_displayed_game_over",
    "m_onlyShowLastSquares",
    "m_stopAt150",
    "m_createRandomizedRangeOrder",
    "createdAt",
    "lastSaved",
    "turnStartedAt",
    "playerNames",
    "playerAvatars",
    "chat",
    "ended",
  ])("rejects a missing current-schema %s field", (field) => {
    const board = asRecord(playMoves([0, 63]));
    delete board[field];
    expectDomainError(() => normalizeH2HBoard(board), "invalid_board");
  });

  it.each([
    ["W", 6],
    ["H", 10],
    ["winScore", 200],
    ["rulesVersion", 2],
    ["schemaVersion", 1],
    ["m_stopAt150", false],
    ["m_createRandomizedRangeOrder", false],
  ])("rejects an explicit incompatible %s", (field, value) => {
    const board = asRecord(initialBoard());
    board[field] = value;

    expectDomainError(() => normalizeH2HBoard(board), "invalid_board");
  });

  it.each([
    {
      name: "wrong cell count",
      mutate: (board: H2HBoardSnapshot) => board.m_board.pop(),
    },
    {
      name: "invalid cell value",
      mutate: (board: H2HBoardSnapshot) => {
        board.m_board[0] = 3;
      },
    },
    {
      name: "occupied cell omitted from history",
      mutate: (board: H2HBoardSnapshot) => {
        board.m_board[1] = 1;
      },
    },
    {
      name: "history move omitted from cells",
      mutate: (board: H2HBoardSnapshot) => {
        board.m_board[63] = 0;
      },
    },
    {
      name: "history color not alternating",
      mutate: (board: H2HBoardSnapshot) => {
        board.m_board[63] = 1;
      },
    },
    {
      name: "duplicate occupied history cell",
      mutate: (board: H2HBoardSnapshot) => {
        board.m_history[1] = point(0);
      },
    },
  ])("rejects $name", ({ mutate }) => {
    const board = playMoves([0, 63]);
    mutate(board);

    expectDomainError(() => normalizeH2HBoard(board), "invalid_board");
  });

  it("rejects history that continues after a legal terminal position", () => {
    const board = terminalBoard();
    const freeIndex = board.m_board.findIndex((cell) => cell === 0);
    expect(freeIndex).toBeGreaterThanOrEqual(0);
    board.m_board[freeIndex] = board.m_turn + 1;
    board.m_history.push(point(freeIndex));
    board.revision++;

    expectDomainError(() => normalizeH2HBoard(board), "invalid_board");
  });

  it("rejects duplicate participant identities", () => {
    const board = initialBoard();
    board.m_players[1].userId = "p1";

    expectDomainError(() => normalizeH2HBoard(board), "invalid_board");
  });

  it("rejects a turn that contradicts replayed history", () => {
    const board = playMoves([0]);
    board.m_turn = 0;

    expectDomainError(() => normalizeH2HBoard(board), "invalid_board");
  });

  it("rejects a revision behind the replayed move count", () => {
    const board = playMoves([0, 63]);
    board.revision = 1;

    expectDomainError(() => normalizeH2HBoard(board), "invalid_board");
  });

  it.each([
    {
      name: "score",
      mutate: (board: H2HBoardSnapshot) => board.m_players[0].m_score++,
    },
    {
      name: "completed squares",
      mutate: (board: H2HBoardSnapshot) => board.m_players[0].m_squares.pop(),
    },
    {
      name: "last-square count",
      mutate: (board: H2HBoardSnapshot) =>
        board.m_players[0].m_lastNumSquares++,
    },
    {
      name: "last move",
      mutate: (board: H2HBoardSnapshot) => {
        board.m_last = point(8);
      },
    },
    {
      name: "last move score",
      mutate: (board: H2HBoardSnapshot) => board.m_lastPoints++,
    },
  ])("rejects a stored $name that contradicts replay", ({ mutate }) => {
    const board = squareBoard();
    mutate(board);

    expectDomainError(() => normalizeH2HBoard(board), "invalid_board");
  });

  it("accepts completed squares in a different storage order", () => {
    const board = playMoves([0, 63, 1, 62, 8, 61, 9, 60, 2, 59, 10]);
    board.m_players[0].m_squares.reverse();

    expect(normalizeH2HBoard(board).m_players[0].m_squares).toHaveLength(
      board.m_players[0].m_squares.length,
    );
  });

  it.each([
    {
      name: "invalid AI target",
      mutate: (board: H2HBoardSnapshot) => {
        board.m_targets = ["0,1,8,9", null];
      },
    },
    {
      name: "computer participant",
      mutate: (board: H2HBoardSnapshot) => {
        board.m_players[0].m_computer = true;
      },
    },
    {
      name: "timestamp regression",
      mutate: (board: H2HBoardSnapshot) => {
        board.createdAt = 101;
        board.lastSaved = 100;
      },
    },
  ])("rejects $name", ({ mutate }) => {
    const board = initialBoard();
    mutate(board);

    expectDomainError(() => normalizeH2HBoard(board), "invalid_board");
  });
});

describe("H2H end-state validation", () => {
  it("rejects an unsupported end reason", () => {
    const board = initialBoard();
    board.ended = true;
    board.endedReason = "unsupported";
    board.endedBy = "p1";

    expectDomainError(
      () => createH2HCanonicalState("game", board),
      "invalid_board",
    );
  });

  it.each([
    {
      name: "ended running board without a reason",
      mutate: (board: H2HBoardSnapshot) => {
        board.ended = true;
      },
    },
    {
      name: "scored outcome on a running board",
      mutate: (board: H2HBoardSnapshot) => {
        board.ended = true;
        board.endedReason = "game_over";
      },
    },
    {
      name: "tie outcome on a running board",
      mutate: (board: H2HBoardSnapshot) => {
        board.ended = true;
        board.endedReason = "tie";
      },
    },
    {
      name: "departure by a nonparticipant",
      mutate: (board: H2HBoardSnapshot) => {
        board.ended = true;
        board.endedReason = "player_left";
        board.endedBy = "intruder";
      },
    },
    {
      name: "reason on an explicitly live board",
      mutate: (board: H2HBoardSnapshot) => {
        board.ended = false;
        board.endedReason = "player_left";
        board.endedBy = "p1";
      },
    },
    {
      name: "departure without an identity",
      mutate: (board: H2HBoardSnapshot) => {
        board.ended = true;
        board.endedReason = "player_left";
      },
    },
  ])("rejects $name", ({ mutate }) => {
    const board = initialBoard();
    mutate(board);

    expectDomainError(
      () => createH2HCanonicalState("game", board),
      "invalid_board",
    );
  });

  it("rejects live flags and departure metadata on a terminal replay", () => {
    const terminal = terminalBoard();
    const live = structuredClone(terminal);
    live.ended = false;
    delete live.endedReason;
    const departure = structuredClone(terminal);
    departure.ended = true;
    departure.endedReason = "player_left";
    departure.endedBy = "p1";

    expectDomainError(() => normalizeH2HBoard(live), "invalid_board");
    expectDomainError(() => normalizeH2HBoard(departure), "invalid_board");
  });

  it("rejects a terminal reason or departure identity that contradicts replay", () => {
    const terminal = terminalBoard();
    expect(terminal.endedReason).toBe("game_over");
    const wrongReason = structuredClone(terminal);
    wrongReason.endedReason = "tie";
    const endedBy = structuredClone(terminal);
    endedBy.endedBy = "p1";

    expectDomainError(() => normalizeH2HBoard(wrongReason), "invalid_board");
    expectDomainError(() => normalizeH2HBoard(endedBy), "invalid_board");
  });
});

describe("H2H move intent", () => {
  it("applies a legal scoring move without mutating its source", () => {
    const source = playMoves([0, 63, 1, 62, 8, 61]);
    const before = structuredClone(source);

    const result = applyIndex(source, 9, 200);

    expect(source).toEqual(before);
    expect(result).toMatchObject({
      ok: true,
      accepted: true,
      gameId: "game",
      revision: 7,
      pointsScored: 4,
      ended: false,
    });
    expect(result.completedSquares).toHaveLength(1);
    expect(result.board.m_board[9]).toBe(1);
    expect(result.board.m_turn).toBe(1);
    expect(result.board.m_last).toEqual(point(9));
    expect(result.board.m_lastPoints).toBe(4);
    expect(result.board.m_history.at(-1)).toEqual(point(9));
    expect(result.board.m_players[0]).toMatchObject({
      m_score: 4,
      m_lastNumSquares: 1,
    });
    expect(result.board).toMatchObject({ lastSaved: 200, createdAt: 100 });
  });

  it("rejects stale revisions and returns canonical state on the error", () => {
    const board = initialBoard();
    const error = expectDomainError(
      () =>
        applyH2HMove(
          board,
          "p1",
          { gameId: "game", x: 0, y: 0, expectedRevision: 1 },
          101,
        ),
      "stale_revision",
    );

    expect(error.state).toMatchObject({ gameId: "game", revision: 0 });
    expect(board.revision).toBe(0);
  });

  it("rejects nonparticipants without attaching game state", () => {
    const error = expectDomainError(
      () =>
        applyH2HMove(
          initialBoard(),
          "intruder",
          { gameId: "game", x: 0, y: 0, expectedRevision: 0 },
          101,
        ),
      "not_participant",
    );

    expect(error.state).toBeUndefined();
  });

  it("rejects a participant moving out of turn", () => {
    const board = playMoves([0]);

    expectDomainError(
      () =>
        applyH2HMove(
          board,
          "p1",
          { gameId: "game", x: 1, y: 0, expectedRevision: 1 },
          102,
        ),
      "not_your_turn",
    );
  });

  it.each([
    { name: "occupied", x: 0, y: 0, code: "cell_occupied" },
    { name: "negative", x: -1, y: 0, code: "out_of_range" },
    { name: "too large", x: 8, y: 0, code: "out_of_range" },
    { name: "fractional", x: 1.5, y: 0, code: "out_of_range" },
  ])("rejects $name cells", ({ x, y, code }) => {
    const board = playMoves([0, 63]);

    expectDomainError(
      () =>
        applyH2HMove(
          board,
          "p1",
          { gameId: "game", x, y, expectedRevision: 2 },
          103,
        ),
      code,
    );
  });

  it("rejects moves after a canonical departure", () => {
    const ended = endH2HByDeparture(initialBoard(), "p1", "game", 101);

    expectDomainError(
      () =>
        applyH2HMove(
          ended.board,
          "p2",
          { gameId: "game", x: 0, y: 0, expectedRevision: 1 },
          102,
        ),
      "game_ended",
    );
  });

  it("requires explicit, monotonic mutation timestamps", () => {
    const board = initialBoard(100);

    expectDomainError(
      () =>
        applyH2HMove(
          board,
          "p1",
          { gameId: "game", x: 0, y: 0, expectedRevision: 0 },
          99,
        ),
      "invalid_request",
    );
  });
});

describe("H2H departure, chat, and rematch transitions", () => {
  it("ends by departure with one revision, a timestamp, and no mutation", () => {
    const source = playMoves([0, 63]);
    const before = structuredClone(source);

    const state = endH2HByDeparture(source, "p1", "game", 150);

    expect(source).toEqual(before);
    expect(state).toMatchObject({
      revision: 3,
      ended: true,
      endedReason: "player_left",
      endedBy: "p1",
      victorSide: 2,
    });
    expect(state.board).toMatchObject({ lastSaved: 150, createdAt: 100 });
  });

  it("validates departure participant and live state", () => {
    const board = initialBoard();
    const ended = endH2HByDeparture(board, "p1", "game", 101);

    expectDomainError(
      () => endH2HByDeparture(board, "intruder", "game", 101),
      "not_participant",
    );
    expectDomainError(
      () => endH2HByDeparture(ended.board, "p2", "game", 102),
      "game_ended",
    );
  });

  it("appends canonical chat with one revision and no mutation", () => {
    const source = initialBoard();
    const before = structuredClone(source);

    const result = appendH2HChat(
      source,
      "p1",
      "game",
      "  hello\r\nthere  ",
      101,
    );

    expect(source).toEqual(before);
    expect(result.item).toEqual({
      id: 1,
      ts: 101,
      sender: "p1",
      text: "hello there",
    });
    expect(result.state).toMatchObject({ revision: 1, ended: false });
    expect(result.state.board).toMatchObject({
      lastSaved: 101,
      chat: { seq: 1, items: [result.item] },
    });
  });

  it("keeps chat sequence unique while retaining only the newest items", () => {
    const items = [...Array(H2H_CHAT_MAX_ITEMS).keys()].map((offset) => ({
      id: offset + 1,
      ts: offset + 1,
      sender: offset % 2 === 0 ? "p1" : "p2",
      text: `message ${offset + 1}`,
    }));
    const board = createInitialH2HBoard("p1", "p2", {
      now: 100,
      chat: { seq: H2H_CHAT_MAX_ITEMS, items },
    });

    const result = appendH2HChat(board, "p2", "game", "next", 101);

    expect(result.item.id).toBe(H2H_CHAT_MAX_ITEMS + 1);
    expect(result.state.board.chat?.items).toHaveLength(H2H_CHAT_MAX_ITEMS);
    expect(result.state.board.chat?.items[0]?.id).toBe(2);
    expect(result.state.board.chat?.items.at(-1)).toEqual(result.item);
  });

  it.each([
    { name: "empty", text: " \n " },
    { name: "overlong", text: "x".repeat(H2H_CHAT_MAX_LENGTH + 1) },
  ])("rejects $name chat", ({ text }) => {
    expectDomainError(
      () => appendH2HChat(initialBoard(), "p1", "game", text, 101),
      "invalid_request",
    );
  });

  it.each([
    {
      name: "duplicate ids",
      chat: {
        seq: 1,
        items: [
          { id: 1, ts: 1, sender: "p1", text: "one" },
          { id: 1, ts: 2, sender: "p2", text: "two" },
        ],
      },
    },
    {
      name: "sequence behind items",
      chat: {
        seq: 0,
        items: [{ id: 1, ts: 1, sender: "p1", text: "one" }],
      },
    },
    {
      name: "nonparticipant sender",
      chat: {
        seq: 1,
        items: [{ id: 1, ts: 1, sender: "intruder", text: "one" }],
      },
    },
  ])("rejects stored chat with $name", ({ chat }) => {
    const board = asRecord(initialBoard());
    board.chat = chat;

    expectDomainError(() => normalizeH2HBoard(board), "invalid_board");
  });

  it("rejects chat from nonparticipants and after game end", () => {
    const board = initialBoard();
    const ended = endH2HByDeparture(board, "p1", "game", 101);

    expectDomainError(
      () => appendH2HChat(board, "intruder", "game", "hello", 101),
      "not_participant",
    );
    expectDomainError(
      () => appendH2HChat(ended.board, "p2", "game", "hello", 102),
      "game_ended",
    );
  });

  it("rematches with monotonic revision and reset play/chat state", () => {
    const named = createInitialH2HBoard("p1", "p2", {
      now: 100,
      names: { p1: "One", p2: "Two" },
      avatars: { p1: "one.png", p2: "two.png" },
    });
    const chatted = appendH2HChat(named, "p1", "game", "again?", 101).state;
    const ended = terminalBoard(chatted.board);
    const before = structuredClone(ended);
    const rematchTime = ended.lastSaved + 1;

    const rematch = createH2HRematch(ended, "p2", "game", rematchTime);

    expect(ended).toEqual(before);
    expect(ended.endedReason).toBe("game_over");
    expect(rematch).toMatchObject({
      gameId: "game",
      revision: ended.revision + 1,
      ended: false,
      endedReason: null,
      endedBy: null,
      victorSide: null,
    });
    expect(rematch.board).toMatchObject({
      createdAt: 100,
      lastSaved: rematchTime,
      m_turn: 0,
      m_last: { x: -1, y: -1, index: -1 },
      m_lastPoints: 0,
      playerNames: { p1: "One", p2: "Two" },
      playerAvatars: { p1: "one.png", p2: "two.png" },
      chat: { seq: 0, items: [] },
    });
    expect(rematch.board.m_board.every((cell) => cell === 0)).toBe(true);
    expect(rematch.board.m_history).toEqual([]);
    expect(rematch.board.m_players.map((player) => player.userId)).toEqual([
      "p1",
      "p2",
    ]);
    expect(
      rematch.board.m_players.every(
        (player) => player.m_score === 0 && player.m_squares.length === 0,
      ),
    ).toBe(true);
  });

  it("validates rematch participant, state, and timestamp", () => {
    const board = initialBoard();
    const ended = terminalBoard();

    expectDomainError(
      () => createH2HRematch(board, "p1", "game", 101),
      "invalid_request",
    );
    expectDomainError(
      () => createH2HRematch(ended, "intruder", "game", 200),
      "not_participant",
    );
    expectDomainError(
      () => createH2HRematch(ended, "p2", "game", INITIAL_TIME),
      "invalid_request",
    );
  });

  it("rejects a rematch after a participant departure", () => {
    const ended = endH2HByDeparture(initialBoard(), "p1", "game", 101);

    const error = expectDomainError(
      () => createH2HRematch(ended.board, "p2", "game", 102),
      "invalid_request",
    );
    expect(error.message).toBe(
      "Only a normally completed game can be rematched.",
    );
  });

  it("rejects a completed board without its end reason", () => {
    const board = asRecord(terminalBoard());
    delete board.endedReason;
    expectDomainError(
      () => createH2HRematch(board, "p1", "game", 200),
      "invalid_board",
    );
  });

  it("creates initial metadata without aliasing caller-owned inputs", () => {
    const names = { p1: "One", p2: "Two" };
    const avatars = { p1: "one.png" };
    const chat = {
      seq: 1,
      items: [{ id: 1, ts: 2, sender: "p1", text: "Ready" }],
    };
    const board = createInitialH2HBoard("p1", "p2", {
      names,
      avatars,
      chat,
      now: 42,
    });

    names.p1 = "Changed";
    avatars.p1 = "changed.png";
    chat.items[0]!.text = "Changed";

    expect(board).toMatchObject({
      revision: 0,
      schemaVersion: H2H_SCHEMA_VERSION,
      createdAt: 42,
      lastSaved: 42,
      playerNames: { p1: "One", p2: "Two" },
      playerAvatars: { p1: "one.png" },
      chat: {
        seq: 1,
        items: [{ id: 1, ts: 2, sender: "p1", text: "Ready" }],
      },
    });
  });
});
