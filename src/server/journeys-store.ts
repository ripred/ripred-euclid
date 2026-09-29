import { createHash } from "node:crypto";
import type { JourneyReceiptStatus } from "@devvit/analytics/shared/reddit";
import {
  JOURNEYS_INTERACTION_LIMIT,
  isJourneyMilestone,
  journeyActivityKey,
  parseJourneyActivity,
  type JourneyActivityRef,
} from "../shared/journeys";
import { redisCas, type RedisCasClient } from "./redis-cas";
import { reserveWindowBudget } from "./request-limits";

export const JOURNEY_BINDING_TTL_MS = 24 * 60 * 60_000;
export const JOURNEY_RECEIPT_STATUSES = new Set<JourneyReceiptStatus>([
  "JOURNEY_RECEIPT_VALID",
  "JOURNEY_RECEIPT_UNSPECIFIED",
  "JOURNEY_RECEIPT_INVALID",
  "JOURNEY_RECEIPT_DENIED_DUPLICATE",
  "JOURNEY_RECEIPT_DENIED_NOT_ALLOWLISTED",
  "JOURNEY_RECEIPT_DENIED_RATE_LIMITED",
  "JOURNEY_RECEIPT_DENIED_DISABLED",
  "JOURNEY_RECEIPT_DENIED_PLAYTEST",
]);
const PREFIX = "euclid:journeys:v1";
const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");

export interface JourneyBinding {
  version: 1;
  activity: JourneyActivityRef;
  journeyId: string | null;
  status: "pending" | "active" | "ended" | "unknown" | "denied";
  startReceiptStatus: JourneyReceiptStatus;
  expiresAt: number;
  milestones: string[];
  interactions: string[];
  progress: number;
}

export interface JourneyOwner {
  actor: string;
  postId: string;
}

export function journeyBindingKey(owner: JourneyOwner, segmentId: string) {
  return `${PREFIX}:segment:${hash(JSON.stringify([owner.actor, owner.postId, segmentId]))}`;
}

function readBinding(
  raw: string | undefined,
  now: number,
): JourneyBinding | null {
  if (!raw) return null;
  const value: unknown = JSON.parse(raw);
  if (
    !value ||
    typeof value !== "object" ||
    !("version" in value) ||
    value.version !== 1 ||
    !("expiresAt" in value) ||
    typeof value.expiresAt !== "number" ||
    !Number.isSafeInteger(value.expiresAt)
  ) {
    throw new Error("Invalid Journey binding.");
  }
  if (value.expiresAt <= now) return null;
  const binding = value as JourneyBinding;
  if (
    !parseJourneyActivity(binding.activity) ||
    !["pending", "active", "ended", "unknown", "denied"].includes(
      binding.status,
    ) ||
    !JOURNEY_RECEIPT_STATUSES.has(binding.startReceiptStatus) ||
    (binding.journeyId !== null && typeof binding.journeyId !== "string") ||
    !Array.isArray(binding.milestones) ||
    binding.milestones.length > 8 ||
    binding.milestones.some((v) => !isJourneyMilestone(v)) ||
    !Array.isArray(binding.interactions) ||
    binding.interactions.length > JOURNEYS_INTERACTION_LIMIT ||
    binding.interactions.some(
      (v) => typeof v !== "string" || !/^[a-f0-9]{64}$/.test(v),
    ) ||
    !Number.isFinite(binding.progress) ||
    binding.progress < 0 ||
    binding.progress > 1
  ) {
    throw new Error("Invalid Journey binding.");
  }
  return binding;
}

/** Small expiring attempt ledger; it never retries or promises event delivery. */
export class JourneysStore {
  constructor(
    private readonly redis: RedisCasClient,
    private readonly now = Date.now,
  ) {}

  async admit(owner: JourneyOwner, starts = false): Promise<void> {
    await reserveWindowBudget(
      this.redis,
      `${PREFIX}:budget:${starts ? "start:" : "event:"}${hash(owner.actor)}`,
      starts ? 10 : 120,
      60_000,
      this.now(),
    );
    await reserveWindowBudget(
      this.redis,
      `${PREFIX}:budget:daily-${starts ? "start" : "event"}:${hash(owner.actor)}`,
      starts ? 256 : 4_096,
      JOURNEY_BINDING_TTL_MS,
      this.now(),
    );
  }

