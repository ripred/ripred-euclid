import { describe, expect, it } from "vitest";

import {
  RANKED_SOLO_RULES,
  PLAY_STYLES,
  SOLO_RULES_VERSION,
  validatePracticeRules,
} from "../shared/game/rules";
import type { SoloSessionRecord } from "./solo";
import {
  abandonSoloSession,
  applySoloMove,
  createSoloSession,
  normalizeSoloSessionRecord,
  publicSoloSnapshot,
  soloResultForHuman,
  soloTerminalResult,
  validateSoloStartRequest,
  withSoloRating,
} from "./solo";

const START = 2_000_000_000_000;

function ranked(gameId = "ranked-1"): SoloSessionRecord {
  return createSoloSession({
    gameId,
    ownerId: "human-1",
    privateSeed: "private-ranked-seed",
    rules: { ...RANKED_SOLO_RULES },
    now: START,
  }).record;
}

function practice(
  options: {
    gameId?: string;
    humanPlayer?: 0 | 1;
    firstPlayer?: 0 | 1;
    difficulty?: "doofus" | "beginner" | "coffee";
    winScore?: number;
  } = {},
): ReturnType<typeof createSoloSession> {
  return createSoloSession({
    gameId: options.gameId ?? "practice-1",
    ownerId: "human-1",
    privateSeed: "private-practice-seed",
    rules: validatePracticeRules({
      W: 4,
      H: 4,
      scoring: "bbox",
      winScore: options.winScore ?? 20,
      difficulty: options.difficulty ?? "doofus",
      humanPlayer: options.humanPlayer ?? 0,
      firstPlayer: options.firstPlayer ?? 0,
    }),
    now: START,
  });
}

function firstEmpty(record: SoloSessionRecord): { x: number; y: number } {
  const index = record.board.m_board.findIndex((cell) => cell === 0);
  if (index < 0) throw new Error("Expected an empty cell.");
  return {
    x: index % record.rules.W,
    y: Math.floor(index / record.rules.W),
  };
}

function makeHumanMove(
  record: SoloSessionRecord,
  sequence: number,
): ReturnType<typeof applySoloMove> {
  return applySoloMove(
    record,
    {
      gameId: record.gameId,
      ...firstEmpty(record),
      expectedRevision: record.revision,
      commandId: `move-${sequence}`,
    },
    START + sequence,
  );
}

describe("solo request and rules validation", () => {
  it.each(["beginner", "brutal"])(
    "rejects %s as a stored ranked difficulty",
    (difficulty) => {
      const record = ranked();
      expect(() =>
        normalizeSoloSessionRecord({
          ...record,
          rules: { ...record.rules, difficulty },
        }),
      ).toThrow("Ranked solo rules must match the fixed preset");
    },
  );

  it("accepts only the fixed Ranked start shape", () => {
    const record = ranked();
    expect(record.rules.difficulty).toBe("casual");
    expect(record.board.m_players[1]?.m_playStyle).toBe(PLAY_STYLES.CASUAL);
    expect(
      validateSoloStartRequest({ mode: "ranked", commandId: "start-1" }),
    ).toEqual({
      request: { mode: "ranked", commandId: "start-1" },
      rules: RANKED_SOLO_RULES,
    });

    expect(() =>
      validateSoloStartRequest({
        mode: "ranked",
        commandId: "start-1",
        difficulty: "beginner",
      }),
    ).toThrow("unknown field");
  });

  it("strictly canonicalizes Practice start and rejects extra fields", () => {
    const validated = validateSoloStartRequest({
      mode: "practice",
      commandId: "start-2",
      rules: {
        W: 4,
        H: 6,
        scoring: "true",
        winScore: 10,
        difficulty: "coffee",
      },
    });
    expect(validated.rules).toMatchObject({
      mode: "practice",
      rulesVersion: SOLO_RULES_VERSION,
      W: 4,
      H: 6,
      difficulty: "coffee",
    });

    expect(() =>
      validateSoloStartRequest({
        mode: "practice",
        commandId: "start-2",
        rules: {
          W: 4,
          H: 6,
          scoring: "true",
          winScore: 10,
          difficulty: "coffee",
          trustedScore: true,
        },
      }),
    ).toThrow("unknown field");
  });

  it.each([
    null,
    { mode: "ranked" },
    { mode: "ranked", commandId: " padded " },
    { mode: "unknown", commandId: "start" },
  ])("rejects malformed starts %#", (request) => {
    expect(() => validateSoloStartRequest(request)).toThrow();
  });
});

