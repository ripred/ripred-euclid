import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_CHALLENGE_OPTIONS,
  type ChallengeOptions,
} from "../shared/challenge";
import type { ChallengePeriod } from "../shared/challenge-spotlights";
import type {
  CompetitionApplyRequest,
  CompetitionTemplate,
  CompetitionSummary,
} from "../shared/competitions";
import { DEFAULT_SUBREDDIT_SETTINGS } from "../shared/subreddit-settings";
import type { CertifiedChallenge } from "./challenge-generator";
import { CHALLENGE_RESULTS_KEY } from "./challenge-results";
import { CompetitionGameplay } from "./competition-gameplay";
import {
  COMPETITION_STATE_KEY,
  competitionInstanceKey,
  competitionSummaryKey,
  competitionWindow,
  competitionWinsKey,
  readCompetitionState,
  type CompetitionInstance,
  type CompetitionLifecycleState,
} from "./competition-model";
import { CompetitionService } from "./competition-service";
import { CompetitionMemoryRedis } from "./testing/competition-memory-redis";

const time = (iso: string) => Date.parse(iso);
const template: CompetitionTemplate = {
  ...DEFAULT_CHALLENGE_OPTIONS,
  minimumMoves: 1,
  targetSquares: 1,
  geometry: "aligned",
  sharedCorner: false,
  blockedPoints: [],
};
const certified = (
  options: ChallengeOptions,
  seed: string,
): CertifiedChallenge => ({
  puzzle: {
    version: 1,
    size: 8,
    initial: [0, 1, 8],
    blocked: options.blockedPoints,
    minimumMoves: options.minimumMoves,
    targetSquares: options.targetSquares,
  },
  seed,
  solutions: [[9]],
});
function fixture(iso = "2026-09-27T12:00:00.000Z") {
  let now = time(iso),
    sequence = 0;
  const redis = new CompetitionMemoryRedis(() => now);
  const generate = vi.fn(certified);
  const service = new CompetitionService(redis, {
    now: () => now,
    newId: () => `lifecycle-${++sequence}`,
    generate,
  });
  const lifecycle = () =>
    readCompetitionState(redis.value(COMPETITION_STATE_KEY));
  const current = (
    period: ChallengePeriod,
  ): CompetitionInstance | undefined => {
    const id = lifecycle().periods[period].currentId;
    return id
      ? redis.json<CompetitionInstance>(competitionInstanceKey(id))
      : undefined;
  };
  const request = async (
    period: ChallengePeriod,
    options = template,
  ): Promise<CompetitionApplyRequest> => ({
    options,
    expectedRevision: (await service.templates()).templates[period].revision,
    commandId: `apply-${++sequence}`,
    confirmReset: true,
  });
  return {
    service,
    redis,
    generate,
    lifecycle,
    current,
    request,
    setTime: (iso: string) => {
      now = time(iso);
    },
    now: () => now,
  };
}

describe("UTC challenge calendar", () => {
  it.each([
    [
      "daily",
      "2028-02-28T23:59:59.999Z",
      "2028-02-28T00:00:00.000Z",
      "2028-02-29T00:00:00.000Z",
    ],
    [
      "daily",
      "2028-02-29T00:00:00.000Z",
      "2028-02-29T00:00:00.000Z",
      "2028-03-01T00:00:00.000Z",
    ],
    [
      "daily",
      "2026-12-31T23:59:59.999Z",
      "2026-12-31T00:00:00.000Z",
      "2027-01-01T00:00:00.000Z",
    ],
    [
      "weekly",
      "2026-09-27T23:59:59.999Z",
      "2026-09-21T00:00:00.000Z",
      "2026-09-28T00:00:00.000Z",
    ],
    [
      "weekly",
      "2026-09-28T00:00:00.000Z",
      "2026-09-28T00:00:00.000Z",
      "2026-10-05T00:00:00.000Z",
    ],
    [
      "weekly",
      "2027-01-01T00:00:00.000Z",
      "2026-12-28T00:00:00.000Z",
      "2027-01-04T00:00:00.000Z",
    ],
    [
      "daily",
      "2026-03-08T23:00:00-05:00",
      "2026-03-09T00:00:00.000Z",
      "2026-03-10T00:00:00.000Z",
    ],
  ] as const)(
    "finds the %s period for %s without local timezone offsets",
    (period, now, opensAt, endsAt) => {
      expect(competitionWindow(period, time(now))).toEqual({
        opensAt: time(opensAt),
        endsAt: time(endsAt),
      });
    },
  );
});

