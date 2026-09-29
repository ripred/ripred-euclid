import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RESULT_HUB_TITLES } from "../shared/result-sharing";
import type { ResultSharePayload } from "../shared/types/api";
import { resultHub, setupCommunityPosts } from "./community-posts";
import { COMMUNITY_POSTS_KEY as POSTS_KEY } from "./community-post-keys";
import { gamePostContent } from "./community-post-content";

const mocks = vi.hoisted(() => ({
  context: { subredditName: "EuclidTheGame", appSlug: "ripred-euclid" },
  redis: { get: vi.fn(), set: vi.fn(), del: vi.fn() },
  reddit: {
    getNewPosts: vi.fn(),
    getPostById: vi.fn(),
    submitPost: vi.fn(),
    submitCustomPost: vi.fn(),
    getPostData: vi.fn(),
    setPostStyles: vi.fn(),
    getPostStyles: vi.fn(),
  },
  createPost: vi.fn(),
  prepareGamePost: vi.fn(),
  ensurePostHighlighted: vi.fn(),
  communityPostStyles: vi.fn(),
}));

vi.mock("@devvit/web/server", () => mocks);
vi.mock("./core/post", () => ({ prepareGamePost: mocks.prepareGamePost }));
vi.mock("./post-highlights", () => ({
  ensurePostHighlighted: mocks.ensurePostHighlighted,
}));
vi.mock("./post-presentation", async (importActual) => ({
  ...(await importActual<typeof import("./post-presentation")>()),
  communityPostStyles: mocks.communityPostStyles,
}));

const makePost = (
  id: `t3_${string}`,
  title: string,
  authorName = "ripred-euclid",
) => {
  const post = {
    id,
    title,
    authorName,
    subredditName: "EuclidTheGame",
    removed: false,
    archived: false,
    removedByCategory: undefined as string | undefined,
    permalink: `/r/EuclidTheGame/comments/${id.slice(3)}`,
    url:
      title === "Euclid"
        ? `https://www.reddit.com/r/EuclidTheGame/comments/${id.slice(3)}`
        : `https://i.redd.it/${id}.png`,
    numberOfComments: 0,
    body: "" as string | undefined,
    edit: vi.fn(async ({ text }: { text: string }) => {
      post.body = text;
    }),
    setTextFallback: vi.fn(async ({ text }: { text: string }) => {
      post.body = text;
    }),
    lock: vi.fn().mockResolvedValue(undefined),
    remove: vi.fn(async () => {
      post.removed = true;
    }),
    setSuggestedCommentSort: vi.fn().mockResolvedValue(undefined),
  };
  return post;
};
type TestPost = ReturnType<typeof makePost>;
let saved: Map<string, string>;
let recent: TestPost[];
let game: TestPost;
let ai: TestPost;
let h2h: TestPost;
let available: Map<string, TestPost>;
const iconStyles = { shareImageUrl: "https://i.redd.it/icon.png" };

const persist = async (
  key: string,
  value: string,
  options?: { nx?: boolean },
) => {
  if (options?.nx && saved.has(key)) return undefined;
  saved.set(key, value);
  return "OK";
};

