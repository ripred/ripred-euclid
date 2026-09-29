import {
  createTelemetryClient,
  type TelemetryClient,
} from "@devvit/analytics/client/reddit";
import type { TelemetryClientOptions } from "@devvit/analytics/shared/reddit";
import {
  JOURNEYS_ACTIVITY_HEADER,
  JOURNEYS_INTERACTION_LIMIT,
  JOURNEYS_REQUEST_TIMEOUT_MS,
  JOURNEY_MILESTONES,
  journeyActivityKey,
  isJourneyInteraction,
  parseJourneyActivity,
  type JourneyActivityRef,
  type JourneyEndReason,
  type JourneyInteraction,
  type JourneyInteractionDetail,
  type JourneyMilestone,
  type JourneyRequestContext,
} from "../shared/journeys";
import { isCount, isRecord } from "../shared/guards";

const STORAGE_PREFIX = "euclid:journeys:v1:";
const IDLE_MS = 30 * 60 * 1000;
type StorageAccess = Pick<Storage, "getItem" | "setItem" | "removeItem">;
type JourneyRecord = {
  activity: JourneyActivityRef;
  segmentId: string;
  journeyId?: string;
  attempted: boolean;
  ended: boolean;
  touchedAt: number;
  milestones: (
    | JourneyMilestone
    | "first_move"
    | "first_square"
    | "match_found"
  )[];
  interactions: number;
};
export type JourneyObservation = {
  activity: JourneyActivityRef;
  moves: number;
  squares: number;
  progress: number;
  terminal: boolean;
  complete?: boolean;
};
export type JourneyControllerOptions = {
  storage?: StorageAccess | null;
  now?: () => number;
  newId?: () => string;
  fetch?: typeof fetch;
  createClient?: (options: TelemetryClientOptions) => TelemetryClient;
};