describe("saved competition templates and activation", () => {
  it("starts disabled with independent templates, next-start application, and visible standings", async () => {
    const { service, generate } = fixture();
    const state = await service.templates();
    expect(state.settings).toEqual(DEFAULT_SUBREDDIT_SETTINGS);
    expect(state.templates.daily.active.options.minimumMoves).toBe(2);
    expect(state.templates.weekly.active.options.minimumMoves).toBe(3);
    expect(state.templates.daily.pending).toBeNull();
    expect(state.templates.weekly.pending).toBeNull();
    expect(JSON.stringify(state.templates)).not.toContain('"seed"');
    await service.reconcile();
    expect(generate).not.toHaveBeenCalled();
  });

  it("keeps separate pending daily and weekly templates and replaces a pending save", async () => {
    const { service, request, generate } = fixture("2026-09-24T12:00:00.000Z");
    const before = await service.templates();
    await service.apply("daily", "mod", await request("daily"));
    const weekly = {
      ...template,
      minimumMoves: 3,
      targetSquares: 4,
      geometry: "oblique" as const,
    };
    await service.apply("weekly", "mod", await request("weekly", weekly));
    const daily = {
      ...template,
      blockedCount: 2,
      blockedPoints: [62, 63],
      multipleSolutions: true,
    };
    await service.apply("daily", "mod", await request("daily", daily));
    const after = await service.templates();
    expect(after.templates.daily.active).toEqual(before.templates.daily.active);
    expect(after.templates.daily.pending).toMatchObject({
      options: daily,
      effectiveAt: time("2026-09-25T00:00:00.000Z"),
    });
    expect(after.templates.weekly.active).toEqual(
      before.templates.weekly.active,
    );
    expect(after.templates.weekly.pending).toMatchObject({
      options: weekly,
      effectiveAt: time("2026-09-28T00:00:00.000Z"),
    });
    expect(generate).not.toHaveBeenCalled();
    expect(after.settings.dailyChallenges).toBe(false);
    expect(after.settings.weeklyChallenges).toBe(false);
  });

  it("does not retain an accidentally supplied playground seed", async () => {
    const { service, request } = fixture();
    const playground = { ...template, seed: "private-playground-seed" };
    await service.apply("daily", "mod", await request("daily", playground));
    const state = await service.templates();
    expect(state.templates.daily.pending?.options).toEqual(template);
    expect(JSON.stringify(state)).not.toContain("private-playground-seed");
  });

  it("activates a pending template at its boundary, even if maintenance was delayed", async () => {
    const { service, request, setTime, current, generate } = fixture();
    await service.apply("daily", "mod", await request("daily"));
    await service.saveSettings({
      ...DEFAULT_SUBREDDIT_SETTINGS,
      dailyChallenges: true,
    });
    expect(current("daily")).toBeUndefined();
    setTime("2026-09-29T06:00:00.000Z");
    await service.reconcile();
    const state = await service.templates();
    expect(state.templates.daily.active.options).toEqual(template);
    expect(state.templates.daily.pending).toBeNull();
    expect(current("daily")).toMatchObject({
      opensAt: time("2026-09-29T00:00:00.000Z"),
      endsAt: time("2026-09-30T00:00:00.000Z"),
      templateRevision: state.templates.daily.active.revision,
    });
    expect(generate.mock.calls.at(-1)?.[0]).toEqual(template);
  });

  it("changing application timing or standings does not replace the current board", async () => {
    const { service, current, generate } = fixture();
    await service.saveSettings({
      ...DEFAULT_SUBREDDIT_SETTINGS,
      dailyChallenges: true,
      challengeApplyTiming: "immediately",
    });
    const original = current("daily");
    expect(original).toBeDefined();
    const generations = generate.mock.calls.length;
    await service.saveSettings({
      ...DEFAULT_SUBREDDIT_SETTINGS,
      dailyChallenges: true,
      challengeApplyTiming: "next-start",
      showLiveChallengeStandings: false,
    });
    expect(current("daily")).toEqual(original);
    expect(generate).toHaveBeenCalledTimes(generations);
  });
});

