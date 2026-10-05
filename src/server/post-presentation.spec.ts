import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  communityBannerImage,
  communityPostStyles,
  updateGamePostContent,
} from "./post-presentation";

const mocks = vi.hoisted(() => ({
  context: { subredditId: "t5_euclid" },
  redis: { get: vi.fn(), set: vi.fn(), del: vi.fn() },
  reddit: { getSubredditStyles: vi.fn() },
  media: { upload: vi.fn() },
}));
vi.mock("@devvit/web/server", () => mocks);

const ICON_KEY = "euclid:community-post-icon:v1";
const BANNER_KEY = "euclid:community-post-banner:v1";
const firstSource = "https://styles.redditmedia.com/first.png";
const firstUpload = "https://i.redd.it/first.png";
const firstBannerSource = "https://styles.redditmedia.com/banner.png";
const firstBannerUpload = "https://i.redd.it/banner.png";
const saved = new Map<string, string>();

beforeEach(() => {
  vi.resetAllMocks();
  saved.clear();
  mocks.redis.get.mockImplementation(async (key: string) => saved.get(key));
  mocks.redis.set.mockImplementation(async (key: string, value: string) => {
    saved.set(key, value);
    return "OK";
  });
  mocks.redis.del.mockImplementation(async (key: string) => {
    saved.delete(key);
  });
  mocks.reddit.getSubredditStyles.mockResolvedValue({ icon: firstSource });
  mocks.media.upload.mockResolvedValue({ mediaUrl: firstUpload });
});

describe("community post images", () => {
  it("uploads the community icon once and uses its cached Reddit image thereafter", async () => {
    expect(await communityPostStyles()).toEqual({ shareImageUrl: firstUpload });
    expect(await communityPostStyles()).toEqual({ shareImageUrl: firstUpload });
    expect(mocks.reddit.getSubredditStyles).toHaveBeenCalledExactlyOnceWith(
      "t5_euclid",
    );
    expect(mocks.media.upload).toHaveBeenCalledExactlyOnceWith({
      url: firstSource,
      type: "image",
    });
    expect(mocks.redis.set).toHaveBeenCalledExactlyOnceWith(
      ICON_KEY,
      JSON.stringify({ source: firstSource, shareImageUrl: firstUpload }),
    );
  });

  it("refreshes the source but reuses an unchanged icon after decoding URL separators", async () => {
    const source = `${firstSource}?width=256&format=png`;
    saved.set(ICON_KEY, JSON.stringify({ source, shareImageUrl: firstUpload }));
    mocks.reddit.getSubredditStyles.mockResolvedValue({
      icon: `${firstSource}?width=256&amp;format=png`,
    });
    expect(await communityPostStyles(true)).toEqual({
      shareImageUrl: firstUpload,
    });
    expect(mocks.reddit.getSubredditStyles).toHaveBeenCalledTimes(1);
    expect(mocks.media.upload).not.toHaveBeenCalled();
    expect(mocks.redis.set).not.toHaveBeenCalled();
  });

  it("uploads and remembers a changed community icon during refresh", async () => {
    saved.set(
      ICON_KEY,
      JSON.stringify({ source: firstSource, shareImageUrl: firstUpload }),
    );
    const newSource = "https://styles.redditmedia.com/second.png?x=1&y=2";
    const newUpload = "https://i.redd.it/second.png";
    mocks.reddit.getSubredditStyles.mockResolvedValue({
      icon: newSource.replace("&", "&amp;"),
    });
    mocks.media.upload.mockResolvedValue({ mediaUrl: newUpload });
    expect(await communityPostStyles(true)).toEqual({
      shareImageUrl: newUpload,
    });
    expect(mocks.media.upload).toHaveBeenCalledExactlyOnceWith({
      url: newSource,
      type: "image",
    });
    expect(JSON.parse(saved.get(ICON_KEY)!)).toEqual({
      source: newSource,
      shareImageUrl: newUpload,
    });
    expect(await communityPostStyles()).toEqual({ shareImageUrl: newUpload });
    expect(mocks.media.upload).toHaveBeenCalledTimes(1);
  });

  it("does not upload when the community has no icon", async () => {
    mocks.reddit.getSubredditStyles.mockResolvedValue({});
    expect(await communityPostStyles(true)).toEqual({});
    expect(mocks.media.upload).not.toHaveBeenCalled();
    expect(mocks.redis.set).not.toHaveBeenCalled();
  });

  it("preserves the cached icon when uploading its replacement fails", async () => {
    const previous = JSON.stringify({
      source: firstSource,
      shareImageUrl: firstUpload,
    });
    saved.set(ICON_KEY, previous);
    mocks.reddit.getSubredditStyles.mockResolvedValue({
      icon: "https://styles.redditmedia.com/new.png",
    });
    mocks.media.upload.mockRejectedValue(new Error("Media unavailable"));
    await expect(communityPostStyles(true)).rejects.toThrow(
      "Media unavailable",
    );
    expect(saved.get(ICON_KEY)).toBe(previous);
    expect(await communityPostStyles()).toEqual({ shareImageUrl: firstUpload });
  });

  it("clears a removed icon so later post creation cannot reuse its cached URL", async () => {
    saved.set(
      ICON_KEY,
      JSON.stringify({ source: firstSource, shareImageUrl: firstUpload }),
    );
    mocks.reddit.getSubredditStyles.mockResolvedValue({});
    expect(await communityPostStyles(true)).toEqual({});
    expect(saved.get(ICON_KEY)).toBeUndefined();
    expect(await communityPostStyles()).toEqual({});
    expect(mocks.media.upload).not.toHaveBeenCalled();
  });

  it.each([
    "not json",
    "null",
    "{}",
    JSON.stringify({
      source: firstSource,
      shareImageUrl: "https://example.com/icon.png",
    }),
    JSON.stringify({
      source: "https://example.com/icon.png",
      shareImageUrl: firstUpload,
    }),
  ])("refreshes corrupt or untrusted cache data %s", async (raw) => {
    saved.set(ICON_KEY, raw);
    expect(await communityPostStyles()).toEqual({ shareImageUrl: firstUpload });
    expect(mocks.media.upload).toHaveBeenCalledTimes(1);
  });

  it.each([
    "http://styles.redditmedia.com/icon.png",
    "https://styles.redditmedia.com.example.com/icon.png",
    "https://user:password@styles.redditmedia.com/icon.png",
    "https://styles.redditmedia.com:8443/icon.png",
    "https://127.0.0.1/icon.png",
    "not a url",
  ])("rejects unsafe icon source %s before media upload", async (icon) => {
    mocks.reddit.getSubredditStyles.mockResolvedValue({ icon });
    await expect(communityPostStyles(true)).rejects.toThrow("Reddit image URL");
    expect(mocks.media.upload).not.toHaveBeenCalled();
    expect(mocks.redis.set).not.toHaveBeenCalled();
  });

  it.each(["", "http://i.redd.it/icon.png", "https://example.com/icon.png"])(
    "does not cache an invalid uploaded image URL %s",
    async (mediaUrl) => {
      mocks.media.upload.mockResolvedValue({ mediaUrl });
      await expect(communityPostStyles()).rejects.toThrow(
        "valid Reddit image URL",
      );
      expect(saved.get(ICON_KEY)).toBeUndefined();
    },
  );
});

