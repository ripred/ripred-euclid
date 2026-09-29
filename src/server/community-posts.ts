import { context, reddit, redis } from "@devvit/web/server";
import { isRecord } from "../shared/guards";
import { parseJson } from "./stored-json";
import { RESULT_HUB_TITLES } from "../shared/result-sharing";
import type { ResultSharePayload } from "../shared/types/api";
import { prepareGamePost } from "./core/post";
import { COMMUNITY_POSTS_KEY } from "./community-post-keys";
import { ensurePostHighlighted } from "./post-highlights";
import {
  communityPostStyles,
  updateGamePostContent,
} from "./post-presentation";
import { gamePostContent } from "./community-post-content";
import { isDefinitiveRedditRejection } from "./reddit-write-errors";

type HubKind = keyof typeof RESULT_HUB_TITLES;
type Post = Awaited<ReturnType<typeof reddit.getPostById>>;
type CommunityPosts = {
  game: Post["id"];
  gamePermalink: string;
  ai: Post["id"];
  h2h: Post["id"];
};

const isPostId = (value: unknown): value is `t3_${string}` =>
  typeof value === "string" && /^t3_[a-z0-9]+$/.test(value);

function isImagePost(post: Post) {
  try {
    const url = new URL(post.url);
    return url.protocol === "https:" && url.hostname === "i.redd.it";
  } catch {
    return false;
  }
}

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
  // An incomplete or corrupt configuration is not ready for result writes.
  const value = parseJson(raw);
  return isRecord(value) &&
    isPostId(value.game) &&
    isPostId(value.ai) &&
    isPostId(value.h2h) &&
    new Set([value.game, value.ai, value.h2h]).size === 3 &&
    isCommunityPermalink(value.gamePermalink, value.game)
    ? {
        game: value.game,
        gamePermalink: value.gamePermalink,
        ai: value.ai,
        h2h: value.h2h,
      }
    : null;
}

export async function resultHub(payload: ResultSharePayload) {
  const posts = readCommunityPosts(await redis.get(COMMUNITY_POSTS_KEY));
  if (!posts)
    throw new Error(
      "The community result posts are being prepared. Please try again shortly.",
    );
  const kind: HubKind = payload.mode === "h2h" ? "h2h" : "ai";
  return { postId: posts[kind], gamePermalink: posts.gamePermalink };
}

