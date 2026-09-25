import express from "express";
import { ChallengeError } from "../shared/challenge";
import { ChallengeStore } from "./challenge-store";
import { RequestLimitError } from "./request-limits";
import {
  RedisCasConflictExhaustedError,
  type RedisCasClient,
} from "./redis-cas";

/** Every endpoint uses trusted request identity and current subreddit membership. */
export function challengeRouter(
  redis: RedisCasClient,
  authorize: () => Promise<string | null>,
) {
  const router = express.Router();
  const store = new ChallengeStore(redis);
  router.use(async (_req, res, next) => {
    try {
      const ownerId = await authorize();
      if (!ownerId)
        return void res
          .status(403)
          .json({
            message: "The challenge playground is for subreddit moderators.",
          });
      res.locals.challengeOwner = ownerId;
      next();
    } catch {
      res
        .status(503)
        .json({
          message: "Moderator access could not be checked. Please try again.",
        });
    }
  });
  router.get("/state", async (_req, res) => {
    try {
      res.json({
        snapshot: await store.state(res.locals.challengeOwner as string),
      });
    } catch {
      res
        .status(503)
        .json({ message: "The playground state could not be loaded." });
    }
  });
  for (const action of ["generate", "move", "restart", "abandon"] as const) {
    router.post(`/${action}`, async (req, res) => {
      try {
        res.json({
          snapshot: await store.mutate(
            res.locals.challengeOwner as string,
            action,
            req.body,
          ),
        });
      } catch (error) {
        if (error instanceof ChallengeError) {
          const status = {
            invalid: 400,
            unavailable: 422,
            search_limit: 422,
            stale: 409,
            expired: 410,
            forbidden: 403,
          }[error.code];
          res.status(status).json({ code: error.code, message: error.message });
        } else if (error instanceof RequestLimitError) {
          res.setHeader("Retry-After", Math.ceil(error.retryAfterMs / 1000));
          res.status(429).json({ message: error.message });
        } else if (error instanceof RedisCasConflictExhaustedError) {
          res
            .status(409)
            .json({
              message:
                "The playground changed concurrently. Refresh and try again.",
            });
        } else {
          console.error("Challenge request failed", error);
          res
            .status(503)
            .json({
              message:
                "The request could not be completed. Refresh the puzzle before trying again.",
            });
        }
      }
    });
  }
  return router;
}