describe("community result-hub banner", () => {
  const iconRecord = JSON.stringify({
    source: firstSource,
    shareImageUrl: firstUpload,
  });
  const bannerRecord = JSON.stringify({
    source: firstBannerSource,
    shareImageUrl: firstBannerUpload,
  });

  beforeEach(() => {
    mocks.reddit.getSubredditStyles.mockResolvedValue({
      icon: firstSource,
      bannerBackgroundImage: firstBannerSource,
    });
    mocks.media.upload.mockImplementation(async ({ url }: { url: string }) => ({
      mediaUrl: url === firstSource ? firstUpload : firstBannerUpload,
    }));
  });

  it("uploads each image to its own cache and reuses both without another lookup", async () => {
    expect(await communityPostStyles()).toEqual({ shareImageUrl: firstUpload });
    expect(await communityBannerImage()).toBe(firstBannerUpload);
    expect(await communityPostStyles()).toEqual({ shareImageUrl: firstUpload });
    expect(await communityBannerImage()).toBe(firstBannerUpload);
    expect(saved).toEqual(
      new Map([
        [ICON_KEY, iconRecord],
        [BANNER_KEY, bannerRecord],
      ]),
    );
    expect(mocks.reddit.getSubredditStyles).toHaveBeenCalledTimes(2);
    expect(mocks.reddit.getSubredditStyles).toHaveBeenNthCalledWith(
      2,
      "t5_euclid",
    );
    expect(mocks.media.upload).toHaveBeenCalledTimes(2);
    expect(mocks.media.upload).toHaveBeenNthCalledWith(2, {
      url: firstBannerSource,
      type: "image",
    });
  });

  it("reuses an unchanged banner after decoding source URL separators", async () => {
    const source = `${firstBannerSource}?width=3168&format=png`;
    saved.set(
      BANNER_KEY,
      JSON.stringify({ source, shareImageUrl: firstBannerUpload }),
    );
    mocks.reddit.getSubredditStyles.mockResolvedValue({
      bannerBackgroundImage: source.replace("&", "&amp;"),
    });
    expect(await communityBannerImage(true)).toBe(firstBannerUpload);
    expect(mocks.media.upload).not.toHaveBeenCalled();
    expect(mocks.redis.set).not.toHaveBeenCalled();
  });

  it("refreshes a changed banner without changing the icon cache", async () => {
    saved.set(ICON_KEY, iconRecord);
    saved.set(BANNER_KEY, bannerRecord);
    const source = "https://styles.redditmedia.com/new-banner.png?x=1&y=2";
    const uploaded = "https://i.redd.it/new-banner.png";
    mocks.reddit.getSubredditStyles.mockResolvedValue({
      icon: firstSource,
      bannerBackgroundImage: source.replace("&", "&amp;"),
    });
    mocks.media.upload.mockResolvedValue({ mediaUrl: uploaded });
    expect(await communityBannerImage()).toBe(firstBannerUpload);
    expect(await communityBannerImage(true)).toBe(uploaded);
    expect(await communityBannerImage()).toBe(uploaded);
    expect(saved.get(ICON_KEY)).toBe(iconRecord);
    expect(saved.get(BANNER_KEY)).toBe(
      JSON.stringify({ source, shareImageUrl: uploaded }),
    );
    expect(mocks.media.upload).toHaveBeenCalledExactlyOnceWith({
      url: source,
      type: "image",
    });
  });

  it("does not use the icon when no banner exists", async () => {
    saved.set(ICON_KEY, iconRecord);
    mocks.reddit.getSubredditStyles.mockResolvedValue({ icon: firstSource });
    expect(await communityBannerImage()).toBeUndefined();
    expect(mocks.media.upload).not.toHaveBeenCalled();
    expect(mocks.redis.set).not.toHaveBeenCalled();
    expect(mocks.redis.del).not.toHaveBeenCalled();
    expect(saved.get(ICON_KEY)).toBe(iconRecord);
  });

  it("clears only a removed banner and never falls back to the existing icon", async () => {
    saved.set(ICON_KEY, iconRecord);
    saved.set(BANNER_KEY, bannerRecord);
    mocks.reddit.getSubredditStyles.mockResolvedValue({ icon: firstSource });
    expect(await communityBannerImage(true)).toBeUndefined();
    expect(await communityBannerImage()).toBeUndefined();
    expect(saved.get(BANNER_KEY)).toBeUndefined();
    expect(saved.get(ICON_KEY)).toBe(iconRecord);
    expect(mocks.redis.del).toHaveBeenCalledExactlyOnceWith(BANNER_KEY);
    expect(mocks.media.upload).not.toHaveBeenCalled();
  });

  it.each(["lookup", "upload", "cache"] as const)(
    "preserves both caches when banner replacement fails during %s",
    async (stage) => {
      saved.set(ICON_KEY, iconRecord);
      saved.set(BANNER_KEY, bannerRecord);
      mocks.reddit.getSubredditStyles.mockResolvedValue({
        bannerBackgroundImage: "https://styles.redditmedia.com/replacement.png",
      });
      const error = new Error(`${stage} unavailable`);
      if (stage === "lookup")
        mocks.reddit.getSubredditStyles.mockRejectedValue(error);
      if (stage === "upload") mocks.media.upload.mockRejectedValue(error);
      if (stage === "cache") mocks.redis.set.mockRejectedValue(error);
      await expect(communityBannerImage(true)).rejects.toThrow(error);
      expect(saved.get(ICON_KEY)).toBe(iconRecord);
      expect(saved.get(BANNER_KEY)).toBe(bannerRecord);
      expect(await communityBannerImage()).toBe(firstBannerUpload);
      expect(mocks.redis.del).not.toHaveBeenCalled();
    },
  );

  it.each([
    "http://styles.redditmedia.com/banner.png",
    "https://styles.redditmedia.com.example.com/banner.png",
    "https://user:password@styles.redditmedia.com/banner.png",
    "https://styles.redditmedia.com:8443/banner.png",
    "https://127.0.0.1/banner.png",
    "https://styles.redditmedia.com/",
    "not a url",
  ])(
    "rejects unsafe banner source %s without replacing cached images",
    async (bannerBackgroundImage) => {
      saved.set(ICON_KEY, iconRecord);
      saved.set(BANNER_KEY, bannerRecord);
      mocks.reddit.getSubredditStyles.mockResolvedValue({
        icon: firstSource,
        bannerBackgroundImage,
      });
      await expect(communityBannerImage(true)).rejects.toThrow(
        "community banner must use a Reddit image URL",
      );
      expect(mocks.media.upload).not.toHaveBeenCalled();
      expect(mocks.redis.set).not.toHaveBeenCalled();
      expect(saved.get(ICON_KEY)).toBe(iconRecord);
      expect(saved.get(BANNER_KEY)).toBe(bannerRecord);
    },
  );

  it.each([
    "",
    "http://i.redd.it/banner.png",
    "https://styles.redditmedia.com/banner.png",
  ])(
    "preserves the existing banner when its uploaded URL is invalid: %s",
    async (mediaUrl) => {
      saved.set(BANNER_KEY, bannerRecord);
      mocks.reddit.getSubredditStyles.mockResolvedValue({
        bannerBackgroundImage: "https://styles.redditmedia.com/replacement.png",
      });
      mocks.media.upload.mockResolvedValue({ mediaUrl });
      await expect(communityBannerImage(true)).rejects.toThrow(
        "uploaded community banner has no valid Reddit image URL",
      );
      expect(saved.get(BANNER_KEY)).toBe(bannerRecord);
      expect(mocks.redis.set).not.toHaveBeenCalled();
    },
  );

  it("refreshes an untrusted banner cache without altering the icon", async () => {
    saved.set(ICON_KEY, iconRecord);
    saved.set(
      BANNER_KEY,
      JSON.stringify({
        source: firstBannerSource,
        shareImageUrl: "https://example.com/banner.png",
      }),
    );
    expect(await communityBannerImage()).toBe(firstBannerUpload);
    expect(saved.get(BANNER_KEY)).toBe(bannerRecord);
    expect(saved.get(ICON_KEY)).toBe(iconRecord);
    expect(mocks.media.upload).toHaveBeenCalledExactlyOnceWith({
      url: firstBannerSource,
      type: "image",
    });
  });
});

