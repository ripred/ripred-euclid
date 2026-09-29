import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
// Exercise the installed SDK through its browser artifact, with an in-memory
// transport. Production code imports only its public package entrypoint.
import { createTelemetryClient } from "../../node_modules/@devvit/analytics/client/reddit/telemetry.js";
import { createJourneyController, type JourneyObservation } from "./journeys";
import {
  JOURNEYS_ACTIVITY_HEADER,
  type JourneyActivityRef,
  type JourneyRequestContext,
} from "../shared/journeys";

const solo: JourneyActivityRef = { kind: "solo", gameId: "solo-one" };
const queue: JourneyActivityRef = { kind: "h2h-queue" };
const round: JourneyActivityRef = {
  kind: "h2h",
  gameId: "match-one",
  roundStartRevision: 0,
};
const puzzle: JourneyActivityRef = {
  kind: "competition",
  period: "daily",
  instanceId: "daily-one",
  attemptId: "attempt-one",
};
const observation = (
  activity: JourneyActivityRef = solo,
  overrides: Partial<JourneyObservation> = {},
): JourneyObservation => ({
  activity,
  moves: 0,
  squares: 0,
  progress: 0,
  terminal: false,
  ...overrides,
});
const storage = () => {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
    removeItem: (key: string) => {
      data.delete(key);
    },
  };
};
type Event = {
  kind: string;
  context: JourneyRequestContext;
  body: Record<string, unknown>;
};
let id = 0;
function harness(
  config: {
    store?: ReturnType<typeof storage> | null;
    fetch?: (event: Event) => Promise<Response>;
    now?: () => number;
  } = {},
) {
  const events: Event[] = [];
  const store = config.store === undefined ? storage() : config.store;
  const fetcher: typeof fetch = async (url, init) => {
    const event: Event = {
      kind: String(url).split("/").at(-1)!,
      context: JSON.parse(
        new Headers(init?.headers).get(JOURNEYS_ACTIVITY_HEADER)!,
      ),
      body: init?.body ? JSON.parse(String(init.body)) : {},
    };
    events.push(event);
    return config.fetch
      ? config.fetch(event)
      : Response.json({
          ...(event.kind === "start" ? { journeyId: `journey-${++id}` } : {}),
          receipt: { status: "JOURNEY_RECEIPT_VALID", message: "accepted" },
        });
  };
  const controller = createJourneyController({
    storage: store,
    fetch: fetcher,
    createClient: createTelemetryClient,
    newId: () => `token-${++id}`,
    ...(config.now ? { now: config.now } : {}),
  });
  return {
    controller,
    events,
    store,
    of: (kind: string) => events.filter((e) => e.kind === kind),
  };
}

const parentPostMessage =
  vi.fn<
    (message: { userProgress?: { state: number } }, target: string) => void
  >();
beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  parentPostMessage.mockClear();
  vi.stubGlobal("parent", { postMessage: parentPostMessage });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("optional gameplay Journeys", () => {
  it("readies once without passively starting for state, views, or interactions", async () => {
    const h = harness();
    h.controller.ready("post", "player");
    h.controller.ready("post", "player");
    h.controller.observe(
      observation(solo, { moves: 5, squares: 2, terminal: true }),
    );
    h.controller.interaction("rules", "opened");
    expect(h.controller.restore(solo)).toBe(false);
    await h.controller.settled();
    expect(h.events.map((e) => e.kind)).toEqual(["app-ready"]);
    expect(h.events[0]!.context.activity).toBeUndefined();
  });

  it("starts once and emits only the highest newly crossed progress bucket", async () => {
    const h = harness();
    h.controller.ready("post", "player");
    h.controller.begin(solo);
    h.controller.begin(solo);
    h.controller.observe(
      observation(solo, { moves: 1, squares: 2, progress: 0.8 }),
    );
    for (let i = 0; i < 100; i++)
      h.controller.observe(
        observation(solo, { moves: 1, squares: 2, progress: 0.8 }),
      );
    await h.controller.settled();
    expect(h.of("start")).toHaveLength(1);
    expect(h.of("progress").map((e) => e.body.progress)).toEqual([0.75]);
    expect(h.of("interaction").map((e) => e.body.action)).toEqual([
      "entry",
      "first_move",
      "first_square",
    ]);
  });

  it.each([true, false])(
    "ends exactly once with native complete=%s and never reopens results",
    async (complete) => {
      const h = harness();
      h.controller.ready("post", "player");
      h.controller.begin(solo);
      h.controller.observe(observation(solo, { terminal: true, complete }));
      h.controller.observe(observation(solo, { terminal: true, complete }));
      h.controller.begin(solo, "resume");
      h.controller.interaction("rules", "opened");
      await h.controller.settled();
      expect(h.of("end")).toHaveLength(1);
      expect(h.of("end")[0]!.body.complete).toBe(complete);
      expect(h.of("start")).toHaveLength(1);
      expect(h.of("progress").map((e) => e.body.progress)).toEqual(
        complete ? [1] : [],
      );
    },
  );

  it("includes accepted queue wait in the same Journey as the matched round", async () => {
    const h = harness();
    h.controller.ready("post", "player");
    h.controller.begin(queue);
    await h.controller.settled();
    h.controller.begin(round);
    h.controller.observe(observation(round, { moves: 1 }));
    await h.controller.settled();
    expect(h.of("start")).toHaveLength(1);
    expect(h.of("start")[0]!.context.activity).toEqual(queue);
    const matched = h
      .of("interaction")
      .find((e) => e.body.action === "match_found")!;
    expect(matched.context.activity).toEqual(round);
    expect(matched.context.segmentId).toBe(h.of("start")[0]!.context.segmentId);
  });

  it("starts a fresh queue after cancel and isolates late delivery of the old queue", async () => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let starts = 0;
    const h = harness({
      fetch: async (event) => {
        if (event.kind === "start" && ++starts === 1) await held;
        return Response.json({
          journeyId: event.context.segmentId,
          receipt: { status: "JOURNEY_RECEIPT_VALID", message: "accepted" },
        });
      },
    });
    h.controller.ready("post", "player");
    h.controller.begin(queue);
    await vi.waitFor(() => expect(starts).toBe(1));
    h.controller.end("canceled");
    h.controller.begin(queue);
    release();
    await h.controller.settled();
    expect(h.of("start")).toHaveLength(2);
    expect(h.of("end")[0]!.body.complete).toBe(false);
    const saved = JSON.parse([...h.store!.data.values()][0]!);
    expect(saved).toHaveLength(1);
    expect(saved[0].segmentId).toBe(h.of("start")[1]!.context.segmentId);
    expect(saved[0].journeyId).toBe(h.of("start")[1]!.context.segmentId);
    const restored = harness({ store: h.store });
    restored.controller.ready("post", "player");
    expect(restored.controller.restore(queue)).toBe(true);
    restored.controller.begin(round);
    await restored.controller.settled();
    expect(restored.of("start")).toHaveLength(0);
  });

  it("restores an active attempt after reload without manufacturing another start", async () => {
    const h = harness();
    h.controller.ready("post", "player");
    h.controller.begin(puzzle);
    h.controller.observe(
      observation(puzzle, { moves: 1, squares: 1, progress: 0.25 }),
    );
    await h.controller.settled();
    const reloaded = harness({ store: h.store });
    reloaded.controller.ready("post", "player");
    expect(reloaded.controller.restore(puzzle)).toBe(true);
    reloaded.controller.observe(
      observation(puzzle, {
        moves: 2,
        squares: 4,
        progress: 1,
        terminal: true,
      }),
    );
    await reloaded.controller.settled();
    expect(reloaded.of("start")).toHaveLength(0);
    expect(reloaded.of("end")).toHaveLength(1);
    expect(reloaded.of("end")[0]!.body.journeyId).toBe(
      h.of("interaction")[0]!.body.journeyId,
    );
  });

  it("pauses challenges across other games without inventing abandonment", async () => {
    const h = harness();
    h.controller.ready("post", "player");
    h.controller.begin(puzzle);
    await h.controller.settled();
    h.controller.pause();
    h.controller.begin(solo);
    await h.controller.settled();
    h.controller.pause();
    h.controller.begin(puzzle, "resume", observation(puzzle));
    await h.controller.settled();
    expect(h.of("start")).toHaveLength(2);
    expect(h.of("end")).toHaveLength(0);
    expect(h.controller.activeActivity()).toEqual(puzzle);
  });

  it("does not start a different rematch from passive canonical observation", async () => {
    const h = harness();
    h.controller.ready("post", "player");
    h.controller.begin(round);
    h.controller.observe(observation(round, { terminal: true }));
    await h.controller.settled();
    const rematch = { ...round, roundStartRevision: 22 } as JourneyActivityRef;
    expect(h.controller.restore(rematch)).toBe(false);
    h.controller.observe(observation(rematch, { moves: 1 }));
    await h.controller.settled();
    expect(h.of("start")).toHaveLength(1);
    h.controller.begin(rematch, "rematch");
    await h.controller.settled();
    expect(h.of("start")).toHaveLength(2);
  });

  it("does not backfill milestones when a player intentionally resumes", async () => {
    const h = harness();
    h.controller.ready("post", "player");
    const baseline = observation(solo, { moves: 8, squares: 2, progress: 0.6 });
    h.controller.begin(solo, "resume", baseline);
    h.controller.observe(baseline);
    await h.controller.settled();
    expect(h.of("progress")).toHaveLength(0);
    expect(h.of("interaction").map((e) => e.body.action)).toEqual(["entry"]);
  });

  it("does not extend idle time from polls, scores, or opponent activity", async () => {
    let now = 1_000;
    const h = harness({ now: () => now });
    h.controller.ready("post", "player");
    h.controller.begin(solo);
    await h.controller.settled();
    now += 29 * 60_000;
    h.controller.observe(observation(solo, { progress: 0.6 }));
    await h.controller.settled();
    now += 60_000;
    expect(h.controller.restore(solo)).toBe(false);
    h.controller.interaction("rules", "opened");
    h.controller.observe(observation(solo, { terminal: true }));
    await h.controller.settled();
    expect(h.of("end")).toHaveLength(0);
    h.controller.begin(solo, "resume", observation(solo, { progress: 0.6 }));
    await h.controller.settled();
    expect(h.of("start")).toHaveLength(2);
  });

  it("refreshes idle on accepted player actions even when no new milestone is reached", async () => {
    let now = 1_000;
    const h = harness({ now: () => now });
    h.controller.ready("post", "player");
    h.controller.begin(solo);
    await h.controller.settled();
    now += 29 * 60_000;
    h.controller.begin(solo, "resume", observation());
    now += 2 * 60_000;
    expect(h.controller.restore(solo)).toBe(true);
    await h.controller.settled();
    expect(h.of("start")).toHaveLength(1);
  });

  it("does not refresh player activity when polling discovers a queue pairing", async () => {
    let now = 1_000;
    const h = harness({ now: () => now });
    h.controller.ready("post", "player");
    h.controller.begin(queue);
    await h.controller.settled();
    now += 29 * 60_000;
    h.controller.begin(round);
    await h.controller.settled();
    now += 60_000;
    expect(h.controller.restore(round)).toBe(false);
    h.controller.observe(observation(round, { terminal: true }));
    await h.controller.settled();
    expect(h.of("end")).toHaveLength(0);
    expect(h.of("start")).toHaveLength(1);
  });

  it("does not delay a committed game start behind App.Ready delivery", async () => {
    let resolveReady!: (response: Response) => void;
    const h = harness({
      fetch: async (event) =>
        event.kind === "app-ready"
          ? new Promise((resolve) => {
              resolveReady = resolve;
            })
          : Response.json({
              journeyId: "accepted-game",
              receipt: {
                status: "JOURNEY_RECEIPT_VALID",
                message: "accepted",
              },
            }),
    });
    h.controller.ready("post", "player");
    h.controller.begin(solo);
    await vi.waitFor(() => expect(h.of("start")).toHaveLength(1));
    resolveReady(
      Response.json({
        receipt: {
          status: "JOURNEY_RECEIPT_VALID",
          message: "accepted",
        },
      }),
    );
    await h.controller.settled();
    expect(h.of("interaction").map((event) => event.body.action)).toEqual([
      "entry",
    ]);
  });

  it.each(["abandoned", "canceled", "retry", "unavailable"] as const)(
    "does not emit a late explicit %s End after the idle timeout",
    async (reason) => {
      let now = 1_000;
      const h = harness({ now: () => now });
      h.controller.ready("post", "player");
      h.controller.begin(solo);
      await h.controller.settled();
      now += 30 * 60_000;
      h.controller.end(reason);
      await h.controller.settled();
      expect(h.of("end")).toHaveLength(0);
      expect(h.of("start")).toHaveLength(1);
      expect(h.of("interaction").map((event) => event.body.action)).toEqual([
        "entry",
      ]);
    },
  );

  it("caps interactions and never sends user identifiers as details", async () => {
    const h = harness();
    h.controller.ready("private-post", "private-user");
    h.controller.begin(solo);
    for (let i = 0; i < 100; i++)
      h.controller.interaction("sound", i % 2 ? "on" : "off");
    await h.controller.settled();
    expect(h.of("interaction")).toHaveLength(32);
    expect(JSON.stringify(h.events.map((e) => e.body))).not.toContain(
      "private-",
    );
  });

  it("retains tutorial completion until a legitimate start, without creating a tutorial journey", async () => {
    const h = harness();
    h.controller.ready("post", "player");
    h.controller.tutorialCompleted();
    await h.controller.settled();
    expect(h.of("start")).toHaveLength(0);
    h.controller.begin(solo);
    await h.controller.settled();
    expect(
      h.of("interaction").map((e) => [e.body.action, e.body.actionDetails]),
    ).toContainEqual(["tutorial", "completed"]);
  });

  it.each(["throw", "denied"])(
    "never retries a %s start or lets progress auto-start",
    async (failure) => {
      const h = harness({
        fetch: async (event) => {
          if (event.kind === "start" && failure === "throw")
            throw new Error("reply lost");
          return Response.json({
            journeyId: "",
            receipt: {
              status: "JOURNEY_RECEIPT_DENIED_DISABLED",
              message: "disabled",
            },
          });
        },
      });
      h.controller.ready("post", "player");
      h.controller.begin(solo);
      await h.controller.settled();
      h.controller.begin(solo);
      h.controller.observe(
        observation(solo, {
          moves: 1,
          squares: 1,
          progress: 0.8,
          terminal: true,
        }),
      );
      await h.controller.settled();
      expect(h.of("start")).toHaveLength(1);
      expect(h.of("progress")).toHaveLength(0);
      expect(h.of("end")).toHaveLength(0);
    },
  );

  it.each(["headers", "body"])(
    "bounds slow response %s to two seconds",
    async (part) => {
      vi.useFakeTimers();
      const h = harness({
        fetch: async (event) => {
          if (event.kind !== "start")
            return Response.json({
              receipt: { status: "JOURNEY_RECEIPT_VALID", message: "ok" },
            });
          if (part === "headers") return new Promise<Response>(() => {});
          const response = Response.json({});
          response.text = () => new Promise<string>(() => {});
          return response;
        },
      });
      h.controller.ready("post", "player");
      h.controller.begin(solo);
      await vi.advanceTimersByTimeAsync(2_001);
      await h.controller.settled();
      expect(h.of("start")).toHaveLength(1);
      h.controller.begin({ kind: "solo", gameId: "next" });
      await vi.advanceTimersByTimeAsync(2_001);
      await h.controller.settled();
      expect(h.of("start")).toHaveLength(2);
    },
  );

  it("isolates posts, users, and tab stores and bounds saved activities", async () => {
    const h = harness();
    h.controller.ready("post", "player");
    h.controller.begin(solo);
    await h.controller.settled();
    for (const [post, user, store] of [
      ["other", "player", h.store],
      ["post", "other", h.store],
      ["post", "player", storage()],
    ] as const) {
      const other = harness({ store });
      other.controller.ready(post, user);
      expect(other.controller.restore(solo)).toBe(false);
      await other.controller.settled();
    }
    for (let i = 0; i < 25; i++) {
      h.controller.begin({ kind: "solo", gameId: `game-${i}` });
      await h.controller.settled();
    }
    expect(JSON.parse([...h.store!.data.values()][0]!)).toHaveLength(16);
  });

  it("degrades to memory if sessionStorage becomes unavailable", async () => {
    const store = storage();
    store.getItem = () => {
      throw new Error("denied");
    };
    store.setItem = () => {
      throw new Error("denied");
    };
    const h = harness({ store });
    h.controller.ready("post", "player");
    h.controller.begin(solo);
    h.controller.observe(observation(solo, { terminal: true }));
    await h.controller.settled();
    expect(h.of("start")).toHaveLength(1);
    expect(h.of("end")).toHaveLength(1);
  });

  it("carries exact abandonment proof without client-supplied scores", async () => {
    const h = harness();
    h.controller.ready("post", "player");
    h.controller.begin(puzzle);
    const command = {
      commandId: "command",
      expectedRevision: 4,
      instanceId: "daily-one",
      attemptId: "attempt-one",
    };
    h.controller.end("abandoned", command);
    await h.controller.settled();
    expect(h.of("end")[0]!.context).toMatchObject({
      activity: puzzle,
      endReason: "abandoned",
      commandId: "command",
      expectedRevision: 4,
    });
    expect(h.of("end")[0]!.body).not.toHaveProperty("game");
    expect(h.of("end")[0]!.context).not.toHaveProperty("instanceId");
    expect(h.of("end")[0]!.context).not.toHaveProperty("attemptId");
  });

  it.each([
    "JOURNEY_RECEIPT_DENIED_NOT_ALLOWLISTED",
    "JOURNEY_RECEIPT_DENIED_DISABLED",
    "JOURNEY_RECEIPT_DENIED_PLAYTEST",
    "JOURNEY_RECEIPT_DENIED_RATE_LIMITED",
    "JOURNEY_RECEIPT_INVALID",
    "JOURNEY_RECEIPT_UNSPECIFIED",
  ])("does not reuse a nonempty ID from %s", async (status) => {
    const h = harness({
      fetch: async () =>
        Response.json({
          journeyId: "unaccepted-id",
          receipt: { status, message: "not ingested" },
        }),
    });
    h.controller.ready("post", "player");
    h.controller.begin(solo);
    await h.controller.settled();
    h.controller.observe(
      observation(solo, { moves: 1, progress: 0.9, terminal: true }),
    );
    await h.controller.settled();
    expect(h.of("start")).toHaveLength(1);
    expect(h.of("interaction")).toHaveLength(0);
    expect(h.of("progress")).toHaveLength(0);
    expect(h.of("end")).toHaveLength(0);
  });

  it.each([true, false])(
    "retains official SDK native progress notifications for completed=%s",
    async (complete) => {
      const h = harness({
        fetch: async () =>
          Response.json({
            journeyId: "valid-id",
            receipt: { status: "JOURNEY_RECEIPT_VALID", message: "accepted" },
            shouldNotifyClient: true,
          }),
      });
      h.controller.ready("post", "player");
      h.controller.begin(solo);
      h.controller.observe(observation(solo, { progress: 0.5 }));
      h.controller.observe(observation(solo, { terminal: true, complete }));
      await h.controller.settled();
      const states = parentPostMessage.mock.calls.map(
        ([effect]) => effect.userProgress?.state,
      );
      expect(states).toContain(1);
      expect(states.includes(2)).toBe(complete);
    },
  );
});
