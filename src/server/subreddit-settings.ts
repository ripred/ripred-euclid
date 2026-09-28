import express from "express";
import {
  DEFAULT_SUBREDDIT_SETTINGS,
  validateSubredditSettings,
  type SubredditSettings,
} from "../shared/subreddit-settings";
import { requireModerator, type ModeratorLookup } from "./moderator";
import { redisCas, type RedisCasClient } from "./redis-cas";
import { parseJson } from "./stored-json";

export const SUBREDDIT_SETTINGS_KEY = "euclid:subreddit-settings:v1";

/** The saved settings; nothing saved, or anything unreadable, reads as off. */
export async function readSubredditSettings(
  redis: RedisCasClient,
): Promise<SubredditSettings> {
  return (
    validateSubredditSettings(
      parseJson(await redis.get(SUBREDDIT_SETTINGS_KEY)),
    ) ?? { ...DEFAULT_SUBREDDIT_SETTINGS }
  );
}

/**
 * Anyone may read the subreddit's settings; only a moderator may change them.
 * A change replaces every switch at once, so partial or unknown fields are
 * refused rather than guessed at.
 */
export function subredditSettingsRouter(
  redis: RedisCasClient,
  lookup: ModeratorLookup,
  save?: (settings: SubredditSettings) => Promise<void>,
) {
  const router = express.Router();
  router.get("/", async (_req, res) => {
    try {
      res.json({ settings: await readSubredditSettings(redis) });
    } catch {
      res.status(503).json({ message: "Settings could not be loaded." });
    }
  });
  router.put(
    "/",
    requireModerator(lookup, "Subreddit settings are for moderators."),
    async (req, res) => {
      const settings = validateSubredditSettings(
        (req.body as { settings?: unknown } | undefined)?.settings,
      );
      if (!settings)
        return void res
          .status(400)
          .json({ message: "Send valid subreddit settings." });
      try {
        const value = JSON.stringify(settings);
        if (save) await save(settings);
        else
          await redisCas(redis, SUBREDDIT_SETTINGS_KEY, () => ({
            action: "set",
            value,
            result: undefined,
          }));
        res.json({ settings });
      } catch {
        res.status(503).json({ message: "Settings could not be saved." });
      }
    },
  );
  return router;
}