describe("community post body verification", () => {
  const content = {
    text: "[Euclid](https://i.redd.it/icon.png)\n\nGame description.",
  };
  const makePost = () => {
    const post = {
      id: "t3_game" as const,
      body: "Old body",
      setTextFallback: vi.fn(async ({ text }: { text: string }) => {
        post.body = text;
      }),
      edit: vi.fn(async ({ text }: { text: string }) => {
        post.body = text;
      }),
    };
    return post;
  };

  it.each([
    "",
    "\n\n* * *\nThis post contains content not supported on old Reddit. [Click here](https://sh.reddit.com/r/EuclidTheGame/comments/game)",
  ])(
    "accepts verified fallback with Reddit suffix %j and avoids rewriting it",
    async (suffix) => {
      const post = makePost();
      post.setTextFallback.mockImplementation(async ({ text }) => {
        post.body = text + suffix;
      });
      await updateGamePostContent(post, content);
      await updateGamePostContent(post, content);
      expect(post.setTextFallback).toHaveBeenCalledExactlyOnceWith(content);
      expect(post.edit).not.toHaveBeenCalled();
    },
  );

  it("repairs a successful setter that loses the requested content with one body edit", async () => {
    const post = makePost();
    post.setTextFallback.mockImplementation(async () => {
      post.body = "This post contains content not supported on old Reddit.";
    });
    await updateGamePostContent(post, content);
    await updateGamePostContent(post, content);
    expect(post.edit).toHaveBeenCalledExactlyOnceWith(content);
    expect(post.setTextFallback).toHaveBeenCalledTimes(1);
  });

  it("does not retry a setter that fails", async () => {
    const post = makePost();
    post.setTextFallback.mockRejectedValue(new Error("Setter unavailable"));
    await expect(updateGamePostContent(post, content)).rejects.toThrow(
      "Setter unavailable",
    );
    expect(post.edit).not.toHaveBeenCalled();
  });

  it("propagates a failed compatibility edit", async () => {
    const post = makePost();
    post.setTextFallback.mockResolvedValue(undefined);
    post.edit.mockRejectedValue(new Error("Edit unavailable"));
    await expect(updateGamePostContent(post, content)).rejects.toThrow(
      "Edit unavailable",
    );
    expect(post.edit).toHaveBeenCalledTimes(1);
  });

  it("rejects content still missing after the compatibility edit", async () => {
    const post = makePost();
    post.setTextFallback.mockResolvedValue(undefined);
    post.edit.mockResolvedValue(undefined);
    await expect(updateGamePostContent(post, content)).rejects.toThrow(
      "content was not saved",
    );
    expect(post.edit).toHaveBeenCalledTimes(1);
  });
});
