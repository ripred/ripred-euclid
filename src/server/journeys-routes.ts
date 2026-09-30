import express, { type ErrorRequestHandler, type Response } from "express";
import {
  createTelemetryRouter,
  telemetry,
} from "@devvit/analytics/server/reddit";
import type {
  JourneyReceiptStatus,
  TelemetryJourneyStartResponse,
} from "@devvit/analytics/shared/reddit";
import { hasOnlyKeys, isCanonicalIdentifier, isRecord } from "../shared/guards";
import {
  JOURNEYS_ACTIVITY_HEADER,
  JOURNEY_MILESTONES,
  isJourneyInteraction,
  isJourneyMilestone,
  journeyActivityKey,
  parseJourneyRequestContext,
  type JourneyActivityRef,
  type JourneyRequestContext,
} from "../shared/journeys";
import type { JourneyCanonicalActivity } from "./journeys-canonical";
import {
  JOURNEY_RECEIPT_STATUSES,
  JourneysStore,
  type JourneyOwner,
} from "./journeys-store";
import type { RedisCasClient } from "./redis-cas";
import { parseJson } from "./stored-json";
import { RequestLimitError } from "./request-limits";

const STATUS = {
  invalid: "JOURNEY_RECEIPT_INVALID",
  unknown: "JOURNEY_RECEIPT_UNSPECIFIED",
  limited: "JOURNEY_RECEIPT_DENIED_RATE_LIMITED",
} as const;
const EVENTS = [
  "start",
  "progress",
  "interaction",
  "end",
  "app-ready",
] as const;
type EventName = (typeof EVENTS)[number];

export interface JourneysRouterOptions {
  redis: RedisCasClient;
  identity: () => {
    userId?: string | undefined;
    loid?: string | undefined;
    postId?: string | undefined;
  };
  readCanonical: (
    userId: string,
    request: JourneyRequestContext,
  ) => Promise<JourneyCanonicalActivity | null>;
  now?: () => number;
  startJourney?: () => Promise<TelemetryJourneyStartResponse>;
  sdkRouter?: express.Router;
  log?: (event: {
    event: EventName;
    status: JourneyReceiptStatus;
    mode?: JourneyCanonicalActivity["mode"];
  }) => void;
}

function reply(
  res: Response,
  status: JourneyReceiptStatus,
  message: string,
  httpStatus = 200,
) {
  return res.status(httpStatus).json({ receipt: { status, message } });
}
function suppressed(res: Response) {
  return reply(
    res,
    STATUS.unknown,
    "Already attempted locally; delivery was not reconfirmed.",
  );
}
function invalid(res: Response, httpStatus = 400) {
  return reply(res, STATUS.invalid, "Telemetry request rejected.", httpStatus);
}
const sameActivity = (a: JourneyActivityRef, b: JourneyActivityRef) =>
  journeyActivityKey(a) === journeyActivityKey(b);
const canPromote = (a: JourneyActivityRef, b: JourneyActivityRef) =>
  a.kind === "h2h-queue" && b.kind === "h2h";

function actionDetails(
  state: JourneyCanonicalActivity,
  detail?: unknown,
): string {
  return JSON.stringify({
    mode: state.mode,
    ...(state.variant ? { variant: state.variant } : {}),
    ...(state.difficulty ? { difficulty: state.difficulty } : {}),
    ...(typeof detail === "string" ? { detail } : {}),
  });
}

function validEnd(
  state: JourneyCanonicalActivity,
  context: JourneyRequestContext,
): boolean {
  switch (context.endReason) {
    case "completed":
      return state.status === "completed";
    case "abandoned":
      return state.status === "abandoned";
    case "canceled":
      return state.activity.kind === "h2h-queue" && state.status === "canceled";
    case "retry":
      return (
        state.status === "completed" ||
        state.status === "replaced" ||
        state.status === "abandoned"
      );
    case "unavailable":
      return state.status === "expired" || state.status === "replaced";
    default:
      return false;
  }
}