beforeEach(() => {
  vi.resetAllMocks();
  saved = new Map();
  game = makePost("t3_game", "Euclid");
  ai = makePost("t3_ai", RESULT_HUB_TITLES.ai);
  h2h = makePost("t3_h2h", RESULT_HUB_TITLES.h2h);
  recent = [h2h, ai, game];
  available = new Map(recent.map((post) => [post.id, post]));
  mocks.redis.get.mockImplementation(async (key: string) => saved.get(key));
  mocks.redis.set.mockImplementation(persist);
  mocks.redis.del.mockImplementation(async (key: string) => saved.delete(key));
  mocks.reddit.getNewPosts.mockImplementation(() => ({
    all: async () => recent,
  }));
  mocks.reddit.getPostById.mockImplementation(async (id: string) => {
    const post = available.get(id);
    if (!post) throw new Error("Post not found");
    return post;
  });
  mocks.createPost.mockImplementation(async () => {
    recent.unshift(game);
    return game;
  });
  mocks.prepareGamePost.mockResolvedValue(mocks.createPost);
  mocks.reddit.submitPost.mockImplementation(async ({ title }) => {
    const old = title === RESULT_HUB_TITLES.ai ? ai : h2h;
    const post = old.url.startsWith("https://i.redd.it/")
      ? old
      : makePost(`${old.id}image`, title);
    available.set(post.id, post);
    recent.unshift(post);
    return post;
  });
  mocks.ensurePostHighlighted.mockResolvedValue(true);
  mocks.communityPostStyles.mockResolvedValue(iconStyles);
  mocks.reddit.getPostStyles.mockResolvedValue(iconStyles);
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("community results posts", () => {
  it("adopts the oldest matching app posts and preserves their IDs on repeat setup", async () => {
    game.authorName = "RipRed-Euclid";
    recent.unshift(
      makePost("t3_other", "Euclid", "another-user"),
      makePost("t3_newer", "Euclid"),
    );
    const posts = await setupCommunityPosts();
    expect(posts).toEqual({
      game: game.id,
      gamePermalink: game.permalink,
      ai: ai.id,
      h2h: h2h.id,
    });
    recent = [];
    expect(await setupCommunityPosts()).toEqual(posts);
    expect(mocks.createPost).not.toHaveBeenCalled();
    expect(mocks.reddit.submitPost).not.toHaveBeenCalled();
    for (const hub of [ai, h2h]) {
      expect(hub.lock).toHaveBeenCalledTimes(2);
      expect(hub.setSuggestedCommentSort.mock.calls).toEqual([
        ["NEW"],
        ["NEW"],
      ]);
    }
    expect(mocks.ensurePostHighlighted.mock.calls).toEqual(
      [game, ai, h2h, game, ai, h2h].map((post) => [post.id]),
    );
  });

  it("creates missing native image hubs once with the community image", async () => {
    recent = [];
    await setupCommunityPosts();
    await setupCommunityPosts();
    expect(mocks.createPost).toHaveBeenCalledTimes(1);
    expect(mocks.reddit.submitPost).toHaveBeenCalledTimes(2);
    for (const title of Object.values(RESULT_HUB_TITLES)) {
      expect(mocks.reddit.submitPost).toHaveBeenCalledWith({
        subredditName: "EuclidTheGame",
        title,
        kind: "image",
        imageUrls: [iconStyles.shareImageUrl],
        runAs: "APP",
        sendreplies: false,
      });
    }
  });

  it("allows only one creator when two setup calls race", async () => {
    recent = [];
    const results = await Promise.allSettled([
      setupCommunityPosts(),
      setupCommunityPosts(),
    ]);
    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect(mocks.createPost).toHaveBeenCalledTimes(1);
    expect(mocks.reddit.submitPost).toHaveBeenCalledTimes(2);
    await setupCommunityPosts();
    expect(mocks.createPost).toHaveBeenCalledTimes(1);
    expect(mocks.reddit.submitPost).toHaveBeenCalledTimes(2);
  });

  it.each(["lock", "sort", "highlight"])(
    "publishes readiness only after configuration succeeds, including %s",
    async (failure) => {
      const checkNotReady = async () => {
        expect(saved.has(POSTS_KEY)).toBe(false);
      };
      ai.lock.mockImplementation(checkNotReady);
      h2h.lock.mockImplementation(checkNotReady);
      mocks.ensurePostHighlighted.mockImplementation(async () => {
        await checkNotReady();
        return true;
      });
      const operation =
        failure === "lock"
          ? h2h.lock
          : failure === "sort"
            ? h2h.setSuggestedCommentSort
            : mocks.ensurePostHighlighted;
      operation.mockRejectedValueOnce(new Error("configuration unavailable"));
      await expect(setupCommunityPosts()).rejects.toThrow(
        "configuration unavailable",
      );
      expect(saved.has(POSTS_KEY)).toBe(false);
      await setupCommunityPosts();
      expect(JSON.parse(saved.get(POSTS_KEY)!)).toMatchObject({
        ai: ai.id,
        h2h: h2h.id,
      });
      expect(mocks.reddit.submitPost).not.toHaveBeenCalled();
    },
  );

  it("keeps hubs and images ready when highlight RPCs are unsupported", async () => {
    mocks.ensurePostHighlighted.mockResolvedValue(false);
    const styles = { shareImageUrl: "https://i.redd.it/community-icon.png" };
    mocks.communityPostStyles.mockResolvedValue(styles);
    mocks.reddit.getPostStyles.mockResolvedValue(styles);
    const posts = await setupCommunityPosts();
    expect(JSON.parse(saved.get(POSTS_KEY)!)).toEqual(posts);
    for (const hub of [ai, h2h]) {
      expect(hub.lock).toHaveBeenCalledOnce();
      expect(hub.setSuggestedCommentSort).toHaveBeenCalledExactlyOnceWith(
        "NEW",
      );
    }
    expect(mocks.ensurePostHighlighted).toHaveBeenCalledExactlyOnceWith(
      game.id,
    );
    expect(console.warn).toHaveBeenCalledExactlyOnceWith(
      expect.stringContaining("manually add these three posts"),
      [game, ai, h2h].map(({ title, id, permalink }) => ({
        title,
        id,
        permalink,
      })),
    );
    expect(mocks.reddit.setPostStyles).toHaveBeenCalledExactlyOnceWith(
      game.id,
      styles,
    );
    expect(mocks.reddit.getPostStyles).toHaveBeenCalledExactlyOnceWith(game.id);
  });

  it("adopts a remotely submitted hub after saving its ID failed", async () => {
    recent = [game];
    let failSave = true;
    mocks.redis.set.mockImplementation(async (key, value, options) => {
      if (key === `${POSTS_KEY}:ai` && failSave) {
        failSave = false;
        throw new Error("Redis unavailable");
      }
      return persist(key, value, options);
    });
    await expect(setupCommunityPosts()).rejects.toThrow("Redis unavailable");
    expect(recent).toContain(ai);
    expect(saved.get(`${POSTS_KEY}:ai:image-v1:creating`)).toBe("pending");
    expect(saved.has(POSTS_KEY)).toBe(true);
    await setupCommunityPosts();
    expect(
      mocks.reddit.submitPost.mock.calls.map(([post]) => post.title),
    ).toEqual([RESULT_HUB_TITLES.ai, RESULT_HUB_TITLES.h2h]);
    expect(saved.get(`${POSTS_KEY}:ai`)).toBe(ai.id);
  });

  it("does not repeat an uncertain submission while no created post is visible", async () => {
    vi.useFakeTimers();
    recent = [game];
    mocks.reddit.submitPost.mockRejectedValueOnce(new Error("response lost"));
    const failed = expect(setupCommunityPosts()).rejects.toThrow(
      "response lost",
    );
    await vi.runAllTimersAsync();
    await failed;
    expect(mocks.reddit.getNewPosts).toHaveBeenCalledTimes(5);
    await expect(setupCommunityPosts()).rejects.toThrow("already pending");
    expect(mocks.reddit.submitPost).toHaveBeenCalledTimes(1);
    expect(saved.has(POSTS_KEY)).toBe(false);
  });

  it("leaves no creation claim when game icon preflight fails", async () => {
    recent = [];
    mocks.prepareGamePost.mockRejectedValueOnce(new Error("Media unavailable"));
    await expect(setupCommunityPosts()).rejects.toThrow("Media unavailable");
    expect(saved.has(`${POSTS_KEY}:game:creating`)).toBe(false);
    expect(mocks.createPost).not.toHaveBeenCalled();
    await setupCommunityPosts();
    expect(mocks.createPost).toHaveBeenCalledTimes(1);
  });

  it("does not poll or resubmit an uncertain game creation", async () => {
    recent = [];
    mocks.createPost.mockRejectedValueOnce(new Error("Game response lost"));
    await expect(setupCommunityPosts()).rejects.toThrow("Game response lost");
    expect(mocks.reddit.getNewPosts).toHaveBeenCalledTimes(1);
    expect(saved.get(`${POSTS_KEY}:game:creating`)).toBe("pending");
    expect(mocks.createPost).toHaveBeenCalledTimes(1);
    expect(mocks.reddit.submitPost).not.toHaveBeenCalled();
  });

  it("retries a definitely rejected submission after releasing its claim", async () => {
    recent = [game];
    mocks.reddit.submitPost.mockRejectedValueOnce(
      new Error("post submission failed: RATELIMIT"),
    );
    await expect(setupCommunityPosts()).rejects.toThrow("RATELIMIT");
    expect(mocks.reddit.getNewPosts).toHaveBeenCalledTimes(1);
    expect(saved.has(`${POSTS_KEY}:ai:image-v1:creating`)).toBe(false);
    await setupCommunityPosts();
    expect(mocks.reddit.submitPost).toHaveBeenCalledTimes(3);
  });

  it("retains the claim when a submitted post's follow-up read fails", async () => {
    vi.useFakeTimers();
    recent = [game];
    mocks.reddit.submitPost.mockRejectedValueOnce(
      Object.assign(new Error("Post read forbidden"), { code: 7 }),
    );
    const failed = expect(setupCommunityPosts()).rejects.toThrow(
      "Post read forbidden",
    );
    await vi.runAllTimersAsync();
    await failed;
    await expect(setupCommunityPosts()).rejects.toThrow("already pending");
    expect(mocks.reddit.submitPost).toHaveBeenCalledTimes(1);
  });

  it.each([
    { authorName: "another-user" },
    { subredditName: "AnotherCommunity" },
    { id: "t3_wrong" as const },
    { title: "Unrelated post" },
    { permalink: "https://example.com/r/EuclidTheGame/comments/ai/" },
    { removed: true },
    { archived: true },
    { removedByCategory: "deleted" },
  ])(
    "rejects unsafe saved hub metadata %j and invalidates routing",
    async (changes) => {
      await setupCommunityPosts();
      Object.assign(ai, changes);
      await expect(setupCommunityPosts()).rejects.toThrow(
        "Invalid or unavailable",
      );
      expect(saved.has(POSTS_KEY)).toBe(false);
      expect(mocks.reddit.submitPost).not.toHaveBeenCalled();
    },
  );

  it("backfills images on owned custom posts and reads back each stored style", async () => {
    const custom = makePost("t3_result", "An earlier result");
    const text = makePost("t3_text", "An ordinary text post");
    const foreign = makePost("t3_foreign", "Euclid", "someone-else");
    recent.unshift(custom, text, foreign);
    const styles = { shareImageUrl: "https://i.redd.it/community-icon.png" };
    mocks.communityPostStyles.mockResolvedValue(styles);
    mocks.reddit.getPostData.mockImplementation(async (id: string) =>
      id === custom.id ? { kind: "result" } : undefined,
    );
    mocks.reddit.getPostStyles.mockResolvedValue(styles);
    await setupCommunityPosts();
    expect(mocks.communityPostStyles).toHaveBeenCalledExactlyOnceWith(true);
    expect(mocks.reddit.setPostStyles.mock.calls).toEqual([
      [game.id, styles],
      [custom.id, styles],
    ]);
    expect(mocks.reddit.getPostStyles.mock.calls).toEqual([
      [game.id],
      [custom.id],
    ]);
  });

  it("refreshes the saved game image even after it leaves the newest-post listing", async () => {
    await setupCommunityPosts();
    mocks.reddit.setPostStyles.mockClear();
    recent = [];
    const styles = { shareImageUrl: "https://i.redd.it/new-icon.png" };
    mocks.communityPostStyles.mockResolvedValue(styles);
    mocks.reddit.getPostStyles.mockResolvedValue(styles);
    await setupCommunityPosts();
    expect(mocks.reddit.setPostStyles).toHaveBeenCalledExactlyOnceWith(
      game.id,
      styles,
    );
  });

  it("reports an image readback mismatch while retaining usable result hubs", async () => {
    mocks.communityPostStyles.mockResolvedValue({
      shareImageUrl: "https://i.redd.it/new-icon.png",
    });
    mocks.reddit.getPostStyles.mockResolvedValue({});
    await expect(setupCommunityPosts()).rejects.toThrow("image was not saved");
    expect(saved.has(POSTS_KEY)).toBe(true);
  });

  it("reconciles each saved pinned post with the same icon without replacing or appending content", async () => {
    const styles = { shareImageUrl: "https://i.redd.it/icon.png" };
    mocks.communityPostStyles.mockResolvedValue(styles);
    mocks.reddit.getPostStyles.mockResolvedValue(styles);
    const posts = await setupCommunityPosts();
    recent = [];
    expect(await setupCommunityPosts()).toEqual(posts);
    for (const hub of [ai, h2h]) {
      expect(hub.edit).not.toHaveBeenCalled();
      expect(hub.setTextFallback).not.toHaveBeenCalled();
    }
    expect(game.setTextFallback).toHaveBeenCalledTimes(1);
    for (const [content] of game.setTextFallback.mock.calls)
      expect(content).toEqual(gamePostContent(styles.shareImageUrl));
    expect(game.edit).not.toHaveBeenCalled();
    expect(mocks.createPost).not.toHaveBeenCalled();
    expect(mocks.reddit.submitPost).not.toHaveBeenCalled();
  });

  it("keeps plain text without an icon and skips already matching bodies", async () => {
    mocks.communityPostStyles.mockResolvedValue({});
    await setupCommunityPosts();
    expect(game.setTextFallback).toHaveBeenCalledExactlyOnceWith(
      gamePostContent(),
    );
    game.body = gamePostContent().text;
    await setupCommunityPosts();
    expect(game.setTextFallback).toHaveBeenCalledTimes(1);
    expect(ai.edit).not.toHaveBeenCalled();
    expect(h2h.edit).not.toHaveBeenCalled();
  });

  it.each(["icon", "game"])(
    "propagates %s presentation failure while retaining working hub routing",
    async (failure) => {
      const error = new Error("Presentation unavailable");
      if (failure === "icon")
        mocks.communityPostStyles.mockRejectedValueOnce(error);
      else game.setTextFallback.mockRejectedValueOnce(error);
      await expect(setupCommunityPosts()).rejects.toBe(error);
      expect(await resultHub(resultPayload)).toEqual({
        postId: ai.id,
        gamePermalink: game.permalink,
      });
      expect(ai.lock).toHaveBeenCalledOnce();
      expect(h2h.lock).toHaveBeenCalledOnce();
    },
  );

  it("does not rewrite other app posts or another author's post bodies", async () => {
    const unrelated = makePost("t3_unrelated", "Notes");
    const otherAuthor = makePost("t3_foreign", "Euclid", "someone-else");
    const result = makePost("t3_result", "Old result");
    recent.unshift(unrelated, otherAuthor, result);
    await setupCommunityPosts();
    for (const post of [unrelated, otherAuthor, result]) {
      expect(post.edit).not.toHaveBeenCalled();
      expect(post.setTextFallback).not.toHaveBeenCalled();
    }
  });
});

describe("native image hub migration", () => {
  function useTextHubs() {
    ai.url = `https://www.reddit.com${ai.permalink}`;
    h2h.url = `https://www.reddit.com${h2h.permalink}`;
    const posts = {
      game: game.id,
      gamePermalink: game.permalink,
      ai: ai.id,
      h2h: h2h.id,
    };
    saved.set(POSTS_KEY, JSON.stringify(posts));
    saved.set(`${POSTS_KEY}:ai`, ai.id);
    saved.set(`${POSTS_KEY}:h2h`, h2h.id);
    return posts;
  }

  it("publishes both configured images together before removing empty originals", async () => {
    const old = useTextHubs();
    const submit = mocks.reddit.submitPost.getMockImplementation()!;
    mocks.reddit.submitPost.mockImplementation(async (options) => {
      const post = await submit(options);
      post.setSuggestedCommentSort.mockImplementation(async () => {
        expect(JSON.parse(saved.get(POSTS_KEY)!)).toEqual(old);
      });
      return post;
    });
    for (const post of [ai, h2h])
      post.remove.mockImplementation(async () => {
        const route = JSON.parse(saved.get(POSTS_KEY)!);
        expect(route).toMatchObject({ ai: "t3_aiimage", h2h: "t3_h2himage" });
        expect(available.get(route.ai)!.lock).toHaveBeenCalledOnce();
        expect(
          available.get(route.h2h)!.setSuggestedCommentSort,
        ).toHaveBeenCalledWith("NEW");
        post.removed = true;
      });
    const next = await setupCommunityPosts();
    expect(next.game).toBe(old.game);
    expect(next.ai).toBe("t3_aiimage");
    expect(next.h2h).toBe("t3_h2himage");
    expect(await resultHub(resultPayload)).toMatchObject({ postId: next.ai });
    for (const [kind, post] of [
      ["ai", ai],
      ["h2h", h2h],
    ] as const) {
      expect(post.remove).toHaveBeenCalledOnce();
      expect(post.edit).not.toHaveBeenCalled();
      expect(saved.get(`${POSTS_KEY}:${kind}`)).toBe(next[kind]);
    }
  });

  it("preserves occupied text hubs while replacing empty ones", async () => {
    useTextHubs();
    ai.numberOfComments = 1;
    const next = await setupCommunityPosts();
    expect(next.ai).toBe(ai.id);
    expect(next.h2h).toBe("t3_h2himage");
    expect(mocks.reddit.submitPost).toHaveBeenCalledTimes(1);
    expect(ai.remove).not.toHaveBeenCalled();
    expect(ai.edit).not.toHaveBeenCalled();
    expect(console.warn).toHaveBeenCalledWith(
      "[COMMUNITY] Preserving occupied result hub",
      ai.id,
    );
  });

  it("rechecks comments after switching routing and retains late comments", async () => {
    useTextHubs();
    mocks.redis.set.mockImplementation(async (key, value, options) => {
      const result = await persist(key, value, options);
      if (key === POSTS_KEY) ai.numberOfComments = 1;
      return result;
    });
    const next = await setupCommunityPosts();
    expect(next.ai).toBe("t3_aiimage");
    expect(ai.remove).not.toHaveBeenCalled();
    expect(h2h.remove).toHaveBeenCalledOnce();
    expect(saved.get(`${POSTS_KEY}:ai`)).toBe(next.ai);
  });

  it.each([
    { visibleAfter: 0, reads: 2 },
    { visibleAfter: 250, reads: 3 },
    { visibleAfter: 1000, reads: 4 },
    { visibleAfter: 2500, reads: 5 },
  ])(
    "adopts an asynchronous image within one setup when visible after $visibleAfter ms",
    async ({ visibleAfter, reads }) => {
      vi.useFakeTimers();
      const old = useTextHubs();
      const submit = mocks.reddit.submitPost.getMockImplementation()!;
      mocks.reddit.submitPost.mockImplementationOnce(async (options) => {
        const post = await submit(options);
        if (visibleAfter) {
          recent = recent.filter(({ id }) => id !== post.id);
          setTimeout(() => {
            expect(JSON.parse(saved.get(POSTS_KEY)!)).toEqual(old);
            recent.unshift(post);
          }, visibleAfter);
        }
        throw new Error(
          "Image post type is being created asynchronously and should be updated in the subreddit soon.",
        );
      });
      const setup = setupCommunityPosts();
      await vi.runAllTimersAsync();
      const next = await setup;
      expect(next.ai).toBe("t3_aiimage");
      expect(next.h2h).toBe("t3_h2himage");
      expect(mocks.reddit.getNewPosts).toHaveBeenCalledTimes(reads);
      expect(mocks.reddit.submitPost).toHaveBeenCalledTimes(2);
      expect(saved.get(`${POSTS_KEY}:ai:image-v1:creating`)).toBe("pending");
      expect(ai.remove).toHaveBeenCalledOnce();
      expect(h2h.remove).toHaveBeenCalledOnce();
    },
  );

  it.each([false, true])(
    "retains the claim and old routing when image discovery never succeeds (read failure=%s)",
    async (readFailure) => {
      vi.useFakeTimers();
      const old = useTextHubs();
      const failure = new Error("Image creation is asynchronous");
      mocks.reddit.submitPost.mockImplementationOnce(async () => {
        if (readFailure)
          mocks.reddit.getNewPosts.mockImplementation(() => ({
            all: async () => {
              throw new Error("Listing unavailable");
            },
          }));
        throw failure;
      });
      const failed = expect(setupCommunityPosts()).rejects.toBe(failure);
      await vi.runAllTimersAsync();
      await failed;
      expect(mocks.reddit.getNewPosts).toHaveBeenCalledTimes(5);
      expect(mocks.reddit.submitPost).toHaveBeenCalledTimes(1);
      expect(saved.get(`${POSTS_KEY}:ai:image-v1:creating`)).toBe("pending");
      expect(JSON.parse(saved.get(POSTS_KEY)!)).toEqual(old);
      expect(ai.remove).not.toHaveBeenCalled();
      expect(h2h.remove).not.toHaveBeenCalled();
    },
  );

  it("validates a recovered image before changing routing", async () => {
    const old = useTextHubs();
    const submit = mocks.reddit.submitPost.getMockImplementation()!;
    mocks.reddit.submitPost.mockImplementationOnce(async (options) => {
      const post = await submit(options);
      post.subredditName = "AnotherCommunity";
      throw new Error("Image creation is asynchronous");
    });
    await expect(setupCommunityPosts()).rejects.toThrow(
      "Invalid or unavailable",
    );
    expect(saved.get(`${POSTS_KEY}:ai:image-v1:creating`)).toBe("pending");
    expect(JSON.parse(saved.get(POSTS_KEY)!)).toEqual(old);
    expect(mocks.reddit.submitPost).toHaveBeenCalledTimes(1);
    expect(ai.remove).not.toHaveBeenCalled();
    expect(h2h.remove).not.toHaveBeenCalled();
  });

  it("does not adopt another author's image after an uncertain submission", async () => {
    vi.useFakeTimers();
    const old = useTextHubs();
    const failure = new Error("Image creation is asynchronous");
    mocks.reddit.submitPost.mockImplementationOnce(async () => {
      recent.unshift(
        makePost("t3_foreign", RESULT_HUB_TITLES.ai, "another-user"),
      );
      throw failure;
    });
    const failed = expect(setupCommunityPosts()).rejects.toBe(failure);
    await vi.runAllTimersAsync();
    await failed;
    expect(mocks.reddit.getNewPosts).toHaveBeenCalledTimes(5);
    expect(mocks.reddit.submitPost).toHaveBeenCalledTimes(1);
    expect(saved.get(`${POSTS_KEY}:ai:image-v1:creating`)).toBe("pending");
    expect(JSON.parse(saved.get(POSTS_KEY)!)).toEqual(old);
  });

  it("retains old routing if replacement configuration fails, then adopts on retry", async () => {
    const old = useTextHubs();
    const submit = mocks.reddit.submitPost.getMockImplementation()!;
    mocks.reddit.submitPost.mockImplementation(async (options) => {
      const post = await submit(options);
      if (options.title === RESULT_HUB_TITLES.h2h)
        post.lock.mockRejectedValueOnce(new Error("Lock unavailable"));
      return post;
    });
    await expect(setupCommunityPosts()).rejects.toThrow("Lock unavailable");
    expect(JSON.parse(saved.get(POSTS_KEY)!)).toEqual(old);
    expect(ai.remove).not.toHaveBeenCalled();
    expect(h2h.remove).not.toHaveBeenCalled();
    await setupCommunityPosts();
    expect(mocks.reddit.submitPost).toHaveBeenCalledTimes(2);
  });

  it("does not remove originals when atomic routing publication fails", async () => {
    const old = useTextHubs();
    mocks.redis.set.mockImplementationOnce(persist);
    let fail = true;
    mocks.redis.set.mockImplementation(async (key, value, options) => {
      if (key === POSTS_KEY && fail) {
        fail = false;
        throw new Error("Routing unavailable");
      }
      return persist(key, value, options);
    });
    await expect(setupCommunityPosts()).rejects.toThrow("Routing unavailable");
    expect(JSON.parse(saved.get(POSTS_KEY)!)).toEqual(old);
    expect(ai.remove).not.toHaveBeenCalled();
    await setupCommunityPosts();
    expect(mocks.reddit.submitPost).toHaveBeenCalledTimes(2);
    expect(ai.remove).toHaveBeenCalledOnce();
  });

  it.each([false, true])(
    "retains cleanup pointers across removal failure with missing saved keys=%s",
    async (missingKeys) => {
      useTextHubs();
      if (missingKeys) {
        saved.delete(`${POSTS_KEY}:ai`);
        saved.delete(`${POSTS_KEY}:h2h`);
      }
      ai.remove.mockRejectedValueOnce(new Error("Removal unavailable"));
      await expect(setupCommunityPosts()).rejects.toThrow(
        "Removal unavailable",
      );
      expect(JSON.parse(saved.get(POSTS_KEY)!)).toMatchObject({
        ai: "t3_aiimage",
        h2h: "t3_h2himage",
      });
      expect(saved.get(`${POSTS_KEY}:ai`)).toBe(ai.id);
      await setupCommunityPosts();
      expect(mocks.reddit.submitPost).toHaveBeenCalledTimes(2);
      expect(ai.remove).toHaveBeenCalledTimes(2);
      expect(h2h.remove).toHaveBeenCalledOnce();
    },
  );

  it("does not remove twice when cleanup succeeded but saving the new canonical ID failed", async () => {
    useTextHubs();
    let fail = true;
    mocks.redis.set.mockImplementation(async (key, value, options) => {
      if (key === `${POSTS_KEY}:ai` && value === "t3_aiimage" && fail) {
        fail = false;
        throw new Error("Canonical ID unavailable");
      }
      return persist(key, value, options);
    });
    await expect(setupCommunityPosts()).rejects.toThrow(
      "Canonical ID unavailable",
    );
    expect(ai.removed).toBe(true);
    expect(saved.get(`${POSTS_KEY}:ai`)).toBe(ai.id);
    await setupCommunityPosts();
    expect(ai.remove).toHaveBeenCalledOnce();
    expect(saved.get(`${POSTS_KEY}:ai`)).toBe("t3_aiimage");
  });

  it("requires the icon before reserving any image creation", async () => {
    const old = useTextHubs();
    mocks.communityPostStyles.mockResolvedValue({});
    await expect(setupCommunityPosts()).rejects.toThrow(
      "community icon is required",
    );
    expect(saved.has(`${POSTS_KEY}:ai:image-v1:creating`)).toBe(false);
    expect(mocks.reddit.submitPost).not.toHaveBeenCalled();
    expect(JSON.parse(saved.get(POSTS_KEY)!)).toEqual(old);
  });

  it("refuses to remove a retired post whose ownership changed", async () => {
    useTextHubs();
    mocks.redis.set.mockImplementation(async (key, value, options) => {
      const result = await persist(key, value, options);
      if (key === POSTS_KEY) ai.authorName = "someone-else";
      return result;
    });
    await expect(setupCommunityPosts()).rejects.toThrow(
      "Unsafe retired result hub",
    );
    expect(ai.remove).not.toHaveBeenCalled();
    expect(saved.get(`${POSTS_KEY}:ai`)).toBe(ai.id);
  });
});

describe("game post preflight", () => {
  it("resolves styles without submitting until the prepared creation is invoked", async () => {
    const { prepareGamePost } =
      await vi.importActual<typeof import("./core/post")>("./core/post");
    const styles = { shareImageUrl: "https://i.redd.it/icon.png" };
    mocks.communityPostStyles.mockResolvedValue(styles);
    mocks.reddit.submitCustomPost.mockResolvedValue(game);
    const create = await prepareGamePost();
    expect(mocks.reddit.submitCustomPost).not.toHaveBeenCalled();
    expect(await create()).toBe(game);
    expect(mocks.reddit.submitCustomPost).toHaveBeenCalledExactlyOnceWith({
      styles,
      subredditName: "EuclidTheGame",
      title: "Euclid",
      textFallback: gamePostContent(styles.shareImageUrl),
    });
  });

  it("does not submit when preparing the community image fails", async () => {
    const { createPost } =
      await vi.importActual<typeof import("./core/post")>("./core/post");
    mocks.communityPostStyles.mockRejectedValue(new Error("Media unavailable"));
    await expect(createPost()).rejects.toThrow("Media unavailable");
    expect(mocks.reddit.submitCustomPost).not.toHaveBeenCalled();
  });
});

const basePayload = {
  shareId: "share",
  subredditName: "EuclidTheGame",
  sharedAt: "2026-09-29T12:00:00Z",
  title: "Result",
  subtitle: "Result details",
};
const resultPayload = {
  ...basePayload,
  kind: "result",
  mode: "ai",
  headline: "Player won",
  details: "150–80",
  footer: "Euclid",
  p1Name: "player",
  p2Name: "Euclid",
  winnerSide: 1,
  board: {
    W: 1,
    H: 1,
    winScore: 150,
    m_board: [],
    m_players: [],
    m_turn: 1,
    m_history: [],
    m_displayed_game_over: true,
    m_onlyShowLastSquares: false,
    m_createRandomizedRangeOrder: false,
    m_stopAt150: true,
    m_last: { x: 0, y: 0, index: 0 },
    m_lastPoints: 0,
  },
} satisfies ResultSharePayload;

describe("result hub routing", () => {
  it("rejects shares until setup has published ready hubs", async () => {
    saved.set(`${POSTS_KEY}:ai`, ai.id);
    await expect(resultHub(resultPayload)).rejects.toThrow("being prepared");
  });

  it.each([
    "not json",
    "null",
    "{}",
    JSON.stringify({
      game: "t3_game",
      ai: "t3_ai",
      h2h: "t3_h2h",
      gamePermalink: "https://example.com/",
    }),
    JSON.stringify({
      game: "t3_game",
      ai: "invalid",
      h2h: "t3_h2h",
      gamePermalink: "/r/EuclidTheGame/comments/game/",
    }),
    JSON.stringify({
      game: "t3_game",
      ai: "t3_ai",
      h2h: "t3_ai",
      gamePermalink: "/r/EuclidTheGame/comments/game/",
    }),
    JSON.stringify({
      game: "t3_game",
      ai: "t3_ai",
      h2h: "t3_h2h",
      gamePermalink: "/r/AnotherCommunity/comments/game/",
    }),
  ])(
    "rejects corrupt or unsafe ready configuration %s without Reddit reads",
    async (raw) => {
      saved.set(POSTS_KEY, raw);
      await expect(resultHub(resultPayload)).rejects.toThrow("being prepared");
      expect(mocks.reddit.getPostById).not.toHaveBeenCalled();
    },
  );

  it.each<[ResultSharePayload, string]>([
    [resultPayload, "t3_ai"],
    [{ ...resultPayload, mode: "h2h" }, "t3_h2h"],
  ])("routes %j to %s", async (payload, expectedId) => {
    saved.set(
      POSTS_KEY,
      JSON.stringify({
        game: game.id,
        gamePermalink: game.permalink,
        ai: ai.id,
        h2h: h2h.id,
      }),
    );
    expect(await resultHub(payload)).toEqual({
      postId: expectedId,
      gamePermalink: game.permalink,
    });
    expect(mocks.reddit.submitPost).not.toHaveBeenCalled();
  });
});