describe("canonical solo creation and deterministic turns", () => {
  it("creates Ranked with no client customization or ambient randomness", () => {
    const first = ranked();
    const second = ranked();

    expect(first).toEqual(second);
    expect(first).toMatchObject({
      schemaVersion: 1,
      revision: 0,
      status: "active",
      humanMoveCount: 0,
      aiMoveCount: 0,
      endedReason: null,
      rules: RANKED_SOLO_RULES,
    });
    expect(first.board.m_turn).toBe(RANKED_SOLO_RULES.humanPlayer);
    expect(normalizeSoloSessionRecord(first, first.gameId)).toEqual(first);
  });

  it.each([
    { humanPlayer: 1 as const, firstPlayer: 0 as const },
    { humanPlayer: 0 as const, firstPlayer: 1 as const },
  ])("applies and records a deterministic opening AI move %#", (order) => {
    const created = practice(order);

    expect(created.record.revision).toBe(1);
    expect(created.record.aiMoveCount).toBe(1);
    expect(created.record.humanMoveCount).toBe(0);
    expect(created.record.board.m_turn).toBe(order.humanPlayer);
    expect(created.events).toHaveLength(1);
    expect(created.events[0]).toMatchObject({
      type: "move",
      actor: "ai",
      player: order.firstPlayer,
      revision: 1,
    });
    expect(normalizeSoloSessionRecord(created.record)).toEqual(created.record);
  });

  it("does not synthesize an opening move when the human goes first", () => {
    const created = practice({ humanPlayer: 1, firstPlayer: 1 });
    expect(created.record.revision).toBe(0);
    expect(created.events).toEqual([]);
  });

  it("returns a seed- and target-redacted defensive copy", () => {
    const record = practice({ humanPlayer: 1, firstPlayer: 0 }).record;
    const snapshot = publicSoloSnapshot(record);

    expect("privateSeed" in snapshot).toBe(false);
    expect("m_targets" in snapshot.board).toBe(false);
    expect("chat" in snapshot.board).toBe(false);
    expect(snapshot.humanMoveCount).toBe(0);
    expect(snapshot.aiMoveCount).toBe(1);

    snapshot.board.m_board[0] = 99;
    expect(record.board.m_board[0]).not.toBe(99);
  });
});

describe("server-authored solo moves", () => {
  it("applies one human move and one deterministic AI reply atomically", () => {
    const before = ranked();
    const result = makeHumanMove(before, 1);

    expect(result.response).toMatchObject({
      ok: true,
      accepted: true,
      replayed: false,
      commandId: "move-1",
    });
    expect(result.response.events.slice(0, 2)).toMatchObject([
      { type: "move", actor: "human", player: 0, revision: 1 },
      { type: "move", actor: "ai", player: 1, revision: 2 },
    ]);
    expect(result.record.revision).toBe(2);
    expect(result.record.humanMoveCount).toBe(1);
    expect(result.record.aiMoveCount).toBe(1);
    expect(result.record.board.m_turn).toBe(0);
    expect(normalizeSoloSessionRecord(result.record)).toEqual(result.record);
  });

  it("returns canonical rejections without mutating state", () => {
    const before = ranked();
    const stale = applySoloMove(
      before,
      {
        gameId: before.gameId,
        x: 0,
        y: 0,
        expectedRevision: 1,
        commandId: "stale",
      },
      START + 1,
    );
    expect(stale.response).toMatchObject({
      ok: false,
      reason: "stale_revision",
      replayed: false,
    });
    expect(stale.record).toEqual(before);

    const outside = applySoloMove(
      before,
      {
        gameId: before.gameId,
        x: -1,
        y: 0,
        expectedRevision: 0,
        commandId: "outside",
      },
      START + 1,
    );
    expect(outside.response).toMatchObject({
      ok: false,
      reason: "out_of_range",
    });

    const after = makeHumanMove(before, 1).record;
    const occupied = applySoloMove(
      after,
      {
        gameId: after.gameId,
        x: 0,
        y: 0,
        expectedRevision: after.revision,
        commandId: "occupied",
      },
      START + 2,
    );
    expect(occupied.response).toMatchObject({
      ok: false,
      reason: "cell_occupied",
    });
  });

  it("rejects non-monotonic server timestamps for accepted mutations", () => {
    const record = ranked();
    expect(() =>
      applySoloMove(
        record,
        {
          gameId: record.gameId,
          x: 0,
          y: 0,
          expectedRevision: 0,
          commandId: "move",
        },
        START - 1,
      ),
    ).toThrow("cannot precede");
    expect(() =>
      abandonSoloSession(
        record,
        {
          gameId: record.gameId,
          expectedRevision: 0,
          commandId: "abandon",
        },
        START - 1,
      ),
    ).toThrow("cannot precede");
  });
});