  async ready(owner: JourneyOwner, documentId: string): Promise<boolean> {
    const now = this.now();
    const key = `${PREFIX}:ready:${hash(JSON.stringify([owner.actor, owner.postId, documentId]))}`;
    return redisCas(this.redis, key, (raw) =>
      raw
        ? { action: "no-change", result: false }
        : {
            action: "set",
            value: "1",
            expiration: new Date(now + JOURNEY_BINDING_TTL_MS),
            result: true,
          },
    );
  }

  async get(
    owner: JourneyOwner,
    segmentId: string,
  ): Promise<JourneyBinding | null> {
    return readBinding(
      (await this.redis.get(journeyBindingKey(owner, segmentId))) ?? undefined,
      this.now(),
    );
  }

  async reserveStart(
    owner: JourneyOwner,
    segmentId: string,
    activity: JourneyActivityRef,
  ): Promise<{ fresh: boolean; binding: JourneyBinding }> {
    const now = this.now();
    return redisCas<{ fresh: boolean; binding: JourneyBinding }>(
      this.redis,
      journeyBindingKey(owner, segmentId),
      (raw) => {
        const existing = readBinding(raw, now);
        if (existing) {
          return {
            action: "no-change",
            result: { fresh: false, binding: existing },
          };
        }
        const binding: JourneyBinding = {
          version: 1,
          activity,
          journeyId: null,
          status: "pending",
          startReceiptStatus: "JOURNEY_RECEIPT_UNSPECIFIED",
          expiresAt: now + JOURNEY_BINDING_TTL_MS,
          milestones: [],
          interactions: [],
          progress: 0,
        };
        return {
          action: "set",
          value: JSON.stringify(binding),
          expiration: new Date(binding.expiresAt),
          result: { fresh: true, binding },
        };
      },
    );
  }

  async finishStart(
    owner: JourneyOwner,
    segmentId: string,
    journeyId: string | null,
    receiptStatus: JourneyReceiptStatus = "JOURNEY_RECEIPT_UNSPECIFIED",
  ) {
    const now = this.now();
    await redisCas(this.redis, journeyBindingKey(owner, segmentId), (raw) => {
      const binding = readBinding(raw, now);
      if (!binding || binding.status !== "pending") {
        throw new Error("Journey start reservation expired.");
      }
      binding.journeyId = journeyId;
      binding.startReceiptStatus = receiptStatus;
      binding.status =
        journeyId && receiptStatus === "JOURNEY_RECEIPT_VALID"
          ? "active"
          : receiptStatus === "JOURNEY_RECEIPT_UNSPECIFIED"
            ? "unknown"
            : "denied";
      return {
        action: "set",
        value: JSON.stringify(binding),
        expiration: new Date(binding.expiresAt),
        result: undefined,
      };
    });
  }

  async claim(
    owner: JourneyOwner,
    segmentId: string,
    journeyId: string,
    activity: JourneyActivityRef,
    event:
      | { kind: "progress"; milestone: string; progress: number }
      | { kind: "interaction"; fingerprint: string }
      | { kind: "end" },
  ): Promise<boolean> {
    const now = this.now();
    return redisCas(this.redis, journeyBindingKey(owner, segmentId), (raw) => {
      const binding = readBinding(raw, now);
      if (
        !binding ||
        binding.journeyId !== journeyId ||
        binding.status !== "active"
      ) {
        return { action: "no-change", result: false };
      }
      if (
        journeyActivityKey(binding.activity) !== journeyActivityKey(activity) &&
        !(binding.activity.kind === "h2h-queue" && activity.kind === "h2h")
      ) {
        return { action: "no-change", result: false };
      }
      if (event.kind === "progress") {
        if (
          binding.milestones.includes(event.milestone) ||
          event.progress <= binding.progress
        ) {
          return { action: "no-change", result: false };
        }
        binding.milestones.push(event.milestone);
        binding.progress = Math.max(binding.progress, event.progress);
      } else if (event.kind === "interaction") {
        const fingerprint = hash(event.fingerprint);
        if (
          binding.interactions.length >= JOURNEYS_INTERACTION_LIMIT ||
          binding.interactions.includes(fingerprint)
        ) {
          return { action: "no-change", result: false };
        }
        binding.interactions.push(fingerprint);
      } else {
        binding.status = "ended";
      }
      binding.activity = activity;
      return {
        action: "set",
        value: JSON.stringify(binding),
        expiration: new Date(binding.expiresAt),
        result: true,
      };
    });
  }
}
