import express, { type Response } from "express";
import { ChallengeError } from "../shared/challenge";
import {
  CHALLENGE_PERIODS,
  type ChallengePeriod,
} from "../shared/challenge-spotlights";
import {
  CompetitionGameplay,
  type CompetitionIdentity,
} from "./competition-gameplay";
import type { CompetitionRedisClient } from "./competition-redis";
import {
  CompetitionApplyPendingError,
  CompetitionService,
} from "./competition-service";
import { requireModerator, type ModeratorLookup } from "./moderator";
import { RedisCasConflictExhaustedError } from "./redis-cas";
import { RequestLimitError } from "./request-limits";

/** Mount at /api/competitions. Identity must come from trusted Devvit context. */
export function competitionRouter(
  service: CompetitionService,
  identity: () => Promise<CompetitionIdentity | null>,
  moderator: ModeratorLookup,
) {
  const router = express.Router();
  const game = new CompetitionGameplay(
    service.redis as CompetitionRedisClient,
    { now: service.now, newId: service.newId },
  );
  const report = async (res: Response, error: unknown) => {
    if (error instanceof CompetitionApplyPendingError) {
      res.status(409).json({ code: "pending", message: error.message });
    } else if (error instanceof ChallengeError) {
      const status = {
        invalid: 400,
        unavailable: 422,
        search_limit: 422,
        stale: 409,
        expired: 410,
        forbidden: 403,
      }[error.code];
      res.status(status).json({
        code: error.code,
        message: error.message,
        ...(error.code === "stale" && res.locals.moderatorId
          ? { templates: await service.templates() }
          : {}),
      });
    } else if (error instanceof RequestLimitError) {
      res.setHeader("Retry-After", Math.ceil(error.retryAfterMs / 1000));
      res.status(429).json({ message: error.message });
    } else if (error instanceof RedisCasConflictExhaustedError) {
      res.status(409).json({
        code: "stale",
        message: "The challenge changed concurrently. Refresh and try again.",
      });
    } else {
      console.error("Competition request failed", error);
      res
        .status(503)
        .json({ message: "Challenges could not be loaded. Please try again." });
    }
  };
  router.get(
    "/templates",
    requireModerator(moderator, "Challenge settings are for moderators."),
    async (_req, res) => {
      try {
        await service.reconcile();
        res.json(await service.templates());
      } catch (error) {
        await report(res, error);
      }
    },
  );
  router.get("/availability", async (_req, res) => {
    try {
      await service.reconcile();
      res.json(await game.availability());
    } catch (error) {
      await report(res, error);
    }
  });
  router.param("period", (_req, res, next, value: string) => {
    if (!CHALLENGE_PERIODS.includes(value as ChallengePeriod))
      return void res
        .status(404)
        .json({ message: "Choose a daily or weekly challenge." });
    res.locals.period = value;
    next();
  });
  router.post(
    "/:period/apply",
    requireModerator(moderator, "Challenge settings are for moderators."),
    async (req, res) => {
      try {
        res.json(
          await service.apply(
            res.locals.period as ChallengePeriod,
            res.locals.moderatorId as string,
            req.body,
          ),
        );
      } catch (error) {
        await report(res, error);
      }
    },
  );
  router.get("/:period/state", async (_req, res) => {
    try {
      await service.reconcile();
      res.json(
        await game.state(
          res.locals.period as ChallengePeriod,
          await identity(),
        ),
      );
    } catch (error) {
      await report(res, error);
    }
  });
  router.get("/:period/standings", async (req, res) => {
    try {
      await service.reconcile();
      res.json(
        await game.standings(
          res.locals.period as ChallengePeriod,
          Number(req.query.offset ?? 0),
        ),
      );
    } catch (error) {
      await report(res, error);
    }
  });
  for (const action of ["start", "move", "retry"] as const)
    router.post(`/:period/${action}`, async (req, res) => {
      try {
        const user = await identity();
        if (!user)
          throw new ChallengeError(
            "forbidden",
            "Sign in to play subreddit challenges.",
          );
        await service.reconcile();
        res.json(
          await game.mutate(
            res.locals.period as ChallengePeriod,
            user,
            action,
            req.body,
          ),
        );
      } catch (error) {
        await report(res, error);
      }
    });
  return router;
}