describe("full replay integrity", () => {
  it("rejects a substituted AI choice even when the point itself is legal", () => {
    const record = practice({ humanPlayer: 1, firstPlayer: 0 }).record;
    const tampered = structuredClone(record);
    const original = tampered.board.m_history[0];
    if (!original) throw new Error("Expected the opening AI move.");
    const index = (original.index + 1) % (record.rules.W * record.rules.H);
    tampered.board.m_history[0] = {
      x: index % record.rules.W,
      y: Math.floor(index / record.rules.W),
      index,
    };

    expect(() => normalizeSoloSessionRecord(tampered)).toThrow(
      "does not match the private deterministic seed",
    );
  });

  it.each(["cell", "score", "target", "revision", "move-count", "outcome"])(
    "rejects tampered canonical %s fields",
    (field) => {
      const record = makeHumanMove(ranked(), 1).record;
      const tampered = structuredClone(record);
      switch (field) {
        case "cell":
          tampered.board.m_board[0] = 2;
          break;
        case "score":
          tampered.board.m_players[0].m_score++;
          break;
        case "target":
          tampered.board.m_targets[1] = "not-a-canonical-target";
          break;
        case "revision":
          tampered.revision++;
          break;
        case "move-count":
          tampered.humanMoveCount++;
          break;
        case "outcome":
          tampered.outcome = { state: 3, status: "tie", winner: null };
          break;
      }
      expect(() => normalizeSoloSessionRecord(tampered)).toThrow(
        "canonical move-history replay",
      );
    },
  );

  it("rejects unknown persisted fields and wrong storage keys", () => {
    const record = ranked();
    const withCruft: Record<string, unknown> = {
      ...record,
      trustedClientScore: 999,
    };
    expect(() => normalizeSoloSessionRecord(withCruft)).toThrow(
      "unknown field",
    );
    expect(() => normalizeSoloSessionRecord(record, "other-game")).toThrow(
      "does not match its key",
    );
  });
});

describe("abandonment and canonical terminal results", () => {
  it("keeps a Ranked cancel before the first human move unrated", () => {
    const record = ranked();
    const result = abandonSoloSession(
      record,
      {
        gameId: record.gameId,
        expectedRevision: record.revision,
        commandId: "cancel",
      },
      START + 1,
    );

    expect(result.record).toMatchObject({
      status: "abandoned",
      endedReason: "abandoned",
      revision: 1,
      humanMoveCount: 0,
    });
    expect(soloResultForHuman(result.record)).toBeNull();
    expect(result.response.snapshot.rankedAbandonCountsAsLoss).toBe(false);
    expect(() =>
      withSoloRating(result.record, { before: 1000, after: 984 }),
    ).toThrow("rated terminal");
  });

  it("makes a Ranked abandonment after play a canonical rated loss", () => {
    const played = makeHumanMove(ranked(), 1).record;
    const abandoned = abandonSoloSession(
      played,
      {
        gameId: played.gameId,
        expectedRevision: played.revision,
        commandId: "abandon",
      },
      START + 2,
    ).record;

    expect(abandoned.revision).toBe(played.revision + 1);
    expect(abandoned.outcome).toEqual({
      state: 2,
      status: "player2_win",
      winner: 2,
    });
    expect(soloResultForHuman(abandoned)).toBe(0);
    expect(publicSoloSnapshot(abandoned)).toMatchObject({
      canShare: false,
      rankedAbandonCountsAsLoss: true,
    });

    const rated = withSoloRating(abandoned, { before: 1000, after: 984 });
    expect(normalizeSoloSessionRecord(rated).rating).toEqual({
      before: 1000,
      after: 984,
    });
    expect(soloTerminalResult(rated)).toMatchObject({
      endedReason: "abandoned",
      resultForHuman: 0,
      rating: { before: 1000, after: 984 },
    });
  });

  it("completes from canonical moves and does not expose an AI win for sharing", () => {
    let record = practice({ winScore: 4 }).record;
    let sequence = 1;
    while (record.status === "active") {
      record = makeHumanMove(record, sequence++).record;
      if (sequence > 20) throw new Error("Expected a 4x4 game to terminate.");
    }

    expect(record.status).toBe("completed");
    expect(record.endedReason).toMatch(/score_target|board_full/);
    expect(normalizeSoloSessionRecord(record)).toEqual(record);
    const result = soloTerminalResult(record);
    expect(result).not.toBeNull();
    expect(result?.resultForHuman).toBe(0);
    expect(result?.board).not.toHaveProperty("m_targets");
    expect(publicSoloSnapshot(record).canShare).toBe(false);
  });

  it("rejects stale or duplicate terminal abandonment", () => {
    const record = ranked();
    const stale = abandonSoloSession(
      record,
      {
        gameId: record.gameId,
        expectedRevision: 1,
        commandId: "stale",
      },
      START + 1,
    );
    expect(stale.response).toMatchObject({
      ok: false,
      reason: "stale_revision",
      replayed: false,
    });

    const ended = abandonSoloSession(
      record,
      {
        gameId: record.gameId,
        expectedRevision: 0,
        commandId: "first",
      },
      START + 1,
    ).record;
    const duplicate = abandonSoloSession(
      ended,
      {
        gameId: ended.gameId,
        expectedRevision: ended.revision,
        commandId: "second",
      },
      START + 2,
    );
    expect(duplicate.response).toMatchObject({
      ok: false,
      reason: "game_ended",
    });
  });
});
