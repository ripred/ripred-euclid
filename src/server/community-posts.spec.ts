import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RESULT_HUB_TITLES } from "../shared/result-sharing";
import type { SharedPostPayload } from "../shared/types/api";
import { resultHub, setupCommunityPosts } from "./community-posts";
import { COMMUNITY_POSTS_KEY as POSTS_KEY } from "./community-post-keys";

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
vi.mock("./post-presentation", () => ({
  communityPostStyles: mocks.communityPostStyles,
}));

const makePost = (
  id: `t3_${string}`,
  title: string,
  authorName = "ripred-euclid",
) => ({
  id,
  title,
  authorName,
  subredditName: "EuclidTheGame",
  removed: false,
  archived: false,
  removedByCategory: undefined as string | undefined,
  permalink: `/r/EuclidTheGame/comments/${id.slice(3)}`,
  lock: vi.fn().mockResolvedValue(undefined),
  setSuggestedCommentSort: vi.fn().mockResolvedValue(undefined),
});
type TestPost = ReturnType<typeof makePost>;
let saved: Map<string, string>;
let recent: TestPost[];
let game: TestPost;
let ai: TestPost;
let h2h: TestPost;

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
  mocks.redis.get.mockImplementation(async (key: string) => saved.get(key));
  mocks.redis.set.mockImplementation(persist);
  mocks.redis.del.mockImplementation(async (key: string) => saved.delete(key));
  mocks.reddit.getNewPosts.mockImplementation(() => ({
    all: async () => recent,
  }));
  mocks.reddit.getPostById.mockImplementation(async (id: string) => {
    const post = (
      { t3_game: game, t3_ai: ai, t3_h2h: h2h } as Record<string, TestPost>
    )[id];
    if (!post) throw new Error("Post not found");
    return post;
  });
  mocks.createPost.mockImplementation(async () => {
    recent.unshift(game);
    return game;
  });
  mocks.prepareGamePost.mockResolvedValue(mocks.createPost);
  mocks.reddit.submitPost.mockImplementation(async ({ title }) => {
    const post = title === RESULT_HUB_TITLES.ai ? ai : h2h;
    recent.unshift(post);
    return post;
  });
  mocks.ensurePostHighlighted.mockResolvedValue(true);
  mocks.communityPostStyles.mockResolvedValue({});
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

afterEach(() => vi.restoreAllMocks());

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

  it("creates missing app-authored hubs once, with a link to the canonical game", async () => {
    recent = [];
    await setupCommunityPosts();
    await setupCommunityPosts();
    expect(mocks.createPost).toHaveBeenCalledTimes(1);
    expect(mocks.reddit.submitPost).toHaveBeenCalledTimes(2);
    for (const title of Object.values(RESULT_HUB_TITLES)) {
      expect(mocks.reddit.submitPost).toHaveBeenCalledWith({
        subredditName: "EuclidTheGame",
        title,
        text: expect.stringContaining(`[Play Euclid](${game.permalink})`),
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
    expect(saved.get(`${POSTS_KEY}:ai:creating`)).toBe("pending");
    expect(saved.has(POSTS_KEY)).toBe(false);
    await setupCommunityPosts();
    expect(
      mocks.reddit.submitPost.mock.calls.map(([post]) => post.title),
    ).toEqual([RESULT_HUB_TITLES.ai, RESULT_HUB_TITLES.h2h]);
    expect(saved.get(`${POSTS_KEY}:ai`)).toBe(ai.id);
  });

  it("does not repeat an uncertain submission while no created post is visible", async () => {
    recent = [game];
    mocks.reddit.submitPost.mockRejectedValueOnce(new Error("response lost"));
    await expect(setupCommunityPosts()).rejects.toThrow("response lost");
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

  it("retries a definitely rejected submission after releasing its claim", async () => {
    recent = [game];
    mocks.reddit.submitPost.mockRejectedValueOnce(
      new Error("post submission failed: RATELIMIT"),
    );
    await expect(setupCommunityPosts()).rejects.toThrow("RATELIMIT");
    expect(saved.has(`${POSTS_KEY}:ai:creating`)).toBe(false);
    await setupCommunityPosts();
    expect(mocks.reddit.submitPost).toHaveBeenCalledTimes(3);
  });

  it("retains the claim when a submitted post's follow-up read fails", async () => {
    recent = [game];
    mocks.reddit.submitPost.mockRejectedValueOnce(
      Object.assign(new Error("Post read forbidden"), { code: 7 }),
    );
    await expect(setupCommunityPosts()).rejects.toThrow("Post read forbidden");
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
      textFallback: { text: expect.stringContaining("Open the post") },
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
} satisfies SharedPostPayload;

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

  it.each<[SharedPostPayload, string]>([
    [resultPayload, "t3_ai"],
    [{ ...resultPayload, mode: "h2h" }, "t3_h2h"],
    [{ ...basePayload, kind: "rankings", bucket: "hva", rows: [] }, "t3_ai"],
    [{ ...basePayload, kind: "rankings", bucket: "hvh", rows: [] }, "t3_h2h"],
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
