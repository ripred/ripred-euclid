import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RESULT_HUB_TITLES } from "../shared/result-sharing";
import type { ResultSharePayload } from "../shared/types/api";
import { resultHub, setupCommunityPosts } from "./community-posts";
import { COMMUNITY_POSTS_KEY as POSTS_KEY } from "./community-post-keys";
import {
  gamePostContent,
  isResultHubText,
  RESULT_HUB_DESCRIPTIONS,
  RESULT_HUB_HEADING,
  resultHubBody,
} from "./community-post-content";

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
  communityBannerImage: vi.fn(),
}));

vi.mock("@devvit/web/server", () => mocks);
vi.mock("./core/post", () => ({ prepareGamePost: mocks.prepareGamePost }));
vi.mock("./post-highlights", () => ({
  ensurePostHighlighted: mocks.ensurePostHighlighted,
}));
vi.mock("./post-presentation", async (importActual) => ({
  ...(await importActual<typeof import("./post-presentation")>()),
  communityPostStyles: mocks.communityPostStyles,
  communityBannerImage: mocks.communityBannerImage,
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
    url: `https://www.reddit.com/r/EuclidTheGame/comments/${id.slice(3)}`,
    numberOfComments: 0,
    body: "" as string | undefined,
    edit: vi.fn(async (content: { text: string } | { richtext: object }) => {
      post.body = "text" in content ? content.text : render(content.richtext);
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
/** Reddit renders rich text as its own Markdown; any rendering keeps the text. */
const render = (richtext: object) => JSON.stringify(richtext);
const hubBody = (kind: "ai" | "h2h", banner = bannerUrl) =>
  resultHubBody(kind, game.permalink, banner);
/** Records a hub body as setup writes it, so the hub needs no edit. */
const markWritten = (kind: "ai" | "h2h", hub: TestPost) =>
  saved.set(
    `${POSTS_KEY}:${kind}:body`,
    JSON.stringify({
      postId: hub.id,
      body: JSON.stringify(hubBody(kind)),
    }),
  );
let saved: Map<string, string>;
let recent: TestPost[];
let game: TestPost;
let ai: TestPost;
let h2h: TestPost;
let available: Map<string, TestPost>;
const iconStyles = { shareImageUrl: "https://i.redd.it/icon.png" };
const bannerUrl = "https://i.redd.it/banner.png";

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
  ai.body = render(hubBody("ai"));
  h2h.body = render(hubBody("h2h"));
  markWritten("ai", ai);
  markWritten("h2h", h2h);
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
  mocks.reddit.submitPost.mockImplementation(async ({ title, richtext }) => {
    const old = title === RESULT_HUB_TITLES.ai ? ai : h2h;
    const post = isResultHubText(old.body)
      ? old
      : makePost(`${old.id}text`, title);
    post.body = render(richtext);
    available.set(post.id, post);
    recent.unshift(post);
    return post;
  });
  mocks.ensurePostHighlighted.mockResolvedValue(true);
  mocks.communityPostStyles.mockResolvedValue(iconStyles);
  mocks.communityBannerImage.mockResolvedValue(bannerUrl);
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

  it("creates missing text hubs once with bodies describing them", async () => {
    recent = [];
    await setupCommunityPosts();
    await setupCommunityPosts();
    expect(mocks.createPost).toHaveBeenCalledTimes(1);
    expect(mocks.reddit.submitPost).toHaveBeenCalledTimes(2);
    for (const kind of ["ai", "h2h"] as const) {
      expect(mocks.reddit.submitPost).toHaveBeenCalledWith({
        subredditName: "EuclidTheGame",
        title: RESULT_HUB_TITLES[kind],
        richtext: hubBody(kind),
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
    expect(saved.get(`${POSTS_KEY}:ai:text-v2:creating`)).toBe("pending");
    expect(saved.has(POSTS_KEY)).toBe(true);
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
    expect(mocks.reddit.getNewPosts).toHaveBeenCalledTimes(1);
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
    expect(saved.has(`${POSTS_KEY}:ai:text-v2:creating`)).toBe(false);
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

  it("keeps the playable post icon and hub banner separate without replacing or appending content", async () => {
    const styles = { shareImageUrl: "https://i.redd.it/icon.png" };
    mocks.communityPostStyles.mockResolvedValue(styles);
    mocks.reddit.getPostStyles.mockResolvedValue(styles);
    const posts = await setupCommunityPosts();
    recent = [];
    expect(await setupCommunityPosts()).toEqual(posts);
    for (const hub of [ai, h2h]) {
      expect(hub.edit).not.toHaveBeenCalled();
      expect(hub.setTextFallback).not.toHaveBeenCalled();
      expect(hub.body).toContain(bannerUrl);
      expect(hub.body).not.toContain(styles.shareImageUrl);
    }
    expect(mocks.communityBannerImage.mock.calls).toEqual([[true], [true]]);
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

  it.each(["icon", "banner", "game"])(
    "propagates %s presentation failure while retaining working hub routing",
    async (failure) => {
      const error = new Error("Presentation unavailable");
      if (failure === "icon")
        mocks.communityPostStyles.mockRejectedValueOnce(error);
      else if (failure === "banner")
        mocks.communityBannerImage.mockRejectedValueOnce(error);
      else game.setTextFallback.mockRejectedValueOnce(error);
      await expect(setupCommunityPosts()).rejects.toBe(error);
      expect(await resultHub(resultPayload)).toEqual({
        postId: ai.id,
        gamePermalink: game.permalink,
      });
      expect(ai.lock).toHaveBeenCalledOnce();
      expect(h2h.lock).toHaveBeenCalledOnce();
      expect(ai.edit).not.toHaveBeenCalled();
      expect(h2h.edit).not.toHaveBeenCalled();
      expect(ai.remove).not.toHaveBeenCalled();
      expect(h2h.remove).not.toHaveBeenCalled();
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

describe("text hub migration", () => {
  function useImageHubs() {
    for (const hub of [ai, h2h]) {
      hub.url = `https://i.redd.it/${hub.id}.png`;
      hub.body = "";
    }
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

  it("publishes both text hubs together before removing the image hubs", async () => {
    const old = useImageHubs();
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
        expect(route).toMatchObject({ ai: "t3_aitext", h2h: "t3_h2htext" });
        expect(available.get(route.ai)!.lock).toHaveBeenCalledOnce();
        expect(
          available.get(route.h2h)!.setSuggestedCommentSort,
        ).toHaveBeenCalledWith("NEW");
        post.removed = true;
      });
    const next = await setupCommunityPosts();
    expect(next.game).toBe(old.game);
    expect(next.ai).toBe("t3_aitext");
    expect(next.h2h).toBe("t3_h2htext");
    expect(available.get(next.ai)!.body).toBe(render(hubBody("ai")));
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

  it("removes replaced hubs even when they hold shared results", async () => {
    useImageHubs();
    ai.numberOfComments = 3;
    const next = await setupCommunityPosts();
    expect(next.ai).toBe("t3_aitext");
    expect(ai.remove).toHaveBeenCalledOnce();
  });

  it("removes earlier text hubs that lack the current description", async () => {
    const first = makePost("t3_firstai", RESULT_HUB_TITLES.ai);
    first.body = "Game results shared from Euclid appear below, newest first.";
    first.numberOfComments = 2;
    recent.push(first);
    available.set(first.id, first);
    const next = await setupCommunityPosts();
    expect(next.ai).toBe(ai.id);
    expect(first.remove).toHaveBeenCalledOnce();
    expect(ai.remove).not.toHaveBeenCalled();
    expect(mocks.reddit.submitPost).not.toHaveBeenCalled();
  });

  it("never adopts an earlier text hub as the current one", async () => {
    recent = [game];
    const first = makePost("t3_firstai", RESULT_HUB_TITLES.ai);
    first.body = "Game results shared from Euclid appear below, newest first.";
    recent.push(first);
    available.set(first.id, first);
    const next = await setupCommunityPosts();
    expect(next.ai).not.toBe(first.id);
    expect(first.remove).toHaveBeenCalledOnce();
  });

  it("updates a current hub's body when its description or banner changes", async () => {
    saved.set(
      `${POSTS_KEY}:ai:body`,
      JSON.stringify({ postId: ai.id, body: "An older description" }),
    );
    await setupCommunityPosts();
    await setupCommunityPosts();
    expect(ai.edit).toHaveBeenCalledExactlyOnceWith({
      richtext: hubBody("ai"),
    });
    expect(h2h.edit).not.toHaveBeenCalled();
    expect(mocks.reddit.submitPost).not.toHaveBeenCalled();
    expect(ai.remove).not.toHaveBeenCalled();
  });

  it("updates legacy heading bodies in place and preserves their results beyond the newest 100 posts", async () => {
    const posts = {
      game: game.id,
      gamePermalink: game.permalink,
      ai: ai.id,
      h2h: h2h.id,
    };
    saved.set(POSTS_KEY, JSON.stringify(posts));
    saved.set(`${POSTS_KEY}:game`, game.id);
    for (const [kind, hub, count] of [
      ["ai", ai, 7],
      ["h2h", h2h, 11],
    ] as const) {
      hub.body = `## ${RESULT_HUB_HEADING}\n\nEarlier result description.`;
      hub.numberOfComments = count;
      saved.set(`${POSTS_KEY}:${kind}`, hub.id);
      saved.set(
        `${POSTS_KEY}:${kind}:body`,
        JSON.stringify({ postId: hub.id, body: hub.body }),
      );
    }
    recent = Array.from({ length: 100 }, (_, index) =>
      makePost(`t3_new${index}`, "Community discussion", "community-member"),
    );

    expect(await setupCommunityPosts()).toEqual(posts);
    expect(await setupCommunityPosts()).toEqual(posts);

    expect(mocks.reddit.getNewPosts).toHaveBeenCalledWith({
      subredditName: "EuclidTheGame",
      limit: 100,
    });
    for (const [kind, hub, count] of [
      ["ai", ai, 7],
      ["h2h", h2h, 11],
    ] as const) {
      expect(hub.edit).toHaveBeenCalledExactlyOnceWith({
        richtext: hubBody(kind),
      });
      expect(hub.body).toContain(RESULT_HUB_DESCRIPTIONS[kind]);
      expect(hub.numberOfComments).toBe(count);
      expect(hub.remove).not.toHaveBeenCalled();
      expect(hub.setTextFallback).not.toHaveBeenCalled();
      expect(hub.lock).toHaveBeenCalledTimes(2);
      expect(hub.setSuggestedCommentSort.mock.calls).toEqual([
        ["NEW"],
        ["NEW"],
      ]);
      expect(await resultHub({ ...resultPayload, mode: kind })).toEqual({
        postId: hub.id,
        gamePermalink: game.permalink,
      });
    }
    expect(mocks.reddit.submitPost).not.toHaveBeenCalled();
    expect(mocks.reddit.submitCustomPost).not.toHaveBeenCalled();
    expect(mocks.createPost).not.toHaveBeenCalled();
    expect(JSON.parse(saved.get(POSTS_KEY)!)).toEqual(posts);
  });

  it("reads the freshly saved description before recording the body cache", async () => {
    const bodyKey = `${POSTS_KEY}:ai:body`;
    const legacyBody = `## ${RESULT_HUB_HEADING}\n\nEarlier result description.`;
    ai.body = legacyBody;
    saved.delete(bodyKey);
    let edited = false;
    let readBack = false;
    ai.edit.mockImplementation(async () => {
      edited = true;
    });
    const readPost = mocks.reddit.getPostById.getMockImplementation()!;
    mocks.reddit.getPostById.mockImplementation(async (id: string) => {
      if (id === ai.id && edited) {
        readBack = true;
        return { ...ai, body: render(hubBody("ai")) };
      }
      return readPost(id);
    });
    mocks.redis.set.mockImplementation(async (key, value, options) => {
      if (key === bodyKey) expect(readBack).toBe(true);
      return persist(key, value, options);
    });

    const posts = await setupCommunityPosts();

    expect(posts.ai).toBe(ai.id);
    expect(readBack).toBe(true);
    expect(ai.body).toBe(legacyBody);
    expect(JSON.parse(saved.get(bodyKey)!)).toEqual({
      postId: ai.id,
      body: JSON.stringify(hubBody("ai")),
    });
    expect(mocks.reddit.submitPost).not.toHaveBeenCalled();
    expect(ai.remove).not.toHaveBeenCalled();
  });

  it.each(["", RESULT_HUB_HEADING, RESULT_HUB_DESCRIPTIONS.h2h])(
    "does not cache an edit whose fresh readback lacks the correct description: %j",
    async (readback) => {
      const posts = await setupCommunityPosts();
      const bodyKey = `${POSTS_KEY}:ai:body`;
      const previousCache = JSON.stringify({
        postId: ai.id,
        body: "Earlier body",
      });
      saved.set(bodyKey, previousCache);
      let edited = false;
      ai.edit.mockImplementation(async () => {
        edited = true;
      });
      const readPost = mocks.reddit.getPostById.getMockImplementation()!;
      mocks.reddit.getPostById.mockImplementation(async (id: string) =>
        id === ai.id && edited ? { ...ai, body: readback } : readPost(id),
      );

      await expect(setupCommunityPosts()).rejects.toThrow(
        "description was not saved",
      );

      expect(edited).toBe(true);
      expect(saved.get(bodyKey)).toBe(previousCache);
      expect(JSON.parse(saved.get(POSTS_KEY)!)).toEqual(posts);
      expect(await resultHub(resultPayload)).toMatchObject({ postId: ai.id });
      expect(mocks.reddit.submitPost).not.toHaveBeenCalled();
      expect(ai.remove).not.toHaveBeenCalled();
      expect(h2h.remove).not.toHaveBeenCalled();
    },
  );

  it("updates both hub banners independently of the playable post icon", async () => {
    const nextBanner = "https://i.redd.it/replacement-banner.png";
    mocks.communityBannerImage.mockResolvedValue(nextBanner);

    await setupCommunityPosts();
    await setupCommunityPosts();

    for (const [kind, hub] of [
      ["ai", ai],
      ["h2h", h2h],
    ] as const) {
      expect(hub.edit).toHaveBeenCalledExactlyOnceWith({
        richtext: hubBody(kind, nextBanner),
      });
      expect(hub.body).toContain(nextBanner);
      expect(hub.body).not.toContain(iconStyles.shareImageUrl);
    }
    expect(game.setTextFallback).toHaveBeenCalledExactlyOnceWith(
      gamePostContent(iconStyles.shareImageUrl),
    );
    expect(mocks.reddit.setPostStyles.mock.calls).toEqual([
      [game.id, iconStyles],
      [game.id, iconStyles],
    ]);
  });

  it("keeps a hub's body while the banner is unavailable, then restores the banner", async () => {
    const originalBody = ai.body;
    mocks.communityBannerImage.mockRejectedValueOnce(new Error("Banner down"));
    await expect(setupCommunityPosts()).rejects.toThrow("Banner down");
    expect(ai.edit).not.toHaveBeenCalled();
    expect(ai.body).toBe(originalBody);
    expect(saved.has(POSTS_KEY)).toBe(true);
    // A hub first written while the community had no banner.
    saved.set(
      `${POSTS_KEY}:ai:body`,
      JSON.stringify({
        postId: ai.id,
        body: JSON.stringify(resultHubBody("ai", game.permalink)),
      }),
    );
    mocks.communityBannerImage.mockResolvedValue(bannerUrl);
    await setupCommunityPosts();
    expect(ai.edit).toHaveBeenCalledExactlyOnceWith({
      richtext: hubBody("ai"),
    });
  });

  it.each(["missing", "corrupt", "another hub", "stale body"] as const)(
    "preserves a current hub without a banner when its body cache is %s",
    async (state) => {
      const bodyKey = `${POSTS_KEY}:ai:body`;
      const cached = {
        missing: undefined,
        corrupt: "{",
        "another hub": JSON.stringify({
          postId: h2h.id,
          body: JSON.stringify(hubBody("h2h")),
        }),
        "stale body": JSON.stringify({
          postId: ai.id,
          body: "An older description",
        }),
      }[state];
      if (cached === undefined) saved.delete(bodyKey);
      else saved.set(bodyKey, cached);
      const existingBody = ai.body;
      mocks.communityBannerImage.mockResolvedValue(undefined);

      await setupCommunityPosts();
      await setupCommunityPosts();

      expect(ai.body).toBe(existingBody);
      expect(ai.edit).not.toHaveBeenCalled();
      expect(saved.get(bodyKey)).toBe(cached);
      expect(mocks.reddit.submitPost).not.toHaveBeenCalled();
    },
  );

  it("preserves an edited hub during a banner outage after saving its body cache fails", async () => {
    const bodyKey = `${POSTS_KEY}:ai:body`;
    saved.delete(bodyKey);
    const nextBanner = "https://i.redd.it/new-banner.png";
    mocks.communityBannerImage.mockResolvedValue(nextBanner);
    mocks.redis.set.mockImplementation(async (key, value, options) => {
      if (key === bodyKey) throw new Error("Body cache unavailable");
      return persist(key, value, options);
    });
    await expect(setupCommunityPosts()).rejects.toThrow(
      "Body cache unavailable",
    );
    const editedBody = render(hubBody("ai", nextBanner));
    expect(ai.body).toBe(editedBody);
    expect(saved.has(bodyKey)).toBe(false);

    mocks.communityBannerImage.mockRejectedValueOnce(new Error("Banner down"));
    await expect(setupCommunityPosts()).rejects.toThrow("Banner down");

    expect(ai.body).toBe(editedBody);
    expect(ai.edit).toHaveBeenCalledExactlyOnceWith({
      richtext: hubBody("ai", nextBanner),
    });
    expect(saved.has(bodyKey)).toBe(false);
    expect(await resultHub(resultPayload)).toMatchObject({ postId: ai.id });
    expect(mocks.reddit.submitPost).not.toHaveBeenCalled();
  });

  it("puts the community banner first followed by one short paragraph", () => {
    expect(hubBody("ai").document[0]).toEqual({
      e: "img",
      mediaUrl: bannerUrl,
    });
    expect(hubBody("ai").document).toHaveLength(2);
    expect(hubBody("ai").document[1]).toMatchObject({ e: "par" });
    expect(render(hubBody("ai"))).toContain(RESULT_HUB_DESCRIPTIONS.ai);
    expect(render(hubBody("h2h"))).toContain(RESULT_HUB_DESCRIPTIONS.h2h);
    expect(render(hubBody("ai"))).not.toContain(RESULT_HUB_HEADING);
    expect(render(hubBody("ai"))).toContain("Play Euclid");
  });

  it("retains the claim and old routing after an uncertain text submission", async () => {
    const old = useImageHubs();
    const failure = new Error("response lost");
    mocks.reddit.submitPost.mockRejectedValueOnce(failure);
    await expect(setupCommunityPosts()).rejects.toBe(failure);
    await expect(setupCommunityPosts()).rejects.toThrow("already pending");
    expect(mocks.reddit.submitPost).toHaveBeenCalledTimes(1);
    expect(saved.get(`${POSTS_KEY}:ai:text-v2:creating`)).toBe("pending");
    expect(JSON.parse(saved.get(POSTS_KEY)!)).toEqual(old);
    expect(ai.remove).not.toHaveBeenCalled();
    expect(h2h.remove).not.toHaveBeenCalled();
  });

  it("validates a submitted hub before changing routing", async () => {
    const old = useImageHubs();
    const submit = mocks.reddit.submitPost.getMockImplementation()!;
    mocks.reddit.submitPost.mockImplementationOnce(async (options) => {
      const post = await submit(options);
      post.subredditName = "AnotherCommunity";
      return post;
    });
    await expect(setupCommunityPosts()).rejects.toThrow(
      "Invalid or unavailable",
    );
    expect(JSON.parse(saved.get(POSTS_KEY)!)).toEqual(old);
    expect(ai.remove).not.toHaveBeenCalled();
    expect(h2h.remove).not.toHaveBeenCalled();
  });

  it("does not adopt another author's text hub after an uncertain submission", async () => {
    const old = useImageHubs();
    const failure = new Error("response lost");
    mocks.reddit.submitPost.mockImplementationOnce(async () => {
      const foreign = makePost(
        "t3_foreign",
        RESULT_HUB_TITLES.ai,
        "another-user",
      );
      foreign.body = render(hubBody("ai"));
      recent.unshift(foreign);
      throw failure;
    });
    await expect(setupCommunityPosts()).rejects.toBe(failure);
    await expect(setupCommunityPosts()).rejects.toThrow("already pending");
    expect(mocks.reddit.submitPost).toHaveBeenCalledTimes(1);
    expect(JSON.parse(saved.get(POSTS_KEY)!)).toEqual(old);
  });

  it("retains old routing if replacement configuration fails, then adopts on retry", async () => {
    const old = useImageHubs();
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
    const old = useImageHubs();
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
      useImageHubs();
      if (missingKeys) {
        saved.delete(`${POSTS_KEY}:ai`);
        saved.delete(`${POSTS_KEY}:h2h`);
      }
      ai.remove.mockRejectedValueOnce(new Error("Removal unavailable"));
      await expect(setupCommunityPosts()).rejects.toThrow(
        "Removal unavailable",
      );
      expect(JSON.parse(saved.get(POSTS_KEY)!)).toMatchObject({
        ai: "t3_aitext",
        h2h: "t3_h2htext",
      });
      expect(saved.get(`${POSTS_KEY}:ai`)).toBe(ai.id);
      await setupCommunityPosts();
      expect(mocks.reddit.submitPost).toHaveBeenCalledTimes(2);
      expect(ai.remove).toHaveBeenCalledTimes(2);
      expect(h2h.remove).toHaveBeenCalledOnce();
    },
  );

  it("does not remove twice when cleanup succeeded but saving the new canonical ID failed", async () => {
    useImageHubs();
    let fail = true;
    mocks.redis.set.mockImplementation(async (key, value, options) => {
      if (key === `${POSTS_KEY}:ai` && value === "t3_aitext" && fail) {
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
    expect(saved.get(`${POSTS_KEY}:ai`)).toBe("t3_aitext");
  });

  it("creates text hubs without a community banner", async () => {
    useImageHubs();
    mocks.communityBannerImage.mockResolvedValue(undefined);
    const next = await setupCommunityPosts();
    expect(next.ai).toBe("t3_aitext");
    expect(available.get(next.ai)!.body).toBe(
      render(resultHubBody("ai", game.permalink)),
    );
    expect(available.get(next.ai)!.edit).not.toHaveBeenCalled();
    expect(available.get(next.h2h)!.edit).not.toHaveBeenCalled();
    expect(await setupCommunityPosts()).toEqual(next);
    expect(mocks.reddit.submitPost).toHaveBeenCalledTimes(2);
  });

  it("refuses to remove a retired post whose ownership changed", async () => {
    useImageHubs();
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
