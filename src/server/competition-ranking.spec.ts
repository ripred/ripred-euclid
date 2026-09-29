import { describe, expect, it } from "vitest";
import {
  completedChallengeSquares,
  type ChallengeSnapshot,
} from "../shared/challenge";
import {
  COMPETITION_DETAILS_TTL,
  competitionInstanceKey,
  type CompetitionInstance,
  type StoredCompetitionResult,
} from "./competition-model";
import { ensureCompetitionRanking } from "./competition-ranking";
import {
  competitionAttemptHistoryKey,
  competitionAttemptKey,
  competitionBestKey,
  competitionLeaderboardKey,
  legacyCompetitionLeaderboardKey,
  readCompetitionRankMember,
} from "./competition-ranking-model";
import { CompetitionMemoryRedis } from "./testing/competition-memory-redis";

const NOW = Date.parse("2026-09-28T12:00:00Z");
const ID = "legacy-day";

function legacyResult(
  userId: string,
  order: number,
  overrides: Partial<StoredCompetitionResult> = {},
): StoredCompetitionResult {
  const result = {
    userId,
    username: `player-${userId}`,
    moves: 1,
    elapsedMs: 100,
    achievedAt: NOW - 1000 + order,
    order,
    ...overrides,
  };
  return {
    ...result,
    member: [
      String(result.moves).padStart(2, "0"),
      String(result.elapsedMs).padStart(16, "0"),
      String(result.order).padStart(16, "0"),
      JSON.stringify({
        userId: result.userId,
        username: result.username,
        achievedAt: result.achievedAt,
      }),
    ].join(":"),
  };
}

function fixture(results: StoredCompetitionResult[] = []) {
  let now = NOW;
  const redis = new CompetitionMemoryRedis(() => now);
  const instance: CompetitionInstance = {
    id: ID,
    period: "daily",
    opensAt: NOW - 60_000,
    endsAt: NOW + 60_000,
    templateRevision: 0,
    certified: {
      puzzle: {
        version: 1,
        size: 8,
        initial: [0, 1, 8, 2, 10],
        blocked: [],
        targetSquares: 1,
        minimumMoves: 1,
      },
      seed: "legacy-seed",
      solutions: [[17], [9]],
    },
    superseded: false,
    settled: false,
    completionOrder: Math.max(0, ...results.map((result) => result.order)),
    leader:
      [...results].sort((a, b) => (a.member < b.member ? -1 : 1))[0] ?? null,
  };
  const expiration = instance.endsAt + COMPETITION_DETAILS_TTL;
  redis.seed(competitionInstanceKey(ID), JSON.stringify(instance));
  redis.sorted.set(
    legacyCompetitionLeaderboardKey(ID),
    new Map(results.map((result) => [result.member, 0])),
  );
  redis.expires.set(legacyCompetitionLeaderboardKey(ID), expiration);
  for (const result of results) {
    const key = competitionBestKey(ID, result.userId);
    redis.seed(key, JSON.stringify(result));
    redis.expires.set(key, expiration);
  }
  const snapshot = (
    result: StoredCompetitionResult,
    placements: number[],
    attemptId = `attempt-${result.userId}`,
  ): ChallengeSnapshot => ({
    puzzleId: ID,
    attemptId,
    revision: placements.length + 1,
    puzzle: instance.certified.puzzle,
    placements,
    completedSquares: completedChallengeSquares(
      instance.certified.puzzle,
      placements,
    ),
    complete: true,
    bestMoves: result.moves,
    bestElapsedMs: result.elapsedMs,
    startedAt: result.achievedAt - result.elapsedMs,
    finishedAt: result.achievedAt,
    elapsedMs: result.elapsedMs,
  });
  const seedAttempt = (
    result: StoredCompetitionResult,
    placements: number[],
  ) => {
    const value = snapshot(result, placements),
      key = competitionAttemptKey(ID, result.userId);
    redis.seed(key, JSON.stringify(value));
    redis.expires.set(key, expiration);
    return value;
  };
  return {
    redis,
    instance,
    expiration,
    snapshot,
    seedAttempt,
    migrate: () => ensureCompetitionRanking(redis, ID, now),
    current: () => redis.json<CompetitionInstance>(competitionInstanceKey(ID))!,
    index: async () =>
      (await redis.zRange(competitionLeaderboardKey(ID), 0, -1)).map(
        ({ member }) => readCompetitionRankMember(member)!,
      ),
    advance: (time: number) => {
      now = time;
    },
  };
}