/** Mount before broad application parsers at /api/telemetry. */
export function journeysRouter(options: JourneysRouterOptions): express.Router {
  const router = express.Router();
  const store = new JourneysStore(options.redis, options.now);
  const startJourney = options.startJourney ?? (() => telemetry.startJourney());
  const log = options.log ?? ((value) => console.info("[Journeys]", value));
  router.use(express.json({ limit: "2kb", strict: true }));
  router.use(async (req, res, next) => {
    const event = req.path.startsWith("/journey/")
      ? (req.path.slice("/journey/".length) as EventName)
      : undefined;
    if (req.method !== "POST" || !event || !EVENTS.includes(event))
      return void res.sendStatus(404);
    const originalJson = res.json.bind(res);
    res.json = (body: unknown) => {
      if (
        isRecord(body) &&
        isRecord(body.receipt) &&
        JOURNEY_RECEIPT_STATUSES.has(
          body.receipt.status as JourneyReceiptStatus,
        )
      ) {
        // No identifiers, payloads, SDK messages or user input enter diagnostics.
        log({
          event,
          status: body.receipt.status as JourneyReceiptStatus,
          ...(res.locals.journeyMode
            ? {
                mode: res.locals
                  .journeyMode as JourneyCanonicalActivity["mode"],
              }
            : {}),
        });
      }
      return originalJson(body);
    };
    try {
      const header = req.get(JOURNEYS_ACTIVITY_HEADER);
      if (!header || header.length > 2_048) return void invalid(res);
      const request = parseJourneyRequestContext(parseJson(header));
      if (!request) return void invalid(res);
      const identity = options.identity();
      if (!identity.postId) return void invalid(res, 403);
      const owner: JourneyOwner = {
        actor: identity.userId
          ? `user:${identity.userId}`
          : identity.loid
            ? `logged-out:${identity.loid}`
            : "logged-out",
        postId: identity.postId,
      };
      await store.admit(owner);
      const body: unknown = req.body;
      if (event === "app-ready") {
        if (
          request.activity ||
          request.endReason ||
          request.commandId ||
          request.expectedRevision !== undefined ||
          (body !== undefined && (!isRecord(body) || !hasOnlyKeys(body, [])))
        )
          return void invalid(res);
        if (!(await store.ready(owner, request.documentId)))
          return void suppressed(res);
        return next();
      }
      if (!identity.userId || !request.activity || !request.segmentId)
        return void invalid(res, 403);
      if (
        event !== "end" &&
        (request.endReason ||
          request.commandId ||
          request.expectedRevision !== undefined)
      )
        return void invalid(res);
      if (event === "start") {
        if (body !== undefined && (!isRecord(body) || !hasOnlyKeys(body, [])))
          return void invalid(res);
        await store.admit(owner, true);
        const canonical = await options.readCanonical(identity.userId, request);
        if (!canonical || !["active", "queued"].includes(canonical.status))
          return void invalid(res, 409);
        res.locals.journeyMode = canonical.mode;
        const reservation = await store.reserveStart(
          owner,
          request.segmentId,
          canonical.activity,
        );
        if (!reservation.fresh) {
          if (
            !sameActivity(reservation.binding.activity, canonical.activity) &&
            !canPromote(reservation.binding.activity, canonical.activity)
          )
            return void invalid(res, 409);
          return void res.json({
            journeyId:
              reservation.binding.status === "active"
                ? (reservation.binding.journeyId ?? "")
                : "",
            receipt: {
              status:
                reservation.binding.status === "denied"
                  ? reservation.binding.startReceiptStatus
                  : STATUS.unknown,
              message:
                "An existing start attempt was reused; no new event was sent.",
            },
          });
        }
        let result: TelemetryJourneyStartResponse;
        try {
          result = await startJourney();
        } catch {
          await store.finishStart(owner, request.segmentId, null);
          return void reply(
            res,
            STATUS.unknown,
            "Telemetry delivery could not be confirmed.",
            503,
          );
        }
        const journeyId = isCanonicalIdentifier(result.journeyId)
          ? result.journeyId
          : null;
        await store.finishStart(
          owner,
          request.segmentId,
          journeyId,
          result.receipt.status,
        );
        return void res.json({ ...result, journeyId: journeyId ?? "" });
      }
      if (!isRecord(body) || !isCanonicalIdentifier(body.journeyId))
        return void invalid(res);
      const binding = await store.get(owner, request.segmentId);
      if (!binding || binding.journeyId !== body.journeyId)
        return void invalid(res, 403);
      if (binding.status === "denied")
        return void reply(
          res,
          binding.startReceiptStatus,
          "The Journey start was denied; no further event was sent.",
        );
      if (binding.status !== "active") return void suppressed(res);
      if (
        !sameActivity(binding.activity, request.activity) &&
        !canPromote(binding.activity, request.activity) &&
        !(
          binding.activity.kind === "h2h" &&
          request.activity.kind === "h2h-queue"
        )
      )
        return void invalid(res, 403);
      if (canPromote(binding.activity, request.activity)) {
        // Only the queue's current pairing may inherit its Journey. An owned
        // historical result is not evidence that this queue found that match.
        const presence = await options.readCanonical(identity.userId, {
          documentId: request.documentId,
          segmentId: request.segmentId,
          activity: { kind: "h2h-queue" },
        });
        if (!presence || !sameActivity(presence.activity, request.activity))
          return void invalid(res, 409);
      }
      const canonical = await options.readCanonical(identity.userId, request);
      if (
        !canonical ||
        (!sameActivity(binding.activity, canonical.activity) &&
          !canPromote(binding.activity, canonical.activity))
      )
        return void invalid(res, 409);
      res.locals.journeyMode = canonical.mode;
      let claimed: boolean;
      if (event === "progress") {
        if (
          !hasOnlyKeys(body, [
            "journeyId",
            "progress",
            "action",
            "actionDetails",
          ]) ||
          !isJourneyMilestone(body.action) ||
          typeof body.progress !== "number" ||
          body.progress !== JOURNEY_MILESTONES[body.action] ||
          body.actionDetails !== undefined ||
          (body.action === "completed"
            ? canonical.status !== "completed"
            : canonical.progress < body.progress)
        )
          return void invalid(res);
        claimed = await store.claim(
          owner,
          request.segmentId,
          body.journeyId,
          canonical.activity,
          { kind: "progress", milestone: body.action, progress: body.progress },
        );
        req.body = {
          journeyId: body.journeyId,
          progress: Math.max(binding.progress, body.progress),
          action: body.action,
          actionDetails: actionDetails(canonical),
        };
      } else if (event === "interaction") {
        if (
          !hasOnlyKeys(body, ["journeyId", "action", "actionDetails"]) ||
          !isJourneyInteraction(body.action, body.actionDetails)
        )
          return void invalid(res);
        if (
          (body.action === "first_move" && !canonical.hasMove) ||
          (body.action === "first_square" && !canonical.hasSquare) ||
          (body.action === "match_found" && canonical.activity.kind !== "h2h")
        )
          return void invalid(res);
        claimed = await store.claim(
          owner,
          request.segmentId,
          body.journeyId,
          canonical.activity,
          {
            kind: "interaction",
            fingerprint: JSON.stringify([body.action, body.actionDetails]),
          },
        );
        req.body = {
          journeyId: body.journeyId,
          action: body.action,
          actionDetails: actionDetails(canonical, body.actionDetails),
        };
      } else {
        if (
          !hasOnlyKeys(body, ["journeyId", "complete", "game"]) ||
          (body.complete !== undefined && typeof body.complete !== "boolean") ||
          (body.game !== undefined &&
            (!isRecord(body.game) ||
              !hasOnlyKeys(body.game, ["win", "score"]))) ||
          !validEnd(canonical, request)
        )
          return void invalid(res);
        // Canceling a queue must never end a game that paired concurrently.
        if (
          request.endReason === "canceled" &&
          binding.activity.kind !== "h2h-queue"
        )
          return void invalid(res, 409);
        claimed = await store.claim(
          owner,
          request.segmentId,
          body.journeyId,
          canonical.activity,
          { kind: "end" },
        );
        req.body = {
          journeyId: body.journeyId,
          complete: canonical.status === "completed",
          ...(canonical.game ? { game: canonical.game } : {}),
        };
      }
      if (!claimed) return void suppressed(res);
      next();
    } catch (error) {
      if (error instanceof RequestLimitError) {
        res.setHeader(
          "Retry-After",
          Math.max(1, Math.ceil(error.retryAfterMs / 1_000)),
        );
        return void reply(
          res,
          STATUS.limited,
          "Telemetry request limit reached.",
          429,
        );
      }
      // Telemetry remains separate from gameplay, including unavailable canonical state.
      reply(
        res,
        STATUS.unknown,
        "Telemetry delivery could not be confirmed.",
        503,
      );
    }
  });
  router.use(options.sdkRouter ?? createTelemetryRouter({ basePath: "" }));
  const parserError: ErrorRequestHandler = (
    error: unknown,
    _req,
    res,
    _next,
  ) => {
    invalid(res, isRecord(error) && error.status === 413 ? 413 : 400);
  };
  router.use(parserError);
  return router;
}
