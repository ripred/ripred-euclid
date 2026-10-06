import express from "express";
import { once } from "node:events";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_CHALLENGE_OPTIONS } from "../shared/challenge";
import {
  CHALLENGE_PERIODS,
  type ChallengePeriod,
} from "../shared/challenge-spotlights";
import type {
  CompetitionAvailabilityResponse,
  CompetitionStateResponse,
  CompetitionTemplatesResponse,
} from "../shared/competitions";
import { DEFAULT_SUBREDDIT_SETTINGS } from "../shared/subreddit-settings";
import type { CompetitionIdentity } from "./competition-gameplay";
import { competitionRouter } from "./competition-routes";
import { CompetitionService } from "./competition-service";
import { CompetitionMemoryRedis } from "./testing/competition-memory-redis";

let server: Server,
  origin: string,
  moderator: string | null,
  identity: CompetitionIdentity | null,
  service: CompetitionService;
let now: number, serial: number, failModerator: boolean;
beforeEach(async () => {
  now = Date.UTC(2026, 8, 27, 10);
  serial = 0;
  moderator = "mod";
  identity = { userId: "user", username: "player" };
  failModerator = false;
  service = new CompetitionService(new CompetitionMemoryRedis(() => now), {
    now: () => now,
    newId: () => `generated-${++serial}`,
    generate: () => ({
      puzzle: {
        version: 1,
        size: 8,
        initial: [0, 1, 8],
        blocked: [],
        minimumMoves: 1,
        targetSquares: 1,
      },
      seed: "private-seed",
      solutions: [[9]],
    }),
  });
  const app = express();
  app.use(express.json());
  app.use(
    "/api/competitions",
    competitionRouter(
      service,
      async () => identity,
      async () => {
        if (failModerator) throw new Error("Access lookup failed");
        return moderator;
      },
    ),
  );
  server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/competitions`;
});
afterEach(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
});
const request = (path: string, body?: unknown) =>
  fetch(
    `${origin}/${path}`,
    body === undefined
      ? {}
      : {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
  );
const enable = () =>
  service.saveSettings({
    ...DEFAULT_SUBREDDIT_SETTINGS,
    dailyChallenges: true,
    weeklyChallenges: true,
    challengeApplyTiming: "immediately",
  });
async function start(period: ChallengePeriod = "daily") {
  const info = (await (
    await request("availability")
  ).json()) as CompetitionAvailabilityResponse;
  return request(`${period}/start`, {
    instanceId: info.competitions[period].instanceId,
    attemptId: null,
    expectedRevision: 0,
    commandId: `start-${++serial}`,
  });
}

describe("competition endpoint permissions and responses", () => {
  it.each([
    "__proto__",
    "constructor",
    "prototype",
    "toString",
    "%5f%5fproto%5f%5f",
    "%63onstructor",
    "%255f%255fproto%255f%255f",
    "daily%00",
    "daily%2fweekly",
    "DAILY",
  ])(
    "rejects noncanonical period %s before any state operation",
    async (period) => {
      const redis = service.redis as CompetitionMemoryRedis;
      const before = [...redis.values];
      const prototype = Object.getOwnPropertyDescriptors(Object.prototype);
      const apply = vi.spyOn(service, "apply");
      for (const action of ["state", "standings"])
        expect((await request(`${period}/${action}`)).status).toBe(404);
      for (const action of ["apply", "start", "move", "retry", "abandon"])
        expect((await request(`${period}/${action}`, {})).status).toBe(404);
      expect(apply).not.toHaveBeenCalled();
      expect(redis.reads).toEqual([]);
      expect(redis.commits).toEqual([]);
      expect([...redis.values]).toEqual(before);
      expect(Object.getOwnPropertyDescriptors(Object.prototype)).toEqual(
        prototype,
      );
    },
  );
  it.each(CHALLENGE_PERIODS)(
    "still applies a canonical %s template",
    async (period) => {
      const response = await request(`${period}/apply`, {
        expectedRevision: 0,
        commandId: "canonical-period",
        options: DEFAULT_CHALLENGE_OPTIONS,
      });
      expect(response.status).toBe(200);
      const result = (await response.json()) as CompetitionTemplatesResponse;
      expect(result.templates[period].revision).toBe(1);
    },
  );
  it("requires current moderator authorization for every template operation", async () => {
    moderator = null;
    expect((await request("templates")).status).toBe(403);
    expect(
      (await request("daily/apply", { isModerator: true, userId: "mod" }))
        .status,
    ).toBe(403);
    failModerator = true;
    expect((await request("templates")).status).toBe(503);
  });
  it("permits anonymous availability but refuses all anonymous play commands", async () => {
    await enable();
    identity = null;
    expect((await request("availability")).status).toBe(200);
    const state = (await (
      await request("daily/state")
    ).json()) as CompetitionStateResponse;
    expect(state.snapshot).toBeNull();
    expect(state.authenticated).toBe(false);
    for (const action of ["start", "retry", "move", "abandon"])
      expect((await request(`daily/${action}`, {})).status).toBe(403);
  });
  it.each(CHALLENGE_PERIODS)(
    "abandons %s using trusted identity and returns an empty state",
    async (period) => {
      await enable();
      const current = (await (
        await start(period)
      ).json()) as CompetitionStateResponse;
      const command = {
        instanceId: current.competition.instanceId,
        attemptId: current.snapshot!.attemptId,
        expectedRevision: current.snapshot!.revision,
        commandId: "abandon",
        userId: "user",
      };
      identity = { userId: "other", username: "other" };
      expect((await request(`${period}/abandon`, command)).status).toBe(409);
      identity = { userId: "user", username: "player" };
      const afterSpoof = (await (
        await request(`${period}/state`)
      ).json()) as CompetitionStateResponse;
      expect(afterSpoof.snapshot).toEqual(current.snapshot);
      const abandoned = await request(`${period}/abandon`, command);
      expect(abandoned.status).toBe(200);
      expect(await abandoned.json()).toMatchObject({
        snapshot: null,
        personalBest: null,
        personalRank: null,
      });
      expect((await request(`${period}/abandon`, command)).status).toBe(200);
      const fresh = (await (
        await start(period)
      ).json()) as CompetitionStateResponse;
      expect(fresh.snapshot?.attemptId).not.toBe(current.snapshot?.attemptId);
      expect((await request(`${period}/abandon`, command)).status).toBe(409);
      const afterStale = (await (
        await request(`${period}/state`)
      ).json()) as CompetitionStateResponse;
      expect(afterStale.snapshot).toEqual(fresh.snapshot);
    },
  );
  it("keeps the board private until Start and uses trusted ownership", async () => {
    await enable();
    const initial = (await (
      await request("daily/state")
    ).json()) as CompetitionStateResponse;
    expect(initial.snapshot).toBeNull();
    const begun = await start();
    expect(begun.status).toBe(200);
    const payload = await begun.text();
    expect(payload).not.toMatch(/private-seed|solutions|certified/);
    expect(JSON.parse(payload).snapshot.puzzle.initial).toEqual([0, 1, 8]);
    identity = { userId: "other", username: "other" };
    const other = (await (
      await request("daily/state?userId=user")
    ).json()) as CompetitionStateResponse;
    expect(other.snapshot).toBeNull();
  });
  it("enforces live standings visibility on the server but preserves personal results", async () => {
    await enable();
    const { snapshot, competition } = (await (
      await start()
    ).json()) as CompetitionStateResponse;
    now += 150;
    expect(
      (
        await request("daily/move", {
          instanceId: competition.instanceId,
          attemptId: snapshot!.attemptId,
          expectedRevision: snapshot!.revision,
          commandId: "solve",
          point: 9,
        })
      ).status,
    ).toBe(200);
    await service.saveSettings({
      ...DEFAULT_SUBREDDIT_SETTINGS,
      dailyChallenges: true,
      showLiveChallengeStandings: false,
    });
    const response = await (await request("daily/standings")).json();
    expect(response).toMatchObject({ visible: false, standings: [] });
    const state = (await (
      await request("daily/state")
    ).json()) as CompetitionStateResponse;
    expect(state.personalBest).toMatchObject({
      username: "player",
      moves: 1,
      elapsedMs: 150,
    });
    expect(state.personalRank).toBeNull();
  });
  it("returns refreshed moderator state on stale settings without overwriting it", async () => {
    const apply = {
      expectedRevision: 0,
      commandId: "first",
      options: DEFAULT_CHALLENGE_OPTIONS,
    };
    expect((await request("daily/apply", apply)).status).toBe(200);
    const stale = await request("daily/apply", {
      ...apply,
      commandId: "second",
    });
    expect(stale.status).toBe(409);
    const response = (await stale.json()) as {
      templates: CompetitionTemplatesResponse;
    };
    expect(response.templates.templates.daily.revision).toBe(1);
  });
  it("requires reset acknowledgement and rejects noncanonical periods", async () => {
    await enable();
    expect(
      (
        await request("daily/apply", {
          expectedRevision: 0,
          commandId: "missing-confirm",
          options: DEFAULT_CHALLENGE_OPTIONS,
        })
      ).status,
    ).toBe(400);
    expect((await request("yearly/state")).status).toBe(404);
    for (const action of ["hint", "undo"])
      expect((await request(`daily/${action}`, {})).status).toBe(404);
  });
  it("does not offer disabled boards even when prepared with Apply immediately", async () => {
    await service.saveSettings({
      ...DEFAULT_SUBREDDIT_SETTINGS,
      challengeApplyTiming: "immediately",
    });
    expect(
      (
        await request("daily/apply", {
          expectedRevision: 0,
          commandId: "prepare-disabled",
          options: DEFAULT_CHALLENGE_OPTIONS,
          confirmReset: true,
        })
      ).status,
    ).toBe(200);
    const response = (await (
      await request("availability")
    ).json()) as CompetitionAvailabilityResponse;
    expect(response.competitions.daily).toMatchObject({
      enabled: false,
      status: "disabled",
      instanceId: null,
    });
    expect((await start()).status).toBe(400);
  });
});
