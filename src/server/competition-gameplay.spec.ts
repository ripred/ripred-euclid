import { describe, expect, it } from "vitest";
import type { ChallengeSnapshot } from "../shared/challenge";
import {
  CHALLENGE_PERIODS,
  type ChallengePeriod,
} from "../shared/challenge-spotlights";
import type {
  CompetitionCommand,
  CompetitionStateResponse,
} from "../shared/competitions";
import { DEFAULT_SUBREDDIT_SETTINGS } from "../shared/subreddit-settings";
import {
  CompetitionGameplay,
  competitionAttemptHistoryKey,
  competitionAttemptKey,
  competitionBestKey,
  competitionLeaderboardKey,
  type CompetitionIdentity,
} from "./competition-gameplay";
import {
  COMPETITION_DETAILS_TTL,
  COMPETITION_STATE_KEY,
  competitionInstanceKey,
  competitionWindow,
  readCompetitionState,
  type CompetitionInstance,
  type StoredCompetitionResult,
} from "./competition-model";
import { SUBREDDIT_SETTINGS_KEY } from "./subreddit-settings";
import { CompetitionMemoryRedis } from "./testing/competition-memory-redis";

const alice: CompetitionIdentity = { userId: "alice-id", username: "alice" };
const bob: CompetitionIdentity = { userId: "bob-id", username: "bob" };
function fixture(period: ChallengePeriod = "daily") {
  let now = Date.parse("2026-09-27T12:00:00Z"),
    ids = 0,
    commands = 0;
  const redis = new CompetitionMemoryRedis(() => now);
  const settings = {
    ...DEFAULT_SUBREDDIT_SETTINGS,
    dailyChallenges: true,
    weeklyChallenges: true,
  };
  const state = readCompetitionState(undefined);
  state.periods[period].currentId = "day1";
  state.periods[period].activationAt = competitionWindow(period, now).opensAt;
  redis.seed(COMPETITION_STATE_KEY, JSON.stringify(state));
  redis.seed(SUBREDDIT_SETTINGS_KEY, JSON.stringify(settings));
  const instance: CompetitionInstance = {
    id: "day1",
    period,
    ...competitionWindow(period, now),
    templateRevision: 0,
    certified: {
      puzzle: {
        version: 1,
        size: 8,
        initial: [0, 1, 8],
        blocked: [62],
        targetSquares: 1,
        minimumMoves: 1,
      },
      seed: "NEVER-PUBLIC",
      solutions: [[9]],
    },
    superseded: false,
    settled: false,
    completionOrder: 0,
    leader: null,
  };
  redis.seed(competitionInstanceKey(instance.id), JSON.stringify(instance));
  const store = new CompetitionGameplay(redis, {
    now: () => now,
    newId: () => `attempt-${++ids}`,
  });
  const cmd = (
    current: CompetitionStateResponse | null,
    commandId = `cmd-${++commands}`,
  ): CompetitionCommand => ({
    instanceId: instance.id,
    attemptId: current?.snapshot?.attemptId ?? null,
    expectedRevision: current?.snapshot?.revision ?? 0,
    commandId,
  });
  const start = (identity = alice) =>
    store.mutate(period, identity, "start", cmd(null));
  const move = (
    current: CompetitionStateResponse,
    identity = alice,
    point = 9,
  ) => store.mutate(period, identity, "move", { ...cmd(current), point });
  return {
    store,
    redis,
    state,
    settings,
    instance,
    cmd,
    start,
    move,
    advance: (ms: number) => {
      now += ms;
    },
    setTime: (ms: number) => {
      now = ms;
    },
    now: () => now,
  };
}

