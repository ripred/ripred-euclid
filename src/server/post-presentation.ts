import { context, media, reddit, redis } from "@devvit/web/server";
import { isRecord } from "../shared/guards";

const ICON_KEY = "euclid:community-post-icon:v1";
type StoredIcon = { source: string; shareImageUrl: string };

function imageUrl(
  value: unknown,
  hosts: readonly string[],
): string | undefined {
  if (typeof value !== "string") return undefined;
  try {
    const url = new URL(value.replaceAll("&amp;", "&"));
    if (
      url.protocol === "https:" &&
      hosts.includes(url.hostname) &&
      !url.username &&
      !url.password &&
      !url.port &&
      url.pathname !== "/"
    )
      return url.href;
  } catch {
    // Malformed cache entries are refreshed; malformed API URLs are rejected.
  }
  return undefined;
}

const sourceUrl = (value: unknown) =>
  imageUrl(value, [
    "styles.redditmedia.com",
    "i.redd.it",
    "www.redditstatic.com",
  ]);
const hostedUrl = (value: unknown) => imageUrl(value, ["i.redd.it"]);

function readStoredIcon(
  raw: string | null | undefined,
): StoredIcon | undefined {
  if (!raw) return undefined;
  try {
    const value: unknown = JSON.parse(raw);
    if (!isRecord(value)) return undefined;
    const source = sourceUrl(value.source);
    const shareImageUrl = hostedUrl(value.shareImageUrl);
    if (source && shareImageUrl) return { source, shareImageUrl };
  } catch {
    // Invalid cached data must not prevent refreshing the community icon.
  }
  return undefined;
}

/** Upload once per community icon, then reuse Reddit's hosted image for posts. */
export async function communityPostStyles(refresh = false) {
  const raw = await redis.get(ICON_KEY);
  const stored = readStoredIcon(raw);
  if (stored && !refresh) return { shareImageUrl: stored.shareImageUrl };
  const subreddit = await reddit.getSubredditStyles(context.subredditId);
  if (!subreddit.icon) {
    if (raw) await redis.del(ICON_KEY);
    return {};
  }
  const source = sourceUrl(subreddit.icon);
  if (!source)
    throw new Error("The community icon must use a Reddit image URL.");
  if (stored && stored.source === source)
    return { shareImageUrl: stored.shareImageUrl };
  const { mediaUrl } = await media.upload({ url: source, type: "image" });
  const shareImageUrl = hostedUrl(mediaUrl);
  if (!shareImageUrl)
    throw new Error(
      "The uploaded community icon has no valid Reddit image URL.",
    );
  const icon: StoredIcon = { source, shareImageUrl };
  await redis.set(ICON_KEY, JSON.stringify(icon));
  return { shareImageUrl };
}
