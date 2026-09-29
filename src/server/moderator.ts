import type { RequestHandler } from "express";

/** Resolves the requester's user ID when they moderate this subreddit. */
export type ModeratorLookup = () => Promise<string | null>;

/**
 * Admits only current subreddit moderators, checked on the server for every
 * request, and records who they are in `res.locals.moderatorId`.
 */
export function requireModerator(
  lookup: ModeratorLookup,
  denied: string,
): RequestHandler {
  return async (_req, res, next) => {
    try {
      const moderatorId = await lookup();
      if (!moderatorId) return void res.status(403).json({ message: denied });
      res.locals.moderatorId = moderatorId;
      next();
    } catch {
      res.status(503).json({
        message: "Moderator access could not be checked. Please try again.",
      });
    }
  };
}
