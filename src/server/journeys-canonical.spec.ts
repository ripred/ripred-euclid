import { describe, expect, it, vi } from "vitest";
import {
  createJourneyCanonicalReader,
  type JourneyCanonicalStores,
} from "./journeys-canonical";
import {
  createInitialH2HBoard,
  createH2HCanonicalState,
  endH2HByDeparture,
} from "./h2h";
import { createSoloSession, publicSoloSnapshot } from "./solo";
import { RANKED_SOLO_RULES } from "../shared/game/rules";
import type {
  JourneyActivityRef,
  JourneyRequestContext,
} from "../shared/journeys";
import type { ChallengeSnapshot } from "../shared/challenge";

const request = (activity: JourneyActivityRef): JourneyRequestContext => ({
  documentId: "document",
  segmentId: "segment",
  activity,
});
const fixtures = () => {
  const solo = publicSoloSnapshot(
    createSoloSession({
      gameId: "solo",
      ownerId: "human",
      privateSeed: "private-seed",
      rules: RANKED_SOLO_RULES,
      now: 100,
    }).record,
  );
  const h2h = createH2HCanonicalState(
    "match",
    createInitialH2HBoard("human", "opponent", { now: 100 }),
  );
  const stores: JourneyCanonicalStores = {
    solo: { getJourneyState: vi.fn(async () => solo) },
    h2h: {
      getJourneyState: vi.fn(async () => h2h),
      getJourneyPresence: vi.fn<
        JourneyCanonicalStores["h2h"]["getJourneyPresence"]
      >(async () => ({ state: "queued" })),
    },
    competition: { getJourneyAttempt: vi.fn(async () => null) },
  };
  return { solo, h2h, stores, read: createJourneyCanonicalReader(stores) };
};