describe("immediate competition replacement", () => {
  it("requires explicit reset confirmation and rejects a stale template revision", async () => {
    const { service, request, generate } = fixture();
    await service.saveSettings({
      ...DEFAULT_SUBREDDIT_SETTINGS,
      challengeApplyTiming: "immediately",
    });
    const unconfirmed = { ...(await request("daily")), confirmReset: false };
    await expect(service.apply("daily", "mod", unconfirmed)).rejects.toThrow();
    expect(generate).not.toHaveBeenCalled();
    const stale = await request("daily");
    await service.apply("daily", "mod", await request("daily"));
    await expect(service.apply("daily", "other-mod", stale)).rejects.toThrow();
  });

  it("prepares while disabled, replays a lost Apply response, and enables that same instance", async () => {
    const { service, request, current, generate } = fixture();
    await service.saveSettings({
      ...DEFAULT_SUBREDDIT_SETTINGS,
      challengeApplyTiming: "immediately",
    });
    const command = await request("daily");
    await service.apply("daily", "mod", command);
    const original = current("daily");
    expect(original).toBeDefined();
    expect((await service.templates()).settings.dailyChallenges).toBe(false);
    await service.apply("daily", "mod", command);
    expect(current("daily")).toEqual(original);
    expect((await service.templates()).templates.daily.activationAt).toBe(
      original!.opensAt,
    );
    expect(generate).toHaveBeenCalledTimes(1);
    await service.saveSettings({
      ...DEFAULT_SUBREDDIT_SETTINGS,
      dailyChallenges: true,
      challengeApplyTiming: "immediately",
    });
    expect(current("daily")).toEqual(original);
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it("replaces the instance, retains its calendar deadline, and supersedes pending settings", async () => {
    const { service, request, current, redis } = fixture();
    await service.saveSettings({
      ...DEFAULT_SUBREDDIT_SETTINGS,
      dailyChallenges: true,
      challengeApplyTiming: "immediately",
    });
    const original = current("daily")!;
    await service.saveSettings({
      ...DEFAULT_SUBREDDIT_SETTINGS,
      dailyChallenges: true,
    });
    await service.apply(
      "daily",
      "mod",
      await request("daily", { ...template, minimumMoves: 2 }),
    );
    await service.saveSettings({
      ...DEFAULT_SUBREDDIT_SETTINGS,
      dailyChallenges: true,
      challengeApplyTiming: "immediately",
    });
    await service.apply("daily", "mod", await request("daily"));
    expect(current("daily")?.id).not.toBe(original.id);
    expect(current("daily")?.endsAt).toBe(original.endsAt);
    expect(
      redis.json<CompetitionInstance>(competitionInstanceKey(original.id))
        ?.superseded,
    ).toBe(true);
    const state = (await service.templates()).templates.daily;
    expect(state.active.options).toEqual(template);
    expect(state.pending).toBeNull();
  });

  it("retains the previous board and settings when replacement certification fails", async () => {
    const { service, request, current, generate } = fixture();
    await service.saveSettings({
      ...DEFAULT_SUBREDDIT_SETTINGS,
      dailyChallenges: true,
      challengeApplyTiming: "immediately",
    });
    const original = current("daily");
    const before = (await service.templates()).templates.daily;
    generate.mockImplementation(() => {
      throw new Error("No certified puzzle fits these options.");
    });
    await expect(
      service.apply("daily", "mod", await request("daily")),
    ).rejects.toThrow();
    expect(current("daily")).toEqual(original);
    const after = (await service.templates()).templates.daily;
    expect(after.active).toEqual(before.active);
    expect(after.pending).toEqual(before.pending);
    expect(after.revision).toBe(before.revision);
  });

  it("preserves an unexpired instance across disabling and re-enabling", async () => {
    const { service, current, setTime, generate } = fixture();
    await service.saveSettings({
      ...DEFAULT_SUBREDDIT_SETTINGS,
      dailyChallenges: true,
      challengeApplyTiming: "immediately",
    });
    const original = current("daily");
    await service.saveSettings({ ...DEFAULT_SUBREDDIT_SETTINGS });
    setTime("2026-09-27T19:00:00.000Z");
    await service.reconcile();
    await service.saveSettings({
      ...DEFAULT_SUBREDDIT_SETTINGS,
      dailyChallenges: true,
    });
    expect(current("daily")).toEqual(original);
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it("accepts only one concurrent moderator save from the same template revision", async () => {
    const { service, request } = fixture();
    const first = await request("daily");
    const second = await request("daily", { ...template, minimumMoves: 2 });
    const results = await Promise.allSettled([
      service.apply("daily", "first-mod", first),
      service.apply("daily", "second-mod", second),
    ]);
    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect(
      results.filter((result) => result.status === "rejected"),
    ).toHaveLength(1);
    expect((await service.templates()).templates.daily.revision).toBe(1);
  });

  it("rejects reusing an Apply command identity for different settings", async () => {
    const { service, request } = fixture();
    const command = await request("daily");
    await service.apply("daily", "mod", command);
    await expect(
      service.apply("daily", "mod", {
        ...command,
        options: { ...template, minimumMoves: 2 },
      }),
    ).rejects.toThrow(/already used/);
    expect(
      (await service.templates()).templates.daily.pending?.options,
    ).toEqual(template);
  });
});

describe("scheduled preparation and generation recovery", () => {
  it("prepares in the five minutes before the boundary and opens both periods together", async () => {
    const { service, setTime, current, lifecycle, generate } = fixture(
      "2026-09-27T23:54:59.999Z",
    );
    await service.saveSettings({
      ...DEFAULT_SUBREDDIT_SETTINGS,
      dailyChallenges: true,
      weeklyChallenges: true,
    });
    await service.reconcile();
    expect(generate).not.toHaveBeenCalled();
    setTime("2026-09-27T23:55:00.000Z");
    await service.reconcile();
    expect(generate).toHaveBeenCalledTimes(2);
    const prepared = {
      daily: lifecycle().periods.daily.preparedId,
      weekly: lifecycle().periods.weekly.preparedId,
    };
    expect(prepared.daily).toBeTruthy();
    expect(prepared.weekly).toBeTruthy();
    expect(current("daily")).toBeUndefined();
    expect(current("weekly")).toBeUndefined();
    setTime("2026-09-28T00:00:00.000Z");
    await service.reconcile();
    expect(current("daily")?.id).toBe(prepared.daily);
    expect(current("weekly")?.id).toBe(prepared.weekly);
    expect(current("daily")?.opensAt).toBe(time("2026-09-28T00:00:00.000Z"));
    expect(current("weekly")?.opensAt).toBe(time("2026-09-28T00:00:00.000Z"));
    expect(generate).toHaveBeenCalledTimes(2);
  });

  it("invalidates the prepared puzzle when its applicable template changes", async () => {
    const { service, setTime, request, current, lifecycle, generate } = fixture(
      "2026-09-27T23:56:00.000Z",
    );
    await service.saveSettings({
      ...DEFAULT_SUBREDDIT_SETTINGS,
      dailyChallenges: true,
    });
    await service.reconcile();
    const oldPrepared = lifecycle().periods.daily.preparedId;
    await service.apply("daily", "mod", await request("daily"));
    await service.reconcile();
    expect(lifecycle().periods.daily.preparedId).not.toBe(oldPrepared);
    setTime("2026-09-28T00:00:00.000Z");
    await service.reconcile();
    expect(current("daily")?.certified.puzzle.minimumMoves).toBe(
      template.minimumMoves,
    );
    expect(generate.mock.calls.at(-1)?.[0]).toEqual(template);
  });

  it("stops after three failed generation attempts and permits a fresh apply", async () => {
    const { service, request, generate, setTime } = fixture();
    generate.mockImplementation(() => {
      throw new Error("Certification budget exhausted.");
    });
    await service.saveSettings({
      ...DEFAULT_SUBREDDIT_SETTINGS,
      dailyChallenges: true,
    });
    setTime("2026-09-28T00:00:00.000Z");
    for (let i = 0; i < 5; i++) await service.reconcile();
    expect(generate).toHaveBeenCalledTimes(3);
    expect(
      (await service.templates()).templates.daily.generationError,
    ).toBeTruthy();
    generate.mockImplementation(certified);
    await service.saveSettings({
      ...DEFAULT_SUBREDDIT_SETTINGS,
      dailyChallenges: true,
      challengeApplyTiming: "immediately",
    });
    await service.apply("daily", "mod", await request("daily"));
    expect(
      (await service.templates()).templates.daily.generationError,
    ).toBeNull();
    expect(generate).toHaveBeenCalledTimes(4);
  });

  it("caps failures independently for the current and next puzzle during preparation", async () => {
    const { service, generate, setTime } = fixture("2026-09-27T23:54:00.000Z");
    generate.mockImplementation(() => {
      throw new Error("Certification budget exhausted.");
    });
    await service.saveSettings({
      ...DEFAULT_SUBREDDIT_SETTINGS,
      dailyChallenges: true,
      challengeApplyTiming: "immediately",
    });
    expect(generate).toHaveBeenCalledTimes(3);
    setTime("2026-09-27T23:56:00.000Z");
    for (let i = 0; i < 4; i++) await service.reconcile();
    expect(generate).toHaveBeenCalledTimes(6);
  });

  it("recovers an abandoned generation lease only after it expires", async () => {
    const { service, redis, lifecycle, current, generate, setTime } = fixture(
      "2026-09-27T23:59:00.000Z",
    );
    await service.saveSettings({
      ...DEFAULT_SUBREDDIT_SETTINGS,
      dailyChallenges: true,
    });
    const state = lifecycle();
    state.periods.daily.preparedId = null;
    state.periods.daily.generation = {
      target: `${time("2026-09-28T00:00:00.000Z")}:0`,
      attempts: 1,
      token: "crashed-worker",
      leaseUntil: time("2026-09-28T00:01:00.000Z"),
      error: null,
    };
    redis.seed(COMPETITION_STATE_KEY, JSON.stringify(state));
    generate.mockClear();
    setTime("2026-09-28T00:00:30.000Z");
    await service.reconcile();
    expect(generate).not.toHaveBeenCalled();
    expect(current("daily")).toBeUndefined();
    setTime("2026-09-28T00:01:00.000Z");
    await service.reconcile();
    expect(generate).toHaveBeenCalledTimes(1);
    expect(current("daily")).toBeDefined();
  });

  it("reports an unavailable challenge and moderator error after the third abandoned generation", async () => {
    const { service, redis, lifecycle, generate, setTime, now } = fixture(
      "2026-09-27T12:00:00.000Z",
    );
    await service.saveSettings({
      ...DEFAULT_SUBREDDIT_SETTINGS,
      dailyChallenges: true,
    });
    const state = lifecycle();
    state.periods.daily.generation = {
      target: `${time("2026-09-28T00:00:00.000Z")}:0`,
      attempts: 3,
      token: "third-crashed-worker",
      leaseUntil: time("2026-09-28T00:01:00.000Z"),
      error: null,
    };
    redis.seed(COMPETITION_STATE_KEY, JSON.stringify(state));
    setTime("2026-09-28T00:02:00.000Z");
    await service.reconcile();
    expect(generate).not.toHaveBeenCalled();
    const gameplay = new CompetitionGameplay(redis, { now });
    expect((await gameplay.availability()).competitions.daily.status).toBe(
      "unavailable",
    );
    expect(
      (await service.templates()).templates.daily.generationError,
    ).toBeTruthy();
  });
});

describe("boundary races and outage recovery", () => {
  it("preserves an already due template when a moderator saves the following period before maintenance", async () => {
    const { service, request, setTime, current } = fixture();
    await service.apply("daily", "mod", await request("daily"));
    await service.saveSettings({
      ...DEFAULT_SUBREDDIT_SETTINGS,
      dailyChallenges: true,
    });
    setTime("2026-09-28T00:01:00.000Z");
    const next = { ...template, minimumMoves: 2 };
    await service.apply("daily", "mod", await request("daily", next));
    const state = (await service.templates()).templates.daily;
    expect(state.active.options).toEqual(template);
    expect(state.pending?.options).toEqual(next);
    expect(state.pending?.effectiveAt).toBe(time("2026-09-29T00:00:00.000Z"));
    await service.reconcile();
    expect(current("daily")?.certified.puzzle.minimumMoves).toBe(1);
  });

  it("rejects an immediate replacement that finishes after midnight without changing the previous instance", async () => {
    const { service, request, current, generate, setTime } = fixture(
      "2026-09-27T23:54:00.000Z",
    );
    await service.saveSettings({
      ...DEFAULT_SUBREDDIT_SETTINGS,
      dailyChallenges: true,
      challengeApplyTiming: "immediately",
    });
    const original = current("daily");
    const before = (await service.templates()).templates.daily;
    generate.mockImplementationOnce((options, seed) => {
      setTime("2026-09-28T00:00:00.000Z");
      return certified(options, seed);
    });
    await expect(
      service.apply("daily", "mod", await request("daily")),
    ).rejects.toThrow(/period/);
    expect(current("daily")).toEqual(original);
    const after = (await service.templates()).templates.daily;
    expect(after.active).toEqual(before.active);
    expect(after.revision).toEqual(before.revision);
  });

  it("never publishes delayed preparation over a board already opened by another worker", async () => {
    const { service, redis, current, setTime, now, generate } = fixture(
      "2026-09-27T23:54:00.000Z",
    );
    await service.saveSettings({
      ...DEFAULT_SUBREDDIT_SETTINGS,
      dailyChallenges: true,
    });
    let otherSequence = 0;
    const other = new CompetitionService(redis, {
      now,
      newId: () => `other-worker-${++otherSequence}`,
      generate,
    });
    let triggered = false;
    let independentlyOpened: string | undefined;
    redis.beforeExec = async (writes) => {
      if (
        triggered ||
        !writes.some(
          (write) =>
            write.action === "set" &&
            write.key.startsWith("euclid:competition:instance:"),
        )
      )
        return;
      triggered = true;
      setTime("2026-09-28T00:00:00.000Z");
      await other.reconcile();
      independentlyOpened = current("daily")?.id;
    };
    setTime("2026-09-27T23:56:00.000Z");
    await service.reconcile();
    expect(triggered).toBe(true);
    expect(independentlyOpened).toBeDefined();
    expect(current("daily")?.id).toBe(independentlyOpened);
    expect(generate).toHaveBeenCalledTimes(2);
  });

  it("does not promote an old prepared board over an existing instance in the same calendar period", async () => {
    const { service, redis, lifecycle, current } = fixture(
      "2026-09-28T00:01:00.000Z",
    );
    await service.saveSettings({
      ...DEFAULT_SUBREDDIT_SETTINGS,
      dailyChallenges: true,
      challengeApplyTiming: "immediately",
    });
    const opened = current("daily")!;
    const oldPrepared = {
      ...opened,
      id: "old-prepared",
      opensAt: time("2026-09-28T00:00:00.000Z"),
    };
    const state = lifecycle();
    state.periods.daily.preparedId = oldPrepared.id;
    redis.seed(
      competitionInstanceKey(oldPrepared.id),
      JSON.stringify(oldPrepared),
    );
    redis.seed(COMPETITION_STATE_KEY, JSON.stringify(state));
    await service.reconcile();
    expect(current("daily")?.id).toBe(opened.id);
    expect(lifecycle().periods.daily.preparedId).toBeNull();
  });

  it("still awards a completed challenge when maintenance resumes after more than 90 days", async () => {
    const { service, redis, request, current, setTime, now } = fixture(
      "2026-09-27T12:00:00.000Z",
    );
    await service.saveSettings({
      ...DEFAULT_SUBREDDIT_SETTINGS,
      challengeApplyTiming: "immediately",
    });
    await service.apply("daily", "mod", await request("daily"));
    await service.saveSettings({
      ...DEFAULT_SUBREDDIT_SETTINGS,
      dailyChallenges: true,
      challengeApplyTiming: "immediately",
    });
    const id = current("daily")!.id;
    const identity = {
      userId: "long-outage-winner",
      username: "LongOutageWinner",
    };
    const gameplay = new CompetitionGameplay(redis, { now });
    const started = await gameplay.mutate("daily", identity, "start", {
      instanceId: id,
      commandId: "start",
      attemptId: null,
      expectedRevision: 0,
    });
    setTime("2026-09-27T12:00:01.000Z");
    await gameplay.mutate("daily", identity, "move", {
      instanceId: id,
      commandId: "finish",
      attemptId: started.snapshot!.attemptId,
      expectedRevision: started.snapshot!.revision,
      point: 9,
    });
    setTime("2026-12-28T00:00:00.000Z");
    await service.reconcile();
    expect(
      redis.json<CompetitionSummary>(competitionSummaryKey(id))?.winner
        ?.username,
    ).toBe(identity.username);
    expect(redis.json(competitionWinsKey(identity.userId))).toEqual({
      daily: 1,
      weekly: 0,
    });
    await service.reconcile();
    expect(redis.json(competitionWinsKey(identity.userId))).toEqual({
      daily: 1,
      weekly: 0,
    });
  });
});

describe("durable settlement recovery", () => {
  function queueInstance(
    redis: CompetitionMemoryRedis,
    state: CompetitionLifecycleState,
    id: string,
    opensAt: string,
    winner: string | null,
    superseded = false,
  ): CompetitionInstance {
    const window = competitionWindow("daily", time(opensAt));
    const instance: CompetitionInstance = {
      id,
      period: "daily",
      ...window,
      templateRevision: 0,
      certified: certified(template, id),
      superseded,
      settled: false,
      completionOrder: winner ? 1 : 0,
      leader: winner
        ? {
            userId: winner,
            username: winner,
            moves: 1,
            elapsedMs: 1000,
            achievedAt: window.opensAt + 1000,
            order: 1,
            member: winner,
          }
        : null,
    };
    redis.seed(competitionInstanceKey(id), JSON.stringify(instance));
    state.settlementQueue.push({ id, endsAt: window.endsAt });
    return instance;
  }

  it("settles missed periods once, including disabled challenges, without overwriting a newer spotlight", async () => {
    const { service, redis, lifecycle } = fixture("2026-10-05T12:00:00.000Z");
    const state = lifecycle();
    // Deliberately queue the more recent result before the older recovery item.
    queueInstance(
      redis,
      state,
      "recent",
      "2026-10-03T00:00:00.000Z",
      "recent-player",
    );
    queueInstance(
      redis,
      state,
      "old",
      "2026-09-27T00:00:00.000Z",
      "old-player",
    );
    redis.seed(COMPETITION_STATE_KEY, JSON.stringify(state));
    await service.reconcile();
    const recent = redis.json<CompetitionSummary>(
      competitionSummaryKey("recent"),
    );
    const old = redis.json<CompetitionSummary>(competitionSummaryKey("old"));
    expect(recent?.winner?.username).toBe("recent-player");
    expect(old?.winner?.username).toBe("old-player");
    expect(
      redis.json<{ daily: { username: string } }>(CHALLENGE_RESULTS_KEY)?.daily
        .username,
    ).toBe("recent-player");
    const wins = redis.value(competitionWinsKey("recent-player"));
    expect(wins).toBeDefined();
    expect(redis.json(competitionWinsKey("recent-player"))).toEqual({
      daily: 1,
      weekly: 0,
    });
    await service.reconcile();
    expect(redis.value(competitionWinsKey("recent-player"))).toBe(wins);
    expect(lifecycle().settlementQueue).toEqual([]);
  });

  it("does not award a winner for an empty or superseded instance", async () => {
    const { service, redis, lifecycle } = fixture("2026-10-05T12:00:00.000Z");
    const state = lifecycle();
    queueInstance(redis, state, "empty", "2026-09-27T00:00:00.000Z", null);
    queueInstance(
      redis,
      state,
      "replaced",
      "2026-09-28T00:00:00.000Z",
      "discarded-player",
      true,
    );
    redis.seed(COMPETITION_STATE_KEY, JSON.stringify(state));
    await service.reconcile();
    expect(
      redis.json<CompetitionSummary>(competitionSummaryKey("empty"))?.winner,
    ).toBeNull();
    expect(
      redis.json<CompetitionSummary>(competitionSummaryKey("replaced"))?.winner,
    ).toBeNull();
    expect(redis.value(competitionWinsKey("discarded-player"))).toBeUndefined();
  });

  it("retains compact settlement evidence when detailed instances expire after 90 days", async () => {
    const { service, redis, lifecycle, setTime } = fixture(
      "2026-09-28T01:00:00.000Z",
    );
    const state = lifecycle();
    queueInstance(
      redis,
      state,
      "retained-result",
      "2026-09-27T00:00:00.000Z",
      "winner",
    );
    redis.seed(COMPETITION_STATE_KEY, JSON.stringify(state));
    await service.reconcile();
    setTime("2026-12-28T00:00:00.000Z");
    expect(
      redis.value(competitionInstanceKey("retained-result")),
    ).toBeUndefined();
    expect(
      redis.json<CompetitionSummary>(competitionSummaryKey("retained-result"))
        ?.winner?.username,
    ).toBe("winner");
    expect(redis.json(competitionWinsKey("winner"))).toEqual({
      daily: 1,
      weekly: 0,
    });
  });
});
