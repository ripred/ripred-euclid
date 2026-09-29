import assert from "node:assert/strict";
import test from "node:test";
import { COMMUNITY_POSTS_KEY } from "../../src/server/community-post-keys.ts";
import { RESULT_HUB_TITLES } from "../../src/shared/result-sharing.ts";
import { createLocalCommunity } from "./community.mjs";
import { createLocalRedis } from "./redis-store.mjs";

test("local community seeds the game and locked newest-first hubs using shared titles", async () => {
  const local = createLocalCommunity();
  const redis = createLocalRedis();
  await local.seed(redis);
  const registry = JSON.parse(await redis.get(COMMUNITY_POSTS_KEY));
  assert.equal(registry.game, "t3_local");
  assert.equal(
    registry.gamePermalink,
    local.posts.get(registry.game).permalink,
  );
  for (const [kind, title] of Object.entries(RESULT_HUB_TITLES)) {
    const hub = await local.reddit.getPostById(registry[kind]);
    assert.equal(hub.title, title);
    assert.equal(hub.locked, true);
    assert.equal(hub.suggestedCommentSort, "NEW");
  }
  await local.seed(redis);
  assert.equal(local.posts.size, 3);
  await redis.set(COMMUNITY_POSTS_KEY, "existing local registry");
  await local.seed(redis);
  assert.equal(await redis.get(COMMUNITY_POSTS_KEY), "existing local registry");
});

test("locked local hubs accept app comments and deny ordinary users without a write", async () => {
  const local = createLocalCommunity({ currentUsername: () => "alice" });
  const id = local.registry.ai;
  for (const runAs of [undefined, "USER"])
    await assert.rejects(
      local.reddit.submitComment({ id, text: "user comment", runAs }),
      { code: "permission_denied" },
    );
  assert.equal(local.comments.size, 0);
  const comment = await local.reddit.submitComment({
    id,
    text: "### Euclid beat alice, 156–132",
    runAs: "APP",
  });
  assert.equal(comment.authorName, "euclid");
  assert.equal(comment.postId, id);
  assert.match(comment.id, /^t1_local/);
  assert.equal(
    comment.permalink,
    `${local.posts.get(id).permalink}${comment.id.slice(3)}/`,
  );
  assert.equal(
    local.comments.get(comment.id).text,
    "### Euclid beat alice, 156–132",
  );
  assert.equal(local.posts.size, 3, "sharing a result creates no feed post");
  const regular = await local.reddit.submitComment({
    id: local.registry.game,
    text: "hello",
  });
  assert.equal(regular.authorName, "alice");
});

test("local post styles and media are synthetic even when given an external image", async (t) => {
  t.mock.method(globalThis, "fetch", () =>
    assert.fail("local Reddit must not fetch remote services"),
  );
  const local = createLocalCommunity();
  const styles = await local.reddit.getSubredditStyles("t5_local");
  assert.equal(styles.icon, "https://i.redd.it/localicon.png");
  const image = await local.media.upload({
    url: "https://example.com/icon.png",
    type: "image",
  });
  assert.equal(image.mediaUrl, "https://i.redd.it/localicon.png");
  const post = await local.reddit.submitCustomPost({
    title: "Legacy result preview",
    postData: { kind: "result" },
    styles: { shareImageUrl: image.mediaUrl },
  });
  assert.deepEqual(await local.reddit.getPostData(post.id), { kind: "result" });
  assert.deepEqual(await local.reddit.getPostStyles(post.id), {
    shareImageUrl: "https://i.redd.it/localicon.png",
  });
  await local.reddit.setPostStyles(post.id, {
    shareImageUrl: "/another-local-image.png",
  });
  assert.deepEqual(await local.reddit.getPostStyles(post.id), {
    shareImageUrl: "/another-local-image.png",
  });
  await post.lock();
  await post.setSuggestedCommentSort("NEW");
  assert.equal((await local.reddit.getPostById(post.id)).locked, true);
  assert.equal(
    (await local.reddit.getNewPosts({ limit: 1 }).all())[0].id,
    post.id,
  );
  await local.reddit.submitComment({
    id: local.registry.h2h,
    text: "result",
    runAs: "APP",
  });
});

test("local fixture bounds reject excess and invalid writes without growing the stores", async () => {
  const local = createLocalCommunity({ maxPosts: 4, maxComments: 1 });
  await local.reddit.submitPost({
    title: "One extra local post",
    text: "body",
  });
  await assert.rejects(
    local.reddit.submitCustomPost({ title: "overflow" }),
    /post limit/,
  );
  assert.equal(local.posts.size, 4);
  const options = { id: local.registry.ai, runAs: "APP" };
  await assert.rejects(
    local.reddit.submitComment({ ...options, text: "x".repeat(10_001) }),
    /1–10000/,
  );
  await assert.rejects(
    local.reddit.submitComment({
      ...options,
      id: "t3_missing",
      text: "result",
    }),
    { code: "not_found" },
  );
  assert.equal(local.comments.size, 0);
  await local.reddit.submitComment({ ...options, text: "result" });
  await assert.rejects(
    local.reddit.submitComment({ ...options, text: "overflow" }),
    /comment limit/,
  );
  assert.equal(local.comments.size, 1);
});