describe("Journeys canonical authority adapter", () => {
  it("derives Solo dimensions and terminal results from the human's canonical side", async () => {
    const { solo, stores, read } = fixtures();
    solo.status = "completed";
    solo.outcome = { state: 2, status: "player2_win", winner: 2 };
    solo.board.m_players[solo.rules.humanPlayer].m_score = 75;
    solo.humanMoveCount = 7;
    const value = await read(
      "human",
      request({ kind: "solo", gameId: "solo" }),
    );
    expect(stores.solo.getJourneyState).toHaveBeenCalledExactlyOnceWith(
      "human",
      "solo",
    );
    expect(value).toMatchObject({
      mode: "ranked",
      difficulty: "tenderfoot",
      status: "completed",
      progress: 1,
      hasMove: true,
      game: { win: solo.rules.humanPlayer === 1, score: 75 },
    });
    expect(JSON.stringify(value)).not.toMatch(/private-seed|ownerId|username/);
  });

  it("uses leading score progress for Standard and Tide, not occupancy or turns", async () => {
    const { solo, read } = fixtures();
    solo.board.m_players[0].m_score = 30;
    solo.board.m_players[1].m_score = 60;
    solo.board.variant = "tide";
    expect(
      (await read("human", request({ kind: "solo", gameId: "solo" })))
        ?.progress,
    ).toBe(0.4);
    solo.board.variant = "standard";
    expect(
      (await read("human", request({ kind: "solo", gameId: "solo" })))
        ?.progress,
    ).toBe(0.4);
  });

  it("marks the H2H quitter incomplete and the opponent's canonical win complete", async () => {
    const { h2h, stores, read } = fixtures();
    const ended = endH2HByDeparture(h2h.board, "human", "match", 200);
    stores.h2h.getJourneyState = vi.fn(async () => ended);
    const ref = request({
      kind: "h2h",
      gameId: "match",
      roundStartRevision: ended.roundStartRevision ?? null,
      terminalRevision: ended.revision,
    });
    expect(await read("human", ref)).toMatchObject({
      status: "abandoned",
      game: { win: false, score: 0 },
    });
    expect(await read("opponent", ref)).toMatchObject({
      status: "completed",
      progress: 1,
      game: { win: true, score: 0 },
    });
    expect(stores.h2h.getJourneyState).toHaveBeenLastCalledWith(
      "opponent",
      "match",
      ended.roundStartRevision ?? null,
      ended.revision,
    );
  });

  it("reads archived H2H rounds by exact round and terminal revision", async () => {
    const { stores, read } = fixtures();
    stores.h2h.getJourneyState = vi.fn(async () => null);
    expect(
      await read(
        "human",
        request({
          kind: "h2h",
          gameId: "match",
          roundStartRevision: 54,
          terminalRevision: 90,
        }),
      ),
    ).toBeNull();
    expect(stores.h2h.getJourneyState).toHaveBeenCalledExactlyOnceWith(
      "human",
      "match",
      54,
      90,
    );
  });

  it("distinguishes queued, canceled and actually paired states without guessing", async () => {
    const { stores, h2h, read } = fixtures();
    const ref = request({ kind: "h2h-queue" });
    expect(await read("human", ref)).toMatchObject({
      activity: { kind: "h2h-queue" },
      status: "queued",
    });
    stores.h2h.getJourneyPresence = vi.fn<
      JourneyCanonicalStores["h2h"]["getJourneyPresence"]
    >(async () => ({ state: "idle" }));
    expect(await read("human", ref)).toMatchObject({
      activity: { kind: "h2h-queue" },
      status: "canceled",
    });
    stores.h2h.getJourneyPresence = vi.fn<
      JourneyCanonicalStores["h2h"]["getJourneyPresence"]
    >(async () => ({
      state: "active",
      snapshot: h2h,
    }));
    expect(await read("human", ref)).toMatchObject({
      activity: { kind: "h2h", gameId: "match" },
      status: "active",
    });
  });

  it("derives challenge progress and score from completed squares and carries abandonment proof privately", async () => {
    const { stores, read } = fixtures();
    const snapshot: ChallengeSnapshot = {
      puzzleId: "instance",
      attemptId: "attempt",
      revision: 2,
      puzzle: {
        version: 1,
        size: 8,
        initial: [],
        blocked: [],
        minimumMoves: 2,
        targetSquares: 4,
      },
      placements: [1, 2],
      completedSquares: ["square1", "square2"],
      complete: false,
      bestMoves: null,
      startedAt: 100,
      finishedAt: null,
      elapsedMs: 200,
      bestElapsedMs: null,
    };
    const ref = request({
      kind: "competition",
      period: "daily",
      instanceId: "instance",
      attemptId: "attempt",
    });
    stores.competition.getJourneyAttempt = vi.fn<
      JourneyCanonicalStores["competition"]["getJourneyAttempt"]
    >(async () => ({
      instance: {
        id: "instance",
        period: "daily",
        opensAt: 100,
        endsAt: 1_000,
      },
      snapshot,
      status: snapshot.complete ? "completed" : "active",
    }));
    expect(await read("human", ref)).toMatchObject({
      mode: "daily",
      progress: 0.5,
      hasMove: true,
      hasSquare: true,
    });
    snapshot.complete = true;
    expect(await read("human", ref)).toMatchObject({
      status: "completed",
      progress: 1,
      game: { win: true, score: 2 },
    });
    stores.competition.getJourneyAttempt = vi.fn<
      JourneyCanonicalStores["competition"]["getJourneyAttempt"]
    >(async () => ({
      instance: {
        id: "instance",
        period: "daily",
        opensAt: 100,
        endsAt: 1_000,
      },
      snapshot: null,
      status: "abandoned",
    }));
    expect(
      await read("human", {
        ...ref,
        endReason: "abandoned",
        commandId: "abandon",
        expectedRevision: 2,
      }),
    ).toMatchObject({ status: "abandoned", progress: 0 });
    expect(
      stores.competition.getJourneyAttempt,
    ).toHaveBeenCalledExactlyOnceWith("daily", "human", {
      instanceId: "instance",
      attemptId: "attempt",
      abandonCommandId: "abandon",
      abandonExpectedRevision: 2,
    });
  });
});
