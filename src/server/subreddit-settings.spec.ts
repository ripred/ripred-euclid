import express from "express";
import { once } from "node:events";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_SUBREDDIT_SETTINGS } from "../shared/subreddit-settings";
import {
  readSubredditSettings,
  SUBREDDIT_SETTINGS_KEY,
  subredditSettingsRouter,
} from "./subreddit-settings";
import { MemoryRedis } from "./testing/memory-redis";

describe("stored subreddit settings", () => {
  it("uses defaults for newly added settings without changing saved challenge visibility", async () => {
    const redis = new MemoryRedis();
    redis.seed(
      SUBREDDIT_SETTINGS_KEY,
      JSON.stringify({
        dailyChallenges: true,
        weeklyChallenges: false,
        challengeApplyTiming: "next-start",
        showLiveChallengeStandings: true,
      }),
    );
    expect(await readSubredditSettings(redis)).toEqual({
      ...DEFAULT_SUBREDDIT_SETTINGS,
      dailyChallenges: true,
    });
    expect(redis.commits).toHaveLength(0);
  });
  it.each([
    undefined,
    "not json",
    "null",
    JSON.stringify({ dailyChallenges: true }),
    JSON.stringify({ dailyChallenges: true, weeklyChallenges: "false" }),
    JSON.stringify({
      dailyChallenges: true,
      weeklyChallenges: true,
      unknown: true,
    }),
  ])("defaults unreadable settings to both challenges off: %s", async (raw) => {
    const redis = new MemoryRedis();
    if (raw !== undefined) redis.seed(SUBREDDIT_SETTINGS_KEY, raw);
    expect(await readSubredditSettings(redis)).toEqual(
      DEFAULT_SUBREDDIT_SETTINGS,
    );
    expect(redis.commits).toHaveLength(0);
  });
});

describe("subreddit settings endpoint", () => {
  let server: Server, origin: string, redis: MemoryRedis;
  let moderator: string | null, failAccess: boolean, accessChecks: number;

  beforeEach(async () => {
    redis = new MemoryRedis();
    moderator = "moderator";
    failAccess = false;
    accessChecks = 0;
    const app = express();
    app.use(express.json());
    app.use(
      "/api/subreddit-settings",
      subredditSettingsRouter(redis, async () => {
        accessChecks++;
        if (failAccess) throw new Error("lookup unavailable");
        return moderator;
      }),
    );
    server = app.listen(0, "127.0.0.1");
    await once(server, "listening");
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/subreddit-settings`;
  });

  afterEach(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  });

  const save = (body: unknown) =>
    fetch(origin, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

  it("lets any viewer read defaults without a moderator lookup", async () => {
    moderator = null;
    failAccess = true;
    const response = await fetch(origin);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      settings: DEFAULT_SUBREDDIT_SETTINGS,
    });
    expect(accessChecks).toBe(0);
    expect(redis.commits).toHaveLength(0);
  });

  it("persists a moderator's choices for another viewer and replaces both switches", async () => {
    const settings = {
      ...DEFAULT_SUBREDDIT_SETTINGS,
      tideMode: true,
      dailyChallenges: true,
      weeklyChallenges: false,
    };
    const response = await save({ settings });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ settings });
    expect(redis.json(SUBREDDIT_SETTINGS_KEY)).toEqual(settings);

    moderator = null;
    expect(await (await fetch(origin)).json()).toEqual({ settings });
    expect(accessChecks).toBe(1);

    moderator = "another_moderator";
    const updated = {
      ...DEFAULT_SUBREDDIT_SETTINGS,
      dailyChallenges: false,
      weeklyChallenges: true,
    };
    expect((await save({ settings: updated })).status).toBe(200);
    moderator = null;
    expect(await (await fetch(origin)).json()).toEqual({ settings: updated });
    expect(redis.json(SUBREDDIT_SETTINGS_KEY)).toEqual(updated);
    expect(accessChecks).toBe(2);
  });

  it("checks permission on every save and denies a viewer claiming to be a moderator", async () => {
    const settings = {
      ...DEFAULT_SUBREDDIT_SETTINGS,
      tideMode: true,
      dailyChallenges: true,
      weeklyChallenges: false,
    };
    expect((await save({ settings })).status).toBe(200);
    moderator = null;
    const response = await save({
      settings: {
        dailyChallenges: false,
        weeklyChallenges: true,
        tideMode: false,
      },
      isModerator: true,
      userId: "moderator",
    });
    expect(response.status).toBe(403);
    expect(redis.json(SUBREDDIT_SETTINGS_KEY)).toEqual(settings);
    expect(redis.commits).toHaveLength(1);
    expect(accessChecks).toBe(2);
  });

  it("fails closed when moderator access cannot be checked", async () => {
    const settings = { dailyChallenges: false, weeklyChallenges: true };
    redis.seed(SUBREDDIT_SETTINGS_KEY, JSON.stringify(settings));
    failAccess = true;
    const response = await save({
      settings: { dailyChallenges: true, weeklyChallenges: false },
    });
    expect(response.status).toBe(503);
    expect(redis.json(SUBREDDIT_SETTINGS_KEY)).toEqual(settings);
    expect(redis.commits).toHaveLength(0);
  });

  it.each([
    {},
    { settings: null },
    { settings: [] },
    { settings: { dailyChallenges: true } },
    { settings: { dailyChallenges: true, weeklyChallenges: "false" } },
    {
      settings: {
        dailyChallenges: true,
        weeklyChallenges: true,
        unknown: true,
      },
    },
  ])(
    "rejects incomplete or invalid switches without changing storage: %j",
    async (body) => {
      const settings = { dailyChallenges: false, weeklyChallenges: true };
      redis.seed(SUBREDDIT_SETTINGS_KEY, JSON.stringify(settings));
      expect((await save(body)).status).toBe(400);
      expect(redis.json(SUBREDDIT_SETTINGS_KEY)).toEqual(settings);
      expect(redis.commits).toHaveLength(0);
    },
  );
});
