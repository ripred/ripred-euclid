import { context, reddit, redis } from "@devvit/web/server";
import { isRecord } from "../shared/guards";
import { RESULT_HUB_TITLES } from "../shared/result-sharing";
import type { SharedPostPayload } from "../shared/types/api";
import { prepareGamePost } from "./core/post";
import { COMMUNITY_POSTS_KEY } from "./community-post-keys";
import { ensurePostHighlighted } from "./post-highlights";
import { communityPostStyles } from "./post-presentation";
import { isDefinitiveRedditRejection } from "./reddit-write-errors";

type HubKind = keyof typeof RESULT_HUB_TITLES;
type Post = Awaited<ReturnType<typeof reddit.getPostById>>;
type CommunityPosts = {
  game: string;
  gamePermalink: string;
  ai: string;
  h2h: string;
};

const isPostId = (value: unknown): value is `t3_${string}` =>
  typeof value === "string" && /^t3_[a-z0-9]+$/.test(value);

function isCommunityPermalink(value: unknown, postId: string): value is string {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value, "https://www.reddit.com");
    const [, r, subreddit, comments, id] = url.pathname.split("/");
    return (
      url.protocol === "https:" &&
      ["www.reddit.com", "reddit.com"].includes(url.hostname) &&
      !url.username &&
      !url.password &&
      !url.port &&
      r === "r" &&
      subreddit?.toLowerCase() === context.subredditName?.toLowerCase() &&
      comments === "comments" &&
      id === postId.slice(3)
    );
  } catch {
    return false;
  }
}

function readCommunityPosts(
  raw: string | null | undefined,
): CommunityPosts | null {
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (
      isRecord(value) &&
      isPostId(value.game) &&
      isPostId(value.ai) &&
      isPostId(value.h2h) &&
      new Set([value.game, value.ai, value.h2h]).size === 3 &&
      isCommunityPermalink(value.gamePermalink, value.game)
    )
      return {
        game: value.game,
        gamePermalink: value.gamePermalink,
        ai: value.ai,
        h2h: value.h2h,
      };
  } catch {
    // An incomplete or corrupt configuration is not ready for result writes.
  }
  return null;
}

export async function resultHub(payload: SharedPostPayload) {
  const posts = readCommunityPosts(await redis.get(COMMUNITY_POSTS_KEY));
  if (!posts)
    throw new Error(
      "The community result posts are being prepared. Please try again shortly.",
    );
  const kind: HubKind =
    payload.kind === "result"
      ? payload.mode === "h2h"
        ? "h2h"
        : "ai"
      : payload.bucket === "hvh"
        ? "h2h"
        : "ai";
  return { postId: posts[kind], gamePermalink: posts.gamePermalink };
}

