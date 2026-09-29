import { beforeEach, describe, expect, it, vi } from "vitest";
import { deleteLegacyGamePosts } from "./legacy-post-cleanup";

const mocks = vi.hoisted(() => ({
  context: { appSlug: "ripred-euclid", subredditName: "EuclidTheGame" },
  reddit: { getPostById: vi.fn() },
  redis: { get: vi.fn(), set: vi.fn() },
}));
vi.mock("@devvit/web/server", () => mocks);

const makePost = (id: string) => ({
  id,
  title: "Redditor vs Euclid",
  authorName: "ripred-euclid",
  subredditName: "EuclidTheGame",
  removedByCategory: undefined as string | undefined,
  delete: vi.fn().mockResolvedValue(undefined),
});
let posts: ReturnType<typeof makePost>[];

beforeEach(() => {
  vi.resetAllMocks();
  mocks.context.appSlug = "ripred-euclid";
  mocks.context.subredditName = "EuclidTheGame";
  posts = [makePost("t3_1wt0w74"), makePost("t3_1wp7t4u")];
  mocks.reddit.getPostById.mockImplementation(async (id: string) =>
    posts.find((post) => post.id === id),
  );
});

describe("authorized legacy post deletion", () => {
  it("deletes only the two authorized posts, including a moderator-removed post", async () => {
    posts[0]!.removedByCategory = "moderator";
    await deleteLegacyGamePosts();
    expect(mocks.reddit.getPostById.mock.calls).toEqual([
      ["t3_1wt0w74"],
      ["t3_1wp7t4u"],
    ]);
    for (const post of posts) expect(post.delete).toHaveBeenCalledOnce();
    expect(mocks.redis.set).toHaveBeenCalledWith(expect.any(String), "done");
  });

  it.each(["app", "subreddit", "completed"])(
    "does nothing for %s guard",
    async (guard) => {
      if (guard === "app") mocks.context.appSlug = "other-app";
      if (guard === "subreddit")
        mocks.context.subredditName = "other-community";
      if (guard === "completed") mocks.redis.get.mockResolvedValue("done");
      await deleteLegacyGamePosts();
      expect(mocks.reddit.getPostById).not.toHaveBeenCalled();
      expect(mocks.redis.set).not.toHaveBeenCalled();
    },
  );

  it.each([
    { id: "t3_1rv3cb1" },
    { title: "Redditors vs Euclid" },
    { authorName: "another-user" },
    { subredditName: "another-community" },
    { authorName: "[deleted]", removedByCategory: "moderator" },
  ])(
    "rejects a mismatched target before either deletion: %j",
    async (change) => {
      Object.assign(posts[1]!, change);
      mocks.reddit.getPostById
        .mockResolvedValueOnce(posts[0])
        .mockResolvedValueOnce(posts[1]);
      await expect(deleteLegacyGamePosts()).rejects.toThrow(
        "Unexpected legacy",
      );
      for (const post of posts) expect(post.delete).not.toHaveBeenCalled();
      expect(mocks.redis.set).not.toHaveBeenCalled();
    },
  );

  it("retries after partial failure without deleting an already deleted post", async () => {
    posts[1]!.delete.mockRejectedValueOnce(new Error("temporary"));
    await expect(deleteLegacyGamePosts()).rejects.toThrow("temporary");
    expect(mocks.redis.set).not.toHaveBeenCalled();
    posts[0]!.authorName = "[deleted]";
    posts[0]!.removedByCategory = "deleted";
    await deleteLegacyGamePosts();
    expect(posts[0]!.delete).toHaveBeenCalledOnce();
    expect(posts[1]!.delete).toHaveBeenCalledTimes(2);
    expect(mocks.redis.set).toHaveBeenCalledOnce();
  });

  it("does not delete or mark completion when either lookup fails", async () => {
    mocks.reddit.getPostById.mockRejectedValueOnce(new Error("unavailable"));
    await expect(deleteLegacyGamePosts()).rejects.toThrow("unavailable");
    for (const post of posts) expect(post.delete).not.toHaveBeenCalled();
    expect(mocks.redis.set).not.toHaveBeenCalled();
  });
});
