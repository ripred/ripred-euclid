import { context, reddit, redis } from "@devvit/web/server";

const POST_IDS = ["t3_1wt0w74", "t3_1wp7t4u"] as const;
const COMPLETED_KEY = "euclid:migrations:delete-legacy-game-posts:2026-09-29";

/** Owner-authorized deletion of two standalone results replaced by result hubs. */
export async function deleteLegacyGamePosts() {
  if (
    context.appSlug !== "ripred-euclid" ||
    context.subredditName?.toLowerCase() !== "euclidthegame" ||
    (await redis.get(COMPLETED_KEY)) === "done"
  )
    return;

  const posts = await Promise.all(POST_IDS.map((id) => reddit.getPostById(id)));
  // Validate the entire fixed set before the first irreversible write.
  for (const [index, post] of posts.entries()) {
    const deleted =
      post.authorName === "[deleted]" && post.removedByCategory === "deleted";
    if (
      post.id !== POST_IDS[index] ||
      post.subredditName.toLowerCase() !== "euclidthegame" ||
      post.title !== "Redditor vs Euclid" ||
      (!deleted && post.authorName !== context.appSlug)
    )
      throw new Error(`Unexpected legacy game post: ${POST_IDS[index]}`);
  }
  for (const post of posts) {
    if (post.authorName === "[deleted]") continue;
    await post.delete();
    console.log("[COMMUNITY] Deleted legacy game post as app author", post.id);
  }
  await redis.set(COMPLETED_KEY, "done");
}
