import express from "express";
import { once } from "node:events";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { challengeRouter } from "./challenge-routes";
import { MemoryRedis } from "./testing/memory-redis";
import {
  DEFAULT_CHALLENGE_OPTIONS,
  type ChallengeSnapshot,
} from "../shared/challenge";

let server: Server, origin: string, owner: string | null, failAccess: boolean;
beforeEach(async () => {
  owner = "moderator";
  failAccess = false;
  const app = express();
  app.use(express.json());
  app.use(
    "/api/challenge-lab",
    challengeRouter(new MemoryRedis(), async () => {
      if (failAccess) throw new Error("lookup unavailable");
      return owner;
    }),
  );
  server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/challenge-lab`;
});
afterEach(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
});
const request = (action: string, body?: unknown) =>
  fetch(
    `${origin}/${action}`,
    body === undefined
      ? {}
      : {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
  );
const generate = () =>
  request("generate", {
    commandId: "generate",
    expectedRevision: 0,
    puzzleId: null,
    attemptId: null,
    options: { ...DEFAULT_CHALLENGE_OPTIONS, seed: "routes" },
  });

describe("challenge endpoint boundaries", () => {
  it("requires moderator authorization for every operation", async () => {
    owner = null;
    for (const action of ["state", "generate", "move", "restart", "abandon"])
      expect(
        (await request(action, action === "state" ? undefined : {})).status,
      ).toBe(403);
    failAccess = true;
    expect((await request("state")).status).toBe(503);
  });
  it("uses only authenticated ownership and never returns the certificate", async () => {
    const created = await generate();
    expect(created.status).toBe(200);
    const { snapshot } = (await created.json()) as {
      snapshot: ChallengeSnapshot;
    };
    const text = await (await request("state")).text();
    expect(text).not.toMatch(/solutions|seed|certification/);
    owner = "another_moderator";
    expect(
      await (
        await request(`state?userId=moderator&puzzleId=${snapshot.puzzleId}`)
      ).json(),
    ).toEqual({ snapshot: null });
    const response = await request("move", {
      commandId: "forged",
      expectedRevision: snapshot.revision,
      puzzleId: snapshot.puzzleId,
      attemptId: snapshot.attemptId,
      point: 0,
      userId: "moderator",
    });
    expect(response.status).toBe(410);
    for (const path of ["watch", "share", "undo", "hint"])
      expect((await request(path, {})).status).toBe(404);
    owner = null;
    expect((await request("state")).status).toBe(403);
  });
});
