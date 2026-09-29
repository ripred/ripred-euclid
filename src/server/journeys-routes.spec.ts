import express from "express";
import { once } from "node:events";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TelemetryMock } from "@devvit/analytics/server/reddit/test";
import {
  installGlobalConfig,
  makeConfig,
  MOCK_HEADERS,
} from "@devvit/shared-types/test/index.js";
import { Context, runWithContext } from "@devvit/server";
import { journeysRouter } from "./journeys-routes";
import type { JourneyCanonicalActivity } from "./journeys-canonical";
import { JOURNEY_BINDING_TTL_MS } from "./journeys-store";
import { MemoryRedis } from "./testing/memory-redis";
import {
  JOURNEYS_ACTIVITY_HEADER,
  type JourneyRequestContext,
} from "../shared/journeys";

vi.unmock("@devvit/analytics/server/reddit");

let server: Server;
let origin: string;
let now: number;
let redis: MemoryRedis;
let sdk: TelemetryMock;
let identity: { userId?: string; loid?: string; postId?: string };
let canonical: JourneyCanonicalActivity;
let context: JourneyRequestContext;
let reader: ReturnType<
  typeof vi.fn<
    (
      userId: string,
      request: JourneyRequestContext,
    ) => Promise<JourneyCanonicalActivity | null>
  >
>;
let logs: ReturnType<
  typeof vi.fn<
    (event: { event: string; status: string; mode?: string }) => void
  >
>;