describe("competition ranking migration", () => {
  it("recovers actual squares and ranks them ahead of moves/time without replacing legacy data", async () => {
    const low = legacyResult("low", 1, { elapsedMs: 10 }),
      high = legacyResult("high", 2, { moves: 2, elapsedMs: 500 }),
      unknown = legacyResult("unknown", 3, { elapsedMs: 1 });
    const f = fixture([low, high, unknown]);
    expect(f.seedAttempt(low, [17]).completedSquares).toHaveLength(1);
    expect(f.seedAttempt(high, [63, 9]).completedSquares).toHaveLength(2);
    const source = await f.redis.zRange(
      legacyCompetitionLeaderboardKey(ID),
      0,
      -1,
    );
    await f.migrate();
    expect(
      (await f.index()).map(({ userId, squares }) => [userId, squares]),
    ).toEqual([
      ["high", 2],
      ["low", 1],
      ["unknown", null],
    ]);
    expect(f.current()).toMatchObject({
      rankingVersion: 2,
      leader: { userId: "high", squares: 2 },
    });
    expect(f.current().rankingMigration).toBeUndefined();
    expect(
      await f.redis.zRange(legacyCompetitionLeaderboardKey(ID), 0, -1),
    ).toEqual(source);
    expect(f.redis.json(competitionBestKey(ID, high.userId))).toMatchObject({
      member: high.member,
      squares: 2,
      attemptId: "attempt-high",
    });
    expect(f.redis.expires.get(competitionBestKey(ID, high.userId))).toBe(
      f.expiration,
    );
    expect(f.redis.expires.get(competitionLeaderboardKey(ID))).toBe(
      f.expiration,
    );
    expect(f.redis.expires.get(competitionInstanceKey(ID))).toBeUndefined();
    const commits = f.redis.commits.length;
    await f.migrate();
    expect(f.redis.commits).toHaveLength(commits);
  });

  it("uses a referenced completed history record, never an unrelated current retry", async () => {
    const result = legacyResult("history", 1, {
      attemptId: "accepted-attempt",
    });
    const f = fixture([result]);
    const accepted = f.snapshot(result, [9], "accepted-attempt");
    const retry = {
      ...f.snapshot(result, [17]),
      finishedAt: result.achievedAt + 1,
    };
    f.redis.seed(
      competitionAttemptKey(ID, result.userId),
      JSON.stringify(retry),
    );
    f.redis.seed(
      competitionAttemptHistoryKey(ID, result.userId, "accepted-attempt"),
      JSON.stringify(accepted),
    );
    await f.migrate();
    expect(f.current().leader).toMatchObject({ userId: "history", squares: 2 });
    expect(f.redis.json(competitionAttemptKey(ID, result.userId))).toEqual(
      retry,
    );
  });

  it("recovers a durable leader's referenced history even if its personal-best record is missing", async () => {
    const result = legacyResult("durable", 1, {
      attemptId: "accepted-attempt",
    });
    const f = fixture([result]);
    f.redis.externalDelete(competitionBestKey(ID, result.userId));
    f.redis.seed(
      competitionAttemptHistoryKey(ID, result.userId, "accepted-attempt"),
      JSON.stringify(f.snapshot(result, [9], "accepted-attempt")),
    );
    await f.migrate();
    expect(f.current().leader).toMatchObject({ userId: "durable", squares: 2 });
    expect(
      await f.redis.get(competitionBestKey(ID, result.userId)),
    ).toBeUndefined();
  });

  it("preserves an unknown count when the retained retry cannot identify the old best", async () => {
    const result = legacyResult("unknown", 1);
    const f = fixture([result]);
    f.redis.seed(
      competitionAttemptKey(ID, result.userId),
      JSON.stringify({
        ...f.snapshot(result, [9]),
        finishedAt: result.achievedAt + 1,
      }),
    );
    await f.migrate();
    expect(f.current().leader).toMatchObject({
      userId: "unknown",
      squares: null,
    });
    expect(f.redis.json(competitionBestKey(ID, result.userId))).toMatchObject({
      squares: null,
    });
  });

  it("publishes only after bounded pages finish and resumes without dropping entries", async () => {
    const results = Array.from({ length: 201 }, (_, i) =>
      legacyResult(`user-${i}`, i + 1, { squares: (i % 3) + 1 }),
    );
    const f = fixture(results);
    await expect(f.migrate()).rejects.toMatchObject({ code: "unavailable" });
    expect(f.current().rankingVersion).toBeUndefined();
    expect(f.current().leader).toEqual(f.instance.leader);
    expect(f.current().rankingMigration?.offset).toBe(200);
    await f.migrate();
    expect(f.current().rankingVersion).toBe(2);
    expect(await f.index()).toHaveLength(201);
    expect(f.current().leader).toMatchObject({ userId: "user-2", squares: 3 });
  });

  it("restarts staging when a legacy completion changes an already scanned result", async () => {
    const results = Array.from({ length: 201 }, (_, i) =>
      legacyResult(`user-${i}`, i + 1, { squares: 1 }),
    );
    const f = fixture(results);
    await expect(f.migrate()).rejects.toMatchObject({ code: "unavailable" });
    const improved = legacyResult("user-0", 202, { squares: 4, elapsedMs: 50 });
    const legacy = f.redis.sorted.get(legacyCompetitionLeaderboardKey(ID))!;
    legacy.delete(results[0]!.member);
    legacy.set(improved.member, 0);
    f.redis.externalSet(
      competitionBestKey(ID, improved.userId),
      JSON.stringify(improved),
    );
    f.redis.externalSet(
      competitionInstanceKey(ID),
      JSON.stringify({
        ...f.current(),
        completionOrder: 202,
        leader: improved,
      }),
    );
    await expect(f.migrate()).rejects.toMatchObject({ code: "unavailable" });
    expect(f.current().rankingMigration?.sourceOrder).toBe(202);
    await f.migrate();
    const index = await f.index();
    expect(index).toHaveLength(201);
    expect(
      index.filter((entry) => entry.userId === improved.userId),
    ).toHaveLength(1);
    expect(index[0]).toMatchObject({ userId: improved.userId, squares: 4 });
  });

  it("re-reads a source page changed before WATCH and safely converges concurrent migrations", async () => {
    const first = legacyResult("first", 1, { squares: 1 });
    const f = fixture([first]);
    const next = legacyResult("next", 2, { squares: 2 });
    const zRange = f.redis.zRange.bind(f.redis);
    let injected = false;
    f.redis.zRange = async (key, start, stop) => {
      const entries = await zRange(key, start, stop);
      if (key === legacyCompetitionLeaderboardKey(ID) && !injected) {
        injected = true;
        f.redis.sorted.get(key)!.set(next.member, 0);
        f.redis.externalSet(
          competitionBestKey(ID, next.userId),
          JSON.stringify(next),
        );
        f.redis.externalSet(
          competitionInstanceKey(ID),
          JSON.stringify({
            ...f.current(),
            completionOrder: 2,
          }),
        );
      }
      return entries;
    };
    await Promise.all([f.migrate(), f.migrate()]);
    expect((await f.index()).map(({ userId }) => userId)).toEqual([
      "next",
      "first",
    ]);
    expect(f.current()).toMatchObject({
      rankingVersion: 2,
      leader: { userId: "next" },
    });
  });

  it("preserves the durable leader after retention expires without resurrecting detail records", async () => {
    const result = legacyResult("outage-winner", 1);
    const f = fixture([result]);
    f.seedAttempt(result, [9]);
    f.advance(f.expiration + 1000);
    await f.migrate();
    expect(f.current()).toMatchObject({
      rankingVersion: 2,
      leader: { userId: result.userId, squares: null },
    });
    expect(
      await f.redis.get(competitionBestKey(ID, result.userId)),
    ).toBeUndefined();
    expect(await f.index()).toEqual([]);
    expect(f.redis.expires.get(competitionInstanceKey(ID))).toBeUndefined();
    expect(f.redis.commits.flat().map(({ key }) => key)).toEqual([
      competitionLeaderboardKey(ID),
      competitionInstanceKey(ID),
    ]);
  });

  it.each(["settled", "superseded"] as const)(
    "does not rewrite %s instances or their awarded leader",
    async (field) => {
      const result = legacyResult("winner", 1);
      const f = fixture([result]);
      f.redis.seed(
        competitionInstanceKey(ID),
        JSON.stringify({ ...f.instance, [field]: true }),
      );
      const before = await f.redis.get(competitionInstanceKey(ID));
      await f.migrate();
      expect(await f.redis.get(competitionInstanceKey(ID))).toBe(before);
      expect(f.redis.commits).toEqual([]);
    },
  );

  it("skips malformed members without losing valid results or getting stuck", async () => {
    const result = legacyResult("valid", 1, { squares: 1 });
    const f = fixture([result]);
    f.redis.sorted
      .get(legacyCompetitionLeaderboardKey(ID))!
      .set("00:broken-json", 0);
    await f.migrate();
    expect(await f.index()).toMatchObject([{ userId: "valid", squares: 1 }]);
    expect(f.current().rankingVersion).toBe(2);
  });
});