describe("public competition gameplay", () => {
  describe.each(CHALLENGE_PERIODS)("%s abandonment", (period) => {
    it("deletes only the owner's unfinished attempt and leaves no result or standings entry", async () => {
      const f = fixture(period);
      const started = await f.start();
      const current = await f.move(started, alice, 63);
      const other = await f.start(bob);
      const attemptKey = competitionAttemptKey(f.instance.id, alice.userId);
      const historyKey = competitionAttemptHistoryKey(
        f.instance.id,
        alice.userId,
        current.snapshot!.attemptId,
      );
      f.redis.seed(historyKey, JSON.stringify(current.snapshot));
      const instanceBefore = f.redis.value(
        competitionInstanceKey(f.instance.id),
      );
      const abandoned = await f.store.mutate(
        period,
        alice,
        "abandon",
        f.cmd(current),
      );
      expect(abandoned).toMatchObject({
        snapshot: null,
        personalBest: null,
        personalRank: null,
      });
      expect(f.redis.value(attemptKey)).toBeUndefined();
      expect(f.redis.value(historyKey)).toBeUndefined();
      expect(
        f.redis.value(competitionBestKey(f.instance.id, alice.userId)),
      ).toBeUndefined();
      expect(f.redis.value(competitionInstanceKey(f.instance.id))).toBe(
        instanceBefore,
      );
      expect((await f.store.standings(period)).standings).toEqual([]);
      expect((await f.store.state(period, alice)).snapshot).toBeNull();
      expect((await f.store.state(period, bob)).snapshot).toEqual(
        other.snapshot,
      );
      const restarted = await f.start();
      expect(restarted.snapshot?.attemptId).not.toBe(
        current.snapshot?.attemptId,
      );
      expect(restarted.snapshot?.placements).toEqual([]);
    });

    it("preserves completed history, best result, and standings while abandoning another attempt", async () => {
      const f = fixture(period);
      const done = await f.move(await f.start());
      const historyKey = competitionAttemptHistoryKey(
        f.instance.id,
        alice.userId,
        done.snapshot!.attemptId,
      );
      const history = f.redis.value(historyKey);
      const standings = await f.store.standings(period);
      const instance = f.redis.value(competitionInstanceKey(f.instance.id));
      const retry = await f.store.mutate(period, alice, "retry", f.cmd(done));
      const abandoned = await f.store.mutate(
        period,
        alice,
        "abandon",
        f.cmd(retry),
      );
      expect(abandoned.snapshot).toBeNull();
      expect(abandoned.personalBest).toEqual(done.personalBest);
      expect(abandoned.personalRank).toBe(done.personalRank);
      expect(f.redis.value(historyKey)).toBe(history);
      expect(f.redis.value(competitionInstanceKey(f.instance.id))).toBe(
        instance,
      );
      expect(await f.store.standings(period)).toEqual(standings);
      const completedAgain = await f.move(await f.start());
      await f.store.mutate(period, alice, "abandon", f.cmd(completedAgain));
      expect(
        f.redis.json<ChallengeSnapshot>(
          competitionAttemptHistoryKey(
            f.instance.id,
            alice.userId,
            completedAgain.snapshot!.attemptId,
          ),
        )?.complete,
      ).toBe(true);
      expect((await f.store.state(period, alice)).personalBest).toEqual(
        done.personalBest,
      );
    });

    it("replays abandonment safely without resurrecting old start/move receipts or deleting a newer attempt", async () => {
      const f = fixture(period);
      const startCommand = f.cmd(null);
      const started = await f.store.mutate(
        period,
        alice,
        "start",
        startCommand,
      );
      const moveCommand = { ...f.cmd(started), point: 63 };
      const current = await f.store.mutate(period, alice, "move", moveCommand);
      const abandonCommand = f.cmd(current);
      await f.store.mutate(period, alice, "abandon", abandonCommand);
      expect(
        (await f.store.mutate(period, alice, "abandon", abandonCommand))
          .snapshot,
      ).toBeNull();
      for (const [action, input] of [
        ["start", startCommand],
        ["move", moveCommand],
      ] as const)
        await expect(
          f.store.mutate(period, alice, action, input),
        ).rejects.toMatchObject({ code: "stale" });
      await expect(
        f.store.mutate(period, alice, "abandon", {
          ...abandonCommand,
          expectedRevision: abandonCommand.expectedRevision + 1,
        }),
      ).rejects.toMatchObject({ code: "stale" });
      expect((await f.store.state(period, alice)).snapshot).toBeNull();
      const fresh = await f.start();
      for (const input of [abandonCommand, f.cmd(current)])
        await expect(
          f.store.mutate(period, alice, "abandon", input),
        ).rejects.toMatchObject({ code: "stale" });
      for (const [action, input] of [
        ["start", startCommand],
        ["move", moveCommand],
      ] as const)
        await expect(
          f.store.mutate(period, alice, action, input),
        ).rejects.toMatchObject({ code: "stale" });
      expect((await f.store.state(period, alice)).snapshot).toEqual(
        fresh.snapshot,
      );
    });

    it("rechecks the attempt, revision, and instance before committing abandonment", async () => {
      for (const change of ["attempt", "revision", "instance"] as const) {
        const f = fixture(period);
        const started = await f.start();
        const attemptKey = competitionAttemptKey(f.instance.id, alice.userId);
        f.redis.beforeExec = (writes) => {
          if (
            !writes.some(
              (write) => write.key === attemptKey && write.action === "delete",
            )
          )
            return;
          f.redis.beforeExec = undefined;
          if (change === "instance") {
            f.state.periods[period].currentId = "replacement";
            f.redis.externalSet(COMPETITION_STATE_KEY, JSON.stringify(f.state));
          } else {
            f.redis.externalSet(
              attemptKey,
              JSON.stringify({
                ...started.snapshot,
                ...(change === "attempt"
                  ? { attemptId: "newer-attempt" }
                  : { revision: started.snapshot!.revision + 1 }),
              }),
            );
          }
        };
        await expect(
          f.store.mutate(period, alice, "abandon", f.cmd(started)),
        ).rejects.toMatchObject({ code: "stale" });
        expect(f.redis.value(attemptKey)).toBeDefined();
        expect(
          f.redis.commits
            .flat()
            .some(
              (write) => write.key === attemptKey && write.action === "delete",
            ),
        ).toBe(false);
      }
    });

    it("allows cleanup after disabling or closing the current challenge", async () => {
      for (const change of ["disabled", "closed"] as const) {
        const f = fixture(period);
        const started = await f.start();
        if (change === "disabled")
          f.redis.seed(
            SUBREDDIT_SETTINGS_KEY,
            JSON.stringify({
              ...f.settings,
              dailyChallenges: false,
              weeklyChallenges: false,
            }),
          );
        else f.setTime(f.instance.endsAt);
        expect(
          (await f.store.mutate(period, alice, "abandon", f.cmd(started)))
            .snapshot,
        ).toBeNull();
        expect(
          f.redis.value(competitionAttemptKey(f.instance.id, alice.userId)),
        ).toBeUndefined();
      }
    });
  });

  it("keeps a board private until Start and excludes certification from every public response", async () => {
    const f = fixture();
    expect((await f.store.state("daily", null)).snapshot).toBeNull();
    expect((await f.store.state("daily", alice)).snapshot).toBeNull();
    const started = await f.start();
    expect(started.snapshot?.placements).toEqual([]);
    expect(started.authenticated).toBe(true);
    const serialized = JSON.stringify([
      started,
      await f.store.availability(),
      await f.store.standings("daily"),
    ]);
    expect(serialized).not.toContain("NEVER-PUBLIC");
    expect(serialized).not.toContain("solutions");
    expect((await f.store.state("daily", bob)).snapshot).toBeNull();
  });

  it("preserves the authoritative timer across reads, duplicate Start, and temporary disabling", async () => {
    const f = fixture();
    const command = f.cmd(null, "start-receipt");
    const started = await f.store.mutate("daily", alice, "start", command);
    f.advance(4_000);
    expect((await f.store.state("daily", alice)).snapshot?.elapsedMs).toBe(
      4_000,
    );
    expect(
      (await f.store.mutate("daily", alice, "start", command)).snapshot
        ?.startedAt,
    ).toBe(started.snapshot?.startedAt);
    f.redis.seed(
      SUBREDDIT_SETTINGS_KEY,
      JSON.stringify({ ...f.settings, dailyChallenges: false }),
    );
    await expect(f.move(started)).rejects.toMatchObject({ code: "forbidden" });
    expect((await f.store.state("daily", alice)).snapshot).toBeNull();
    f.advance(2_000);
    f.redis.seed(SUBREDDIT_SETTINGS_KEY, JSON.stringify(f.settings));
    expect((await f.store.state("daily", alice)).snapshot?.elapsedMs).toBe(
      6_000,
    );
  });

  it("orders entries by moves, then server time, then first accepted completion", async () => {
    const f = fixture();
    const a = await f.start(alice),
      b = await f.start(bob);
    f.advance(100);
    const aExtra = await f.move(a, alice, 63);
    await f.move(aExtra, alice);
    await f.move(b, bob);
    expect(
      (await f.store.standings("daily")).standings.map(
        (entry) => entry.username,
      ),
    ).toEqual(["bob", "alice"]);
    const aDone = await f.store.state("daily", alice);
    const retry = await f.store.mutate("daily", alice, "retry", f.cmd(aDone));
    f.advance(50);
    const improved = await f.move(retry);
    expect(improved.personalRank).toBe(1);
    expect(
      (await f.store.standings("daily")).standings.map((entry) => [
        entry.username,
        entry.elapsedMs,
      ]),
    ).toEqual([
      ["alice", 50],
      ["bob", 100],
    ]);
    expect(
      await f.redis.zRange(competitionLeaderboardKey("day1"), 0, -1),
    ).toHaveLength(2);
    expect(
      f.redis.json<CompetitionInstance>(competitionInstanceKey("day1"))?.leader
        ?.username,
    ).toBe("alice");
  });

  it("retains tie priority on an equal repeat and starts a fresh retry without losing the best", async () => {
    const f = fixture();
    const a = await f.start(alice),
      b = await f.start(bob);
    f.advance(100);
    const done = await f.move(a);
    await f.move(b, bob);
    const original = f.redis.json<StoredCompetitionResult>(
      competitionBestKey("day1", alice.userId),
    );
    const retry = await f.store.mutate("daily", alice, "retry", f.cmd(done));
    expect(retry.snapshot?.placements).toEqual([]);
    expect(retry.personalBest).toEqual(done.personalBest);
    expect(retry.snapshot?.attemptId).not.toBe(done.snapshot?.attemptId);
    f.advance(100);
    await f.move(retry);
    expect(
      f.redis.json<StoredCompetitionResult>(
        competitionBestKey("day1", alice.userId),
      ),
    ).toEqual(original);
    expect(
      (await f.store.standings("daily")).standings.map(
        (entry) => entry.username,
      ),
    ).toEqual(["alice", "bob"]);
    expect(
      f.redis.json<ChallengeSnapshot>(
        competitionAttemptHistoryKey(
          "day1",
          alice.userId,
          done.snapshot!.attemptId,
        ),
      )?.complete,
    ).toBe(true);
  });

  it("returns personal best without rank and no other players when live standings are hidden", async () => {
    const f = fixture();
    const a = await f.start();
    f.advance(10);
    await f.move(a);
    f.redis.seed(
      SUBREDDIT_SETTINGS_KEY,
      JSON.stringify({ ...f.settings, showLiveChallengeStandings: false }),
    );
    const own = await f.store.state("daily", alice);
    expect(own.personalBest?.moves).toBe(1);
    expect(own.personalRank).toBeNull();
    expect(await f.store.standings("daily")).toMatchObject({
      visible: false,
      standings: [],
    });
  });

  it("hides rank when a moderator changes visibility during either state or command response", async () => {
    for (const action of ["state", "retry"] as const) {
      const f = fixture(),
        a = await f.start();
      f.advance(10);
      const done = await f.move(a);
      const original = f.redis.zRank.bind(f.redis);
      f.redis.zRank = async (key, member) => {
        const rank = await original(key, member);
        f.redis.seed(
          SUBREDDIT_SETTINGS_KEY,
          JSON.stringify({ ...f.settings, showLiveChallengeStandings: false }),
        );
        return rank;
      };
      const response =
        action === "state"
          ? await f.store.state("daily", alice)
          : await f.store.mutate("daily", alice, "retry", f.cmd(done));
      expect(response.personalRank).toBeNull();
      expect(response.competition.showStandings).toBe(false);
      expect(response.personalBest).toEqual(done.personalBest);
    }
  });

  it("discards a standings page if its instance is replaced during the read", async () => {
    const f = fixture(),
      a = await f.start();
    await f.move(a);
    const original = f.redis.zRange.bind(f.redis);
    f.redis.zRange = async (key, start, stop) => {
      const entries = await original(key, start, stop);
      f.state.periods.daily.currentId = "replacement";
      f.redis.seed(COMPETITION_STATE_KEY, JSON.stringify(f.state));
      return entries;
    };
    expect(await f.store.standings("daily")).toMatchObject({
      visible: false,
      standings: [],
    });
  });

  it("rejects moves at the exclusive deadline and rechecks time after conflicts", async () => {
    const f = fixture();
    const a = await f.start();
    f.setTime(f.instance.endsAt - 1);
    f.redis.beforeExec = (writes) => {
      if (
        writes.some((write) =>
          write.key.startsWith("euclid:competition:attempt:"),
        )
      ) {
        f.redis.beforeExec = undefined;
        f.setTime(f.instance.endsAt);
        f.redis.externalSet(COMPETITION_STATE_KEY, JSON.stringify(f.state));
      }
    };
    await expect(f.move(a)).rejects.toMatchObject({ code: "expired" });
    expect(
      f.redis.json<CompetitionInstance>(competitionInstanceKey("day1"))?.leader,
    ).toBeNull();
  });

  it("rechecks replacement and disabling on transaction retries", async () => {
    for (const change of ["replace", "disable"] as const) {
      const f = fixture(),
        a = await f.start();
      f.redis.beforeExec = (writes) => {
        if (
          !writes.some((write) =>
            write.key.startsWith("euclid:competition:attempt:"),
          )
        )
          return;
        f.redis.beforeExec = undefined;
        if (change === "replace") {
          f.state.periods.daily.currentId = "replacement";
          f.redis.externalSet(COMPETITION_STATE_KEY, JSON.stringify(f.state));
        } else
          f.redis.externalSet(
            SUBREDDIT_SETTINGS_KEY,
            JSON.stringify({ ...f.settings, dailyChallenges: false }),
          );
      };
      await expect(f.move(a)).rejects.toMatchObject({
        code: change === "replace" ? "stale" : "forbidden",
      });
      expect(
        f.redis.json<CompetitionInstance>(competitionInstanceKey("day1"))
          ?.leader,
      ).toBeNull();
    }
  });

  it("rejects stale attempts and changed duplicate commands; exact retries do not duplicate a result", async () => {
    const f = fixture(),
      a = await f.start();
    const command = { ...f.cmd(a, "last-move"), point: 9 };
    const done = await f.store.mutate("daily", alice, "move", command);
    await f.store.mutate("daily", alice, "move", command);
    expect(
      f.redis.json<CompetitionInstance>(competitionInstanceKey("day1"))
        ?.completionOrder,
    ).toBe(1);
    await expect(
      f.store.mutate("daily", alice, "move", { ...command, point: 63 }),
    ).rejects.toMatchObject({ code: "stale" });
    await f.store.mutate("daily", alice, "retry", f.cmd(done));
    await expect(f.move(a)).rejects.toMatchObject({ code: "stale" });
  });

  it("commits result/index/leader together, never GETs the sorted index, and retains details 90 days", async () => {
    const f = fixture(),
      a = await f.start();
    await f.move(a);
    const commit = f.redis.commits.findLast((writes) =>
      writes.some((write) => write.action === "z-add"),
    );
    expect(
      commit?.some((write) => write.key === competitionInstanceKey("day1")),
    ).toBe(true);
    expect(
      commit?.some(
        (write) => write.key === competitionBestKey("day1", alice.userId),
      ),
    ).toBe(true);
    expect(f.redis.reads).not.toContain(competitionLeaderboardKey("day1"));
    expect(f.redis.expires.get(competitionInstanceKey("day1"))).toBeUndefined();
    expect(
      f.redis.expires.get(competitionAttemptKey("day1", alice.userId)),
    ).toBe(f.instance.endsAt + COMPETITION_DETAILS_TTL);
  });

  it("paginates public standings without returning attempt placements or identity IDs", async () => {
    const f = fixture();
    for (let i = 0; i < 21; i++) {
      const identity = { userId: `private:${i}`, username: `player:${i}` };
      const started = await f.start(identity);
      await f.move(started, identity);
    }
    const first = await f.store.standings("daily");
    const second = await f.store.standings("daily", 20);
    expect(first.standings).toHaveLength(20);
    expect(first.hasMore).toBe(true);
    expect(second.standings).toHaveLength(1);
    expect(second.hasMore).toBe(false);
    expect(second.standings[0]).toMatchObject({
      username: "player:20",
      rank: 21,
    });
    expect(JSON.stringify([first, second])).not.toContain("private:");
    expect(JSON.stringify([first, second])).not.toContain("placements");
  });

  it("rejects invalid positions, blocked points, and occupied points", async () => {
    const f = fixture(),
      a = await f.start();
    for (const point of [0, 62, 64, -1, 0.5])
      await expect(f.move(a, alice, point)).rejects.toMatchObject({
        code: "invalid",
      });
  });
});