/** Reconcile on app upgrade, adopting existing posts before creating anything. */
export async function setupCommunityPosts() {
  const subredditName = context.subredditName;
  if (!subredditName) throw new Error("subredditName is required");
  const previous = readCommunityPosts(await redis.get(COMMUNITY_POSTS_KEY));
  const recent = await reddit.getNewPosts({ subredditName, limit: 100 }).all();
  const owned = recent.filter(
    (post) => post.authorName.toLowerCase() === context.appSlug.toLowerCase(),
  );
  const hasPostIdentity = (post: Post, title: string, expectedId?: string) =>
    isPostId(post.id) &&
    (expectedId === undefined || post.id === expectedId) &&
    post.authorName.toLowerCase() === context.appSlug.toLowerCase() &&
    post.subredditName.toLowerCase() === subredditName.toLowerCase() &&
    post.title === title &&
    isCommunityPermalink(post.permalink, post.id);
  const validatePost = async (
    post: Post,
    title: string,
    expectedId?: string,
    invalidateRouting = true,
  ) => {
    if (
      !hasPostIdentity(post, title, expectedId) ||
      post.removed ||
      post.archived ||
      post.removedByCategory === "deleted"
    ) {
      if (invalidateRouting) await redis.del(COMMUNITY_POSTS_KEY);
      throw new Error(`Invalid or unavailable community post: ${title}`);
    }
    return post;
  };
  const findOwnedPost = (
    posts: Post[],
    title: string,
    accept: (post: Post) => boolean,
  ) =>
    posts
      .filter(
        (post) =>
          post.authorName.toLowerCase() === context.appSlug.toLowerCase() &&
          post.title === title &&
          accept(post) &&
          !post.removed,
      )
      .at(-1);
  const createOrAdoptPost = async (
    key: string,
    title: string,
    prepare: () => Promise<() => Promise<Post>>,
    accept: (post: Post) => boolean = () => true,
    recoverImageSubmission = false,
  ) => {
    let post = findOwnedPost(owned, title, accept);
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
        if (isDefinitiveRedditRejection(error, "post")) {
          await redis.del(`${key}:creating`);
          throw error;
        }
        if (!recoverImageSubmission) throw error;
        // Native image submission can report asynchronous creation without an
        // ID. Only read for its arrival; the durable claim forbids resubmission.
        for (const delay of [0, 250, 750, 1500]) {
          if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
          try {
            const latest = await reddit
              .getNewPosts({ subredditName, limit: 100 })
              .all();
            post = findOwnedPost(latest, title, accept);
          } catch {
            // A failed discovery read cannot settle an uncertain submission.
          }
          if (post) break;
        }
        if (!post) throw error;
      }
    }
    await validatePost(post, title, undefined, false);
    if (!accept(post))
      throw new Error(`Unexpected community post type: ${title}`);
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
    const post = await createOrAdoptPost(key, title, prepare);
    await redis.set(key, post.id);
    return post;
  };
  const game = await readPost("game", "Euclid", prepareGamePost);
  const hubs = {} as Record<HubKind, Post>;
  const retired = new Map<HubKind, Post["id"]>();
  let stylesPromise: ReturnType<typeof communityPostStyles> | undefined;
  const getStyles = () => (stylesPromise ??= communityPostStyles(true));
  for (const kind of ["ai", "h2h"] as const) {
    const title = RESULT_HUB_TITLES[kind];
    const key = `${COMMUNITY_POSTS_KEY}:${kind}`;
    const saved = await redis.get(key);
    if (saved !== undefined && !isPostId(saved))
      throw new Error("Invalid community post ID");
    const existingId = previous?.[kind] ?? saved;
    let hub = existingId
      ? await validatePost(
          await reddit.getPostById(existingId),
          title,
          existingId,
        )
      : owned.filter((post) => post.title === title && !post.removed).at(-1);
    if (hub) await validatePost(hub, title, hub.id);
    if (hub && !saved) await redis.set(key, hub.id);
    if (hub && !isImagePost(hub) && hub.numberOfComments !== 0) {
      console.warn("[COMMUNITY] Preserving occupied result hub", hub.id);
    } else if (!hub || !isImagePost(hub)) {
      const oldId = hub?.id;
      hub = await createOrAdoptPost(
        `${key}:image-v1`,
        title,
        async () => {
          const { shareImageUrl } = await getStyles();
          if (!shareImageUrl)
            throw new Error(
              "A community icon is required to create result image posts.",
            );
          return () =>
            reddit.submitPost({
              subredditName,
              title,
              kind: "image",
              imageUrls: [shareImageUrl],
              runAs: "APP",
              sendreplies: false,
            });
        },
        isImagePost,
        true,
      );
      if (oldId) retired.set(kind, oldId);
    }
    // Old canonical IDs remain cleanup pointers if removal failed after routing
    // switched on an earlier upgrade. They never determine result routing now.
    if (saved && saved !== hub.id) retired.set(kind, saved);
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

  for (const kind of ["ai", "h2h"] as const) {
    const oldId = retired.get(kind);
    if (oldId) {
      const old = await reddit.getPostById(oldId);
      if (
        !hasPostIdentity(old, RESULT_HUB_TITLES[kind], oldId) ||
        isImagePost(old)
      )
        throw new Error(`Unsafe retired result hub: ${oldId}`);
      if (!old.removed) {
        if (old.numberOfComments === 0) {
          await old.remove();
          console.log("[COMMUNITY] Removed empty replaced hub", old.id);
        } else {
          console.warn(
            "[COMMUNITY] Retaining comments added to replaced hub",
            old.id,
          );
        }
      }
    }
    await redis.set(`${COMMUNITY_POSTS_KEY}:${kind}`, hubs[kind].id);
  }

  // Presentation runs only after the hubs are usable. Its failure must not
  // disable result sharing or create replacement posts.
  const styles = await getStyles();
  // Result hubs are native images. Custom game/result posts also support styles.
  // Read back the stored URL without assuming highlight rendering.
  if (styles.shareImageUrl) {
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
  }
  await updateGamePostContent(game, gamePostContent(styles.shareImageUrl));
  return posts;
}