/** Analytics is optional. A denied storage API or transport never affects play. */
export function createJourneyController(
  options: JourneyControllerOptions = {},
) {
  const now = options.now ?? Date.now;
  const newId = options.newId ?? (() => crypto.randomUUID());
  const documentId = newId();
  const memory = new Map<string, string>();
  let storage = options.storage;
  if (storage === undefined) {
    try {
      storage = globalThis.sessionStorage;
    } catch {
      storage = null;
    }
  }
  const read = (key: string) => {
    try {
      return storage?.getItem(key) ?? memory.get(key) ?? null;
    } catch {
      storage = null;
      return memory.get(key) ?? null;
    }
  };
  const write = (key: string, value: string) => {
    memory.set(key, value);
    try {
      storage?.setItem(key, value);
    } catch {
      storage = null;
    }
  };
  let storageKey = "";
  let record: JourneyRecord | null = null;
  const records = new Map<string, JourneyRecord>();
  const recordScopes = new WeakMap<JourneyRecord, string>();
  let attached = false;
  let readySent = false;
  let completedTutorial = false;
  let chain = Promise.resolve();
  let readyRequest: Promise<unknown> = Promise.resolve();
  let requestContext: JourneyRequestContext = { documentId };
  const persist = (target: JourneyRecord) => {
    if (!storageKey || recordScopes.get(target) !== storageKey) return;
    const key = journeyActivityKey(target.activity);
    const existing = records.get(key);
    if (existing && existing !== target) return;
    records.set(key, target);
    if (records.size > 16) {
      const oldest = [...records.entries()]
        .filter(([, value]) => value !== record)
        .sort((a, b) => a[1].touchedAt - b[1].touchedAt)[0];
      if (oldest) records.delete(oldest[0]);
    }
    write(storageKey, JSON.stringify([...records.values()]));
  };
  const schedule = (work: () => Promise<unknown>) => {
    const scope = storageKey;
    chain = chain.then(async () => {
      if (scope !== storageKey) return;
      try {
        await work();
      } catch {
        /* Optional analytics. */
      }
    });
  };
  const fetchWithContext = async (
    context: JourneyRequestContext,
    input: Parameters<typeof fetch>[0],
    init?: RequestInit,
  ): Promise<Response> => {
    const abort = new AbortController();
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        (async () => {
          const headers = new Headers(init?.headers);
          headers.set(JOURNEYS_ACTIVITY_HEADER, JSON.stringify(context));
          const response = await (options.fetch ?? globalThis.fetch)(input, {
            ...init,
            headers,
            signal: abort.signal,
          });
          const body = await response.text();
          if (body.length > 64_000)
            throw new Error("Journey response too large");
          return new Response(body, {
            status: response.status,
            statusText: response.statusText,
            headers: response.headers,
          });
        })(),
        new Promise<Response>((_resolve, reject) => {
          timeout = setTimeout(() => {
            abort.abort();
            reject(new Error("Journey request timed out"));
          }, JOURNEYS_REQUEST_TIMEOUT_MS);
        }),
      ]);
    } finally {
      if (timeout !== undefined) clearTimeout(timeout);
    }
  };
  const fetcher: typeof fetch = (input, init) =>
    fetchWithContext(requestContext, input, init);
  const clients = new WeakMap<JourneyRecord, TelemetryClient>();
  const createClient = options.createClient ?? createTelemetryClient;
  const clientFor = (target: JourneyRecord) => {
    let client = clients.get(target);
    if (!client) {
      client = createClient({
        fetch: fetcher,
        journeySession: {
          getActiveJourneyId: () => target.journeyId,
          setJourneyId: (journeyId) => {
            target.journeyId = journeyId;
            persist(target);
          },
          clearJourneyId: () => {
            delete target.journeyId;
            persist(target);
          },
          isPersistent: () => !!storage,
        },
      });
      clients.set(target, client);
    }
    return client;
  };
  const contextFor = (target: JourneyRecord): JourneyRequestContext => ({
    documentId,
    segmentId: target.segmentId,
    activity: target.activity,
  });
  const load = () => {
    records.clear();
    try {
      const values: unknown = JSON.parse(read(storageKey) ?? "[]");
      if (!Array.isArray(values) || values.length > 16) return;
      for (const value of values) {
        if (!isRecord(value)) continue;
        const activity = parseJourneyActivity(value.activity);
        if (
          !activity ||
          typeof value.segmentId !== "string" ||
          !value.segmentId ||
          typeof value.attempted !== "boolean" ||
          typeof value.ended !== "boolean" ||
          !isCount(value.touchedAt) ||
          now() - value.touchedAt >= IDLE_MS ||
          !isCount(value.interactions) ||
          value.interactions > JOURNEYS_INTERACTION_LIMIT ||
          !Array.isArray(value.milestones) ||
          !value.milestones.every(
            (m) =>
              typeof m === "string" &&
              (Object.hasOwn(JOURNEY_MILESTONES, m) ||
                ["first_move", "first_square", "match_found"].includes(m)),
          ) ||
          (value.journeyId !== undefined && typeof value.journeyId !== "string")
        )
          continue;
        const restored = { ...value, activity } as JourneyRecord;
        recordScopes.set(restored, storageKey);
        records.set(journeyActivityKey(activity), restored);
      }
    } catch {
      /* Corrupt optional analytics storage is ignored. */
    }
  };
  const interaction = (
    action: JourneyInteraction,
    actionDetails: JourneyInteractionDetail,
    intentional = true,
  ) => {
    const target = record;
    if (!isJourneyInteraction(action, actionDetails)) return;
    if (
      !target ||
      !attached ||
      target.ended ||
      now() - target.touchedAt >= IDLE_MS ||
      target.interactions >= JOURNEYS_INTERACTION_LIMIT
    )
      return;
    target.interactions++;
    if (intentional) target.touchedAt = now();
    persist(target);
    schedule(async () => {
      if (!target.journeyId) return;
      requestContext = contextFor(target);
      await clientFor(target).interaction({ action, actionDetails });
    });
  };
  const milestone = (target: JourneyRecord, action: JourneyMilestone) => {
    if (target.milestones.includes(action)) return;
    target.milestones.push(action);
    persist(target);
    schedule(async () => {
      if (!target.journeyId) return; // progress() would otherwise auto-start.
      requestContext = contextFor(target);
      await clientFor(target).progress({
        action,
        progress: JOURNEY_MILESTONES[action],
      });
    });
  };
  const end = (
    reason: JourneyEndReason,
    proof?: { commandId: string; expectedRevision: number },
  ) => {
    const target = record;
    if (!target || target.ended || now() - target.touchedAt >= IDLE_MS) return;
    interaction("exit", reason, false);
    target.ended = true;
    attached = false;
    target.touchedAt = now();
    persist(target);
    schedule(async () => {
      if (!target.journeyId) return;
      requestContext = {
        ...contextFor(target),
        endReason: reason,
        ...(proof
          ? {
              commandId: proof.commandId,
              expectedRevision: proof.expectedRevision,
            }
          : {}),
      };
      await clientFor(target).endJourney({ complete: reason === "completed" });
    });
  };
  const begin = (
    activity: JourneyActivityRef,
    entry: "new" | "resume" | "rematch" | "retry" = "new",
    baseline?: JourneyObservation,
  ) => {
    if (!storageKey) return;
    const key = journeyActivityKey(activity);
    if (
      record &&
      journeyActivityKey(record.activity) === key &&
      now() - record.touchedAt >= IDLE_MS
    ) {
      records.delete(key);
      record = null;
      attached = false;
    }
    if (record && journeyActivityKey(record.activity) !== key) {
      // Accepted matchmaking promotes the same journey; queue time is retained.
      if (
        record.activity.kind === "h2h-queue" &&
        activity.kind === "h2h" &&
        !record.ended
      ) {
        records.delete(journeyActivityKey(record.activity));
        record.activity = activity;
        attached = true;
        persist(record);
        record.milestones.push("match_found");
        interaction("match_found", "achieved", false);
        return;
      }
      attached = false;
      record = null;
    }
    const saved = records.get(key);
    if (saved && now() - saved.touchedAt >= IDLE_MS) records.delete(key);
    record ??= records.get(key) ?? null;
    if (record?.ended && activity.kind === "h2h-queue" && entry === "new") {
      records.delete(key);
      record = null;
    }
    if (record?.ended) return;
    if (record && attached) {
      record.touchedAt = now();
      persist(record);
      return;
    }
    record ??= {
      activity,
      segmentId: newId(),
      attempted: false,
      ended: false,
      touchedAt: now(),
      milestones: [],
      interactions: 0,
    };
    const target = record;
    recordScopes.set(target, storageKey);
    attached = true;
    target.touchedAt = now();
    if (baseline && entry === "resume") {
      if (baseline.moves > 0 && !target.milestones.includes("first_move"))
        target.milestones.push("first_move");
      if (baseline.squares > 0 && !target.milestones.includes("first_square"))
        target.milestones.push("first_square");
      for (const action of ["quarter", "half", "three_quarters"] as const)
        if (
          baseline.progress >= JOURNEY_MILESTONES[action] &&
          !target.milestones.includes(action)
        )
          target.milestones.push(action);
    }
    if (!target.attempted) {
      target.attempted = true; // Persist before delivery; ambiguous responses are never retried.
      persist(target);
      schedule(async () => {
        requestContext = contextFor(target);
        const client = clientFor(target);
        const existingId = client.getActiveJourneyId();
        const result = await client.startJourney();
        if (!existingId && result.receipt.status !== "JOURNEY_RECEIPT_VALID")
          client.clearJourneyId();
      });
    }
    persist(target);
    interaction("entry", entry);
    if (completedTutorial) {
      completedTutorial = false;
      interaction("tutorial", "completed");
    }
  };
  const observe = (next: JourneyObservation) => {
    const target = record;
    if (
      !target ||
      !attached ||
      target.ended ||
      now() - target.touchedAt >= IDLE_MS ||
      journeyActivityKey(target.activity) !== journeyActivityKey(next.activity)
    )
      return;
    target.activity = next.activity;
    for (const [action, achieved] of [
      ["first_move", next.moves > 0],
      ["first_square", next.squares > 0],
    ] as const) {
      if (achieved && !target.milestones.includes(action)) {
        target.milestones.push(action);
        interaction(action, "achieved", false);
      }
    }
    const crossed = (["quarter", "half", "three_quarters"] as const).filter(
      (action) =>
        next.progress >= JOURNEY_MILESTONES[action] &&
        !target.milestones.includes(action),
    );
    const highest = crossed.at(-1);
    if (highest) {
      target.milestones.push(...crossed.slice(0, -1));
      milestone(target, highest);
    }
    if (next.terminal) {
      if (next.complete !== false) milestone(target, "completed");
      end(next.complete === false ? "abandoned" : "completed");
    }
  };
  return {
    ready(postId: string, user: string) {
      const key = `${STORAGE_PREFIX}${encodeURIComponent(postId)}:${encodeURIComponent(user)}`;
      if (storageKey !== key) {
        storageKey = key;
        record = null;
        load();
        attached = false;
      }
      if (readySent) return;
      readySent = true;
      readyRequest = (async () => {
        await createClient({
          fetch: (input, init) => fetchWithContext({ documentId }, input, init),
          journeySession: {
            getActiveJourneyId: () => undefined,
            setJourneyId: () => {},
            clearJourneyId: () => {},
            isPersistent: () => false,
          },
        }).appReady();
      })().catch(() => {});
    },
    begin,
    observe,
    interaction,
    end,
    restore(activity: JourneyActivityRef) {
      const saved = records.get(journeyActivityKey(activity));
      if (
        !saved ||
        saved.ended ||
        !saved.journeyId ||
        now() - saved.touchedAt >= IDLE_MS
      )
        return false;
      record = saved;
      record.activity = activity;
      attached = true;
      return true;
    },
    pause() {
      if (attached) interaction("pause", "left_view");
      attached = false;
    },
    tutorialCompleted() {
      if (attached && !record?.ended) interaction("tutorial", "completed");
      else completedTutorial = true;
    },
    /** Awaited only in deterministic tests; gameplay never waits for analytics. */
    settled: async () => {
      await Promise.all([chain, readyRequest]);
    },
    activeActivity: () =>
      attached && !record?.ended ? (record?.activity ?? null) : null,
  };
}

export type JourneyController = ReturnType<typeof createJourneyController>;