beforeEach(async () => {
  now = 100_000;
  redis = new MemoryRedis(() => now);
  sdk = new TelemetryMock();
  installGlobalConfig(
    makeConfig({
      plugins: { "devvit.plugin.telemetry.TelemetryPlugin": sdk.plugin },
    }),
  );
  identity = { userId: "t2_owner", postId: "t3_post" };
  context = {
    documentId: "document-one",
    segmentId: "segment-one",
    activity: { kind: "solo", gameId: "private-game" },
  };
  canonical = {
    activity: context.activity!,
    mode: "ranked",
    variant: "standard",
    difficulty: "tenderfoot",
    status: "active",
    progress: 0,
    hasMove: false,
    hasSquare: false,
  };
  reader = vi.fn(async () => canonical);
  logs = vi.fn();
  const app = express();
  app.use((_req, _res, next) => {
    void runWithContext(
      Context({
        ...MOCK_HEADERS,
        "devvit-user": identity.userId,
        "devvit-post": identity.postId,
      }),
      async () => {
        next();
      },
    );
  });
  app.use(
    "/api/telemetry",
    journeysRouter({
      redis,
      identity: () => identity,
      readCanonical: reader,
      now: () => now,
      log: logs,
    }),
  );
  server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/telemetry/journey`;
});
afterEach(async () => {
  vi.restoreAllMocks();
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
});

async function post(event: string, body?: unknown, request: unknown = context) {
  return fetch(`${origin}/${event}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      [JOURNEYS_ACTIVITY_HEADER]: JSON.stringify(request),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
async function start() {
  const response = await post("start");
  expect(response.status).toBe(200);
  const data = (await response.json()) as { journeyId: string };
  expect(data.journeyId).not.toBe("");
  return data.journeyId;
}
async function responseData(response: Response) {
  return (await response.json()) as {
    journeyId: string;
    receipt: { status: string };
  };
}
async function end(
  journeyId: string,
  reason = "completed",
  body: Record<string, unknown> = {},
) {
  return post("end", { journeyId, ...body }, { ...context, endReason: reason });
}

describe("guarded native Journeys routes", () => {
  it("records readiness once per document, including logged-out loads", async () => {
    identity = { loid: "trusted-logged-out-id", postId: "t3_post" };
    const ready = { documentId: "preview" };
    expect((await post("app-ready", undefined, ready)).status).toBe(200);
    expect((await post("app-ready", undefined, ready)).status).toBe(200);
    expect(
      (await post("app-ready", undefined, { documentId: "expanded" })).status,
    ).toBe(200);
    expect(sdk.getAppReadyEvents()).toHaveLength(2);
    expect((await post("start")).status).toBe(403);
    expect(reader).not.toHaveBeenCalled();
  });

  it("keeps start emissions outside retryable CAS and reuses the same segment", async () => {
    let conflict = true;
    redis.beforeExec = (writes) => {
      const pending = writes.find(
        (write) => write.action === "set" && write.key.includes(":segment:"),
      );
      if (conflict && pending) {
        conflict = false;
        redis.externalSet(pending.key, "");
      }
    };
    const id = await start();
    expect((await responseData(await post("start"))).journeyId).toBe(id);
    expect(sdk.getJourneys()).toHaveLength(1);
  });

  it("coalesces concurrent starts instead of emitting twice", async () => {
    const responses = await Promise.all([post("start"), post("start")]);
    expect(responses.every((response) => response.status === 200)).toBe(true);
    expect(sdk.getJourneys()).toHaveLength(1);
  });

  it("does not automatically retry an unknown start outcome", async () => {
    const send = vi
      .spyOn(sdk.plugin, "StartJourney")
      .mockRejectedValue(new Error("secret failure"));
    expect((await post("start")).status).toBe(503);
    expect((await responseData(await post("start"))).journeyId).toBe("");
    expect(send).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(logs.mock.calls)).not.toContain("secret failure");
  });

  it.each([
    [0, "JOURNEY_RECEIPT_UNSPECIFIED"],
    [2, "JOURNEY_RECEIPT_DENIED_NOT_ALLOWLISTED"],
    [3, "JOURNEY_RECEIPT_DENIED_RATE_LIMITED"],
    [4, "JOURNEY_RECEIPT_DENIED_DUPLICATE"],
    [5, "JOURNEY_RECEIPT_INVALID"],
    [6, "JOURNEY_RECEIPT_DENIED_DISABLED"],
    [7, "JOURNEY_RECEIPT_DENIED_PLAYTEST"],
  ] as const)(
    "preserves receipt %s and suppresses followups when start was not accepted",
    async (status, expected) => {
      // The SDK's success-only mock narrows status to 1; these are valid proto values.
      vi.spyOn(sdk.plugin, "StartJourney").mockResolvedValue({
        journeyId: "denied-id",
        receipt: { status: status as 1, message: "Native diagnostic." },
      });
      const send = vi.spyOn(sdk.plugin, "JourneyInteraction");
      const started = await responseData(await post("start"));
      expect(started.receipt.status).toBe(expected);
      expect(
        (
          await responseData(
            await post("interaction", {
              journeyId: started.journeyId,
              action: "rules",
              actionDetails: "opened",
            }),
          )
        ).receipt.status,
      ).toBe(expected);
      expect(send).not.toHaveBeenCalled();
      expect((await responseData(await post("start"))).receipt.status).toBe(
        expected,
      );
    },
  );

  it("requires a real active activity before starting", async () => {
    for (const status of [
      "completed",
      "abandoned",
      "canceled",
      "expired",
      "replaced",
    ] as const) {
      canonical.status = status;
      expect((await post("start")).status).toBe(409);
    }
    expect(sdk.getJourneys()).toHaveLength(0);
  });

  it("rejects cross-user, cross-post and wrong Journey IDs", async () => {
    const id = await start();
    const body = { journeyId: id, action: "rules", actionDetails: "opened" };
    identity.userId = "t2_attacker";
    expect((await post("interaction", body)).status).toBe(403);
    identity.userId = "t2_owner";
    identity.postId = "t3_other";
    expect((await post("interaction", body)).status).toBe(403);
    identity.postId = "t3_post";
    expect(
      (await post("interaction", { ...body, journeyId: "foreign-journey" }))
        .status,
    ).toBe(403);
    expect(sdk.getJourney(id)?.interactionEvents).toHaveLength(0);
  });

  it("replaces forged outcomes with server canonical results and preserves SDK receipts", async () => {
    const id = await start();
    canonical.status = "completed";
    canonical.progress = 1;
    canonical.game = { win: false, score: 42 };
    const nativeEnd = sdk.plugin.EndJourney.bind(sdk.plugin);
    vi.spyOn(sdk.plugin, "EndJourney").mockImplementation(async (...args) => ({
      ...(await nativeEnd(...args)),
      shouldNotifyClient: true,
    }));
    const response = await end(id, "completed", {
      complete: false,
      game: { win: true, score: 999_999 },
    });
    expect(await response.json()).toEqual({
      receipt: {
        status: "JOURNEY_RECEIPT_VALID",
        message: "Success: Event was recorded.",
      },
      shouldNotifyClient: true,
    });
    expect(sdk.getJourney(id)?.endRequest).toEqual({
      journeyId: id,
      complete: true,
      game: { win: false, score: 42 },
    });
    expect((await responseData(await end(id))).receipt.status).toBe(
      "JOURNEY_RECEIPT_UNSPECIFIED",
    );
    expect(logs.mock.calls.at(-1)?.[0]).toEqual({
      event: "end",
      status: "JOURNEY_RECEIPT_UNSPECIFIED",
    });
  });

  it("does not end active gameplay or a preserved challenge on Back", async () => {
    const id = await start();
    expect((await end(id)).status).toBe(400);
    expect((await end(id, "left_view")).status).toBe(400);
    expect((await end(id, "abandoned")).status).toBe(400);
    expect(sdk.getJourney(id)?.endRequest).toBeUndefined();
  });

  it("validates actual progress and suppresses backward or repeated thresholds", async () => {
    const id = await start();
    const progress = (action: string, value: number) =>
      post("progress", { journeyId: id, action, progress: value });
    expect((await progress("quarter", 0.25)).status).toBe(400);
    canonical.progress = 0.8;
    expect((await progress("three_quarters", 0.75)).status).toBe(200);
    expect((await progress("quarter", 0.25)).status).toBe(200);
    expect((await progress("half", 0.5)).status).toBe(200);
    expect((await progress("three_quarters", 0.75)).status).toBe(200);
    expect((await progress("completed", 1)).status).toBe(400);
    expect(
      sdk.getJourney(id)?.progressEvents.map((event) => event.progress),
    ).toEqual([0.75]);
  });

  it("keeps concurrent progress emissions monotonic", async () => {
    const id = await start();
    canonical.progress = 0.8;
    await Promise.all([
      post("progress", {
        journeyId: id,
        action: "three_quarters",
        progress: 0.75,
      }),
      post("progress", { journeyId: id, action: "quarter", progress: 0.25 }),
    ]);
    const values = sdk
      .getJourney(id)!
      .progressEvents.map((event) => event.progress);
    expect(values).toEqual([...values].sort((a, b) => a - b));
    expect(values.at(-1)).toBe(0.75);
  });

  it("allows fixed interactions only and generates private-data-free canonical dimensions", async () => {
    const id = await start();
    expect(
      (
        await post("interaction", {
          journeyId: id,
          action: "first_move",
          actionDetails: "achieved",
        })
      ).status,
    ).toBe(400);
    canonical.hasMove = true;
    expect(
      (
        await post("interaction", {
          journeyId: id,
          action: "first_move",
          actionDetails: "achieved",
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await post("interaction", {
          journeyId: id,
          action: "chat",
          actionDetails: "my private message",
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await post("interaction", {
          journeyId: id,
          action: "rules",
          actionDetails: "opened",
          username: "secret",
        })
      ).status,
    ).toBe(400);
    await post("interaction", {
      journeyId: id,
      action: "rules",
      actionDetails: "opened",
    });
    await post("interaction", {
      journeyId: id,
      action: "rules",
      actionDetails: "opened",
    });
    expect(sdk.getJourney(id)?.interactionEvents).toHaveLength(2);
    const details = JSON.parse(
      sdk.getJourney(id)!.interactionEvents[0]!.actionDetails,
    );
    expect(details).toEqual({
      mode: "ranked",
      variant: "standard",
      difficulty: "tenderfoot",
      detail: "achieved",
    });
    expect(JSON.stringify(details)).not.toMatch(
      /private-game|owner|post|journey|username/,
    );
    expect(JSON.stringify(logs.mock.calls)).not.toMatch(
      /private-game|t2_owner|t3_post/,
    );
  });

  it("promotes only the queue's actual current pairing and rejects a historical owned win", async () => {
    context.activity = { kind: "h2h-queue" };
    canonical = {
      activity: context.activity,
      mode: "h2h",
      status: "queued",
      progress: 0,
      hasMove: false,
      hasSquare: false,
    };
    const id = await start();
    const actual = {
      kind: "h2h" as const,
      gameId: "new-match",
      roundStartRevision: 0,
    };
    const historical = {
      kind: "h2h" as const,
      gameId: "old-match",
      roundStartRevision: 0,
      terminalRevision: 80,
    };
    reader.mockImplementation(async (_user, request) =>
      request.activity?.kind === "h2h-queue"
        ? { ...canonical, activity: actual, status: "active" }
        : {
            ...canonical,
            activity: request.activity!,
            status: "completed",
            progress: 1,
            game: { win: true, score: 165 },
          },
    );
    expect(
      (
        await post(
          "end",
          { journeyId: id },
          { ...context, activity: historical, endReason: "completed" },
        )
      ).status,
    ).toBe(409);
    expect(
      (
        await post(
          "interaction",
          { journeyId: id, action: "match_found", actionDetails: "achieved" },
          { ...context, activity: actual },
        )
      ).status,
    ).toBe(200);
    expect(sdk.getJourney(id)?.endRequest).toBeUndefined();
    expect(sdk.getJourney(id)?.interactionEvents).toHaveLength(1);
  });

  it("does not turn a cancel-versus-pair race into a canceled Journey", async () => {
    context.activity = { kind: "h2h-queue" };
    canonical = {
      activity: context.activity,
      mode: "h2h",
      status: "queued",
      progress: 0,
      hasMove: false,
      hasSquare: false,
    };
    const id = await start();
    canonical = {
      ...canonical,
      activity: { kind: "h2h", gameId: "paired", roundStartRevision: 0 },
      status: "active",
    };
    expect((await end(id, "canceled")).status).toBe(400);
    expect(sdk.getJourney(id)?.endRequest).toBeUndefined();
    context.activity = canonical.activity;
    expect(
      (
        await post("interaction", {
          journeyId: id,
          action: "match_found",
          actionDetails: "achieved",
        })
      ).status,
    ).toBe(200);
  });

  it("ends a previously queued segment after canonical cancellation", async () => {
    context.activity = { kind: "h2h-queue" };
    canonical = {
      activity: context.activity,
      mode: "h2h",
      status: "queued",
      progress: 0,
      hasMove: false,
      hasSquare: false,
    };
    const id = await start();
    canonical.status = "canceled";
    expect(
      (
        await end(id, "canceled", {
          complete: true,
          game: { win: true, score: 50 },
        })
      ).status,
    ).toBe(200);
    expect(sdk.getJourney(id)?.endRequest).toEqual({
      journeyId: id,
      complete: false,
    });
  });

  it("reports SDK failures as unknown and never re-emits the attempted milestone", async () => {
    const id = await start();
    canonical.progress = 0.5;
    vi.spyOn(console, "error").mockImplementation(() => {});
    const send = vi
      .spyOn(sdk.plugin, "JourneyProgress")
      .mockRejectedValue(new Error("network lost"));
    const body = { journeyId: id, action: "half", progress: 0.5 };
    expect((await post("progress", body)).status).toBe(500);
    expect(
      (await responseData(await post("progress", body))).receipt.status,
    ).toBe("JOURNEY_RECEIPT_UNSPECIFIED");
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("retains sparse active sessions for 24h but rejects expired binding IDs", async () => {
    const id = await start();
    now += 31 * 60_000;
    expect(
      (
        await post("interaction", {
          journeyId: id,
          action: "rules",
          actionDetails: "opened",
        })
      ).status,
    ).toBe(200);
    now += JOURNEY_BINDING_TTL_MS;
    expect(
      (
        await post("interaction", {
          journeyId: id,
          action: "rules",
          actionDetails: "opened",
        })
      ).status,
    ).toBe(403);
  });

  it("bounds JSON and routing headers before parsing or gameplay reads", async () => {
    expect((await post("start", { arbitrary: "x".repeat(3_000) })).status).toBe(
      413,
    );
    expect(
      (await post("start", undefined, { ...context, username: "injected" }))
        .status,
    ).toBe(400);
    expect(
      (
        await post("start", undefined, {
          ...context,
          documentId: "x".repeat(3_000),
        })
      ).status,
    ).toBe(400);
    expect(reader).not.toHaveBeenCalled();
    expect((await post("unknown")).status).toBe(404);
    expect((await fetch(`${origin}/start`, { method: "POST" })).status).toBe(
      400,
    );
    expect(
      (
        await fetch(`${origin}/start`, {
          method: "POST",
          headers: { [JOURNEYS_ACTIVITY_HEADER]: "{" },
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await fetch(`${origin}/start`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            [JOURNEYS_ACTIVITY_HEADER]: JSON.stringify(context),
          },
          body: "{",
        })
      ).status,
    ).toBe(400);
  });

  it("cannot end a deleted challenge without the complete canonical abandonment proof", async () => {
    context.activity = {
      kind: "competition",
      period: "daily",
      instanceId: "instance",
      attemptId: "attempt",
    };
    canonical = { ...canonical, activity: context.activity, mode: "daily" };
    const id = await start();
    reader.mockImplementation(async (_user, request) =>
      request.commandId === "abandon-command" && request.expectedRevision === 4
        ? { ...canonical, status: "abandoned" }
        : null,
    );
    expect(
      (
        await post(
          "end",
          { journeyId: id },
          { ...context, endReason: "abandoned", commandId: "abandon-command" },
        )
      ).status,
    ).toBe(409);
    expect(sdk.getJourney(id)?.endRequest).toBeUndefined();
    expect(
      (
        await post(
          "end",
          { journeyId: id },
          {
            ...context,
            endReason: "abandoned",
            commandId: "abandon-command",
            expectedRevision: 4,
          },
        )
      ).status,
    ).toBe(200);
    expect(sdk.getJourney(id)?.endRequest).toEqual({
      journeyId: id,
      complete: false,
    });
  });

  it("lets the native SDK use the caller's trusted metadata for attribution", async () => {
    const call = vi.spyOn(sdk.plugin, "StartJourney");
    await start();
    expect(call.mock.calls[0]?.[1]?.["devvit-user"]?.values).toEqual([
      "t2_owner",
    ]);
    expect(call.mock.calls[0]?.[0]).toEqual({});
  });

  it("caps fresh start allocations and returns a diagnostic receipt without affecting gameplay", async () => {
    for (let index = 0; index < 10; index++) {
      context.segmentId = `segment-${index}`;
      await start();
    }
    context.segmentId = "segment-eleven";
    const denied = await post("start");
    expect(denied.status).toBe(429);
    expect((await responseData(denied)).receipt.status).toBe(
      "JOURNEY_RECEIPT_DENIED_RATE_LIMITED",
    );
    expect(sdk.getJourneys()).toHaveLength(10);
  });
});