/** Reconcile on app upgrade, adopting existing posts before creating anything. */
export async function setupCommunityPosts() {
  const subredditName = context.subredditName;
  if (!subredditName) throw new Error("subredditName is required");
  const recent = await reddit.getNewPosts({ subredditName, limit: 100 }).all();
  const owned = recent.filter(
    (post) => post.authorName.toLowerCase() === context.appSlug.toLowerCase(),
  );
  const validatePost = async (
    post: Post,
    title: string,
    expectedId?: string,
  ) => {
    if (
      !isPostId(post.id) ||
      (expectedId !== undefined && post.id !== expectedId) ||
      post.authorName.toLowerCase() !== context.appSlug.toLowerCase() ||
      post.subredditName.toLowerCase() !== subredditName.toLowerCase() ||
      post.title !== title ||
      post.removed ||
      post.archived ||
      post.removedByCategory === "deleted" ||
      !isCommunityPermalink(post.permalink, post.id)
    ) {
      await redis.del(COMMUNITY_POSTS_KEY);
      throw new Error(`Invalid or unavailable community post: ${title}`);
    }
    return post;
  };
  const readPost = async (
    kind: string,
    title: string,
    prepare: () => Promise<() => Promise<Post>>,
  ) => {
    const key = `${COMMUNITY_POSTS_KEY}:${kind}`;
    const saved = await redis.get(key);
    if (saved) {
      if (!isPostId(saved)) {
        await redis.del(COMMUNITY_POSTS_KEY);
        throw new Error("Invalid community post ID");
      }
      return validatePost(await reddit.getPostById(saved), title, saved);
    }
    let post = owned.filter((post) => post.title === title).at(-1);
    if (!post) {
      // Icon lookup/upload is a preflight: its failure must not reserve a post
      // that was never submitted to Reddit.
      const create = await prepare();
      // A durable claim prevents an uncertain remote submission from creating
      // duplicate hubs. A subsequent upgrade first adopts any created post.
      const claimed = await redis.set(`${key}:creating`, "pending", {
        nx: true,
      });
      if (claimed !== "OK")
        throw new Error(
          `Creation of ${title} is already pending; inspect the community before retrying.`,
        );
      try {
        post = await create();
      } catch (error) {
        if (isDefinitiveRedditRejection(error, "post"))
          await redis.del(`${key}:creating`);
        throw error;
      }
    }
    await validatePost(post, title);
    await redis.set(key, post.id);
    return post;
  };
  const game = await readPost("game", "Euclid", prepareGamePost);
  const hubs = {} as Record<HubKind, Post>;
  for (const kind of ["ai", "h2h"] as const) {
    const title = RESULT_HUB_TITLES[kind];
    const hub = await readPost(
      kind,
      title,
      async () => () =>
        reddit.submitPost({
          subredditName,
          title,
          text: `Game results shared from Euclid appear below, newest first.\n\n[Play Euclid](${game.permalink}) and choose **Share result** after your game to add your result here.\n\nThis thread accepts results from the game. Regular comments are closed.`,
          runAs: "APP",
          sendreplies: false,
        }),
    );
    await hub.lock();
    await hub.setSuggestedCommentSort("NEW");
    hubs[kind] = hub;
  }
  // Add missing highlights in this order without rearranging existing pins.
  // Reddit's installed API exposes no position or ordering readback.
  const highlightedPosts = [game, hubs.ai, hubs.h2h];
  for (const post of highlightedPosts) {
    if (!(await ensurePostHighlighted(post.id))) {
      console.warn(
        "[COMMUNITY] Reddit's highlight API is unavailable. A moderator must manually add these three posts to community highlights; result sharing and image setup will continue.",
        highlightedPosts.map(({ title, id, permalink }) => ({
          title,
          id,
          permalink,
        })),
      );
      break;
    }
  }
  const posts: CommunityPosts = {
    game: game.id,
    gamePermalink: game.permalink,
    ai: hubs.ai.id,
    h2h: hubs.h2h.id,
  };
  await redis.set(COMMUNITY_POSTS_KEY, JSON.stringify(posts));
  console.log("[COMMUNITY] Results posts ready", posts);

  // Update only this app's custom game/result posts; hub text posts have no
  // Devvit styles. Read back the stored URL without assuming feed rendering.
  const styles = await communityPostStyles(true);
  if (!styles.shareImageUrl) return posts;
  const stylePosts = new Map([game, ...owned].map((post) => [post.id, post]));
  for (const post of stylePosts.values()) {
    if (post.id === hubs.ai.id || post.id === hubs.h2h.id) continue;
    if (post.title !== "Euclid" && !(await reddit.getPostData(post.id)))
      continue;
    await reddit.setPostStyles(post.id, styles);
    const storedStyles = await reddit.getPostStyles(post.id);
    if (storedStyles?.shareImageUrl !== styles.shareImageUrl)
      throw new Error(`The community image was not saved on ${post.id}`);
    console.log("[COMMUNITY] Post image saved", post.id, storedStyles);
  }
  return posts;
}
