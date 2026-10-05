import { context, media, reddit, redis } from "@devvit/web/server";
import { isRecord } from "../shared/guards";
import { parseJson } from "./stored-json";
import type { gamePostContent } from "./community-post-content";

const ICON_KEY = "euclid:community-post-icon:v1";
const BANNER_KEY = "euclid:community-post-banner:v1";
const COMMUNITY_IMAGES = {
  icon: { key: ICON_KEY, field: "icon" },
  banner: { key: BANNER_KEY, field: "bannerBackgroundImage" },
} as const;
type StoredImage = { source: string; shareImageUrl: string };

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

function readStoredImage(
  raw: string | null | undefined,
): StoredImage | undefined {
  // Invalid cached data must not prevent refreshing the community image.
  const value = parseJson(raw);
  if (!isRecord(value)) return undefined;
  const source = sourceUrl(value.source);
  const shareImageUrl = hostedUrl(value.shareImageUrl);
  return source && shareImageUrl ? { source, shareImageUrl } : undefined;
}

async function communityImage(
  kind: keyof typeof COMMUNITY_IMAGES,
  refresh: boolean,
): Promise<string | undefined> {
  const { key, field } = COMMUNITY_IMAGES[kind];
  const raw = await redis.get(key);
  const stored = readStoredImage(raw);
  if (stored && !refresh) return stored.shareImageUrl;
  const subreddit = await reddit.getSubredditStyles(context.subredditId);
  if (!subreddit[field]) {
    if (raw) await redis.del(key);
    return undefined;
  }
  const source = sourceUrl(subreddit[field]);
  if (!source)
    throw new Error(`The community ${kind} must use a Reddit image URL.`);
  if (stored && stored.source === source) return stored.shareImageUrl;
  const { mediaUrl } = await media.upload({ url: source, type: "image" });
  const shareImageUrl = hostedUrl(mediaUrl);
  if (!shareImageUrl)
    throw new Error(
      `The uploaded community ${kind} has no valid Reddit image URL.`,
    );
  const image: StoredImage = { source, shareImageUrl };
  await redis.set(key, JSON.stringify(image));
  return shareImageUrl;
}

/** Upload once per community icon, then reuse Reddit's hosted image for posts. */
export async function communityPostStyles(refresh = false) {
  const shareImageUrl = await communityImage("icon", refresh);
  return shareImageUrl ? { shareImageUrl } : {};
}

/** Result hubs use the community banner without falling back to the icon. */
export async function communityBannerImage(
  refresh = false,
): Promise<string | undefined> {
  return communityImage("banner", refresh);
}

/** Reconcile only on setup; the SDK preserves custom post data when updating
 * its fallback. Reddit may append an unsupported-content notice to that body. */
export async function updateGamePostContent(
  post: Pick<
    Awaited<ReturnType<typeof reddit.getPostById>>,
    "id" | "body" | "edit" | "setTextFallback"
  >,
  content: ReturnType<typeof gamePostContent>,
) {
  const matches = () =>
    post.body === content.text ||
    post.body?.startsWith(
      `${content.text}\n\n* * *\nThis post contains content not supported on old Reddit. `,
    );
  if (matches()) return;
  await post.setTextFallback(content);
  // Some runtimes silently discard fallback text. The body setter provides a
  // bounded compatibility path only after the first write returned successfully.
  if (!matches()) await post.edit(content);
  if (!matches())
    throw new Error(`The community post content was not saved on ${post.id}`);
}
