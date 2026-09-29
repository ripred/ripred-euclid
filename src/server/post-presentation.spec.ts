import { beforeEach, describe, expect, it, vi } from "vitest";
import { communityPostStyles } from "./post-presentation";

const mocks = vi.hoisted(() => ({
  context: { subredditId: "t5_euclid" },
  redis: { get: vi.fn(), set: vi.fn(), del: vi.fn() },
  reddit: { getSubredditStyles: vi.fn() },
  media: { upload: vi.fn() },
}));
vi.mock("@devvit/web/server", () => mocks);

const ICON_KEY = "euclid:community-post-icon:v1";
const firstSource = "https://styles.redditmedia.com/first.png";
const firstUpload = "https://i.redd.it/first.png";
let saved: string | undefined;

beforeEach(() => {
  vi.resetAllMocks();
  saved = undefined;
  mocks.redis.get.mockImplementation(async () => saved);
  mocks.redis.set.mockImplementation(async (_key, value: string) => {
    saved = value;
    return "OK";
  });
  mocks.redis.del.mockImplementation(async () => {
    saved = undefined;
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
    saved = JSON.stringify({ source, shareImageUrl: firstUpload });
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
    saved = JSON.stringify({ source: firstSource, shareImageUrl: firstUpload });
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
    expect(JSON.parse(saved!)).toEqual({
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
    saved = previous;
    mocks.reddit.getSubredditStyles.mockResolvedValue({
      icon: "https://styles.redditmedia.com/new.png",
    });
    mocks.media.upload.mockRejectedValue(new Error("Media unavailable"));
    await expect(communityPostStyles(true)).rejects.toThrow(
      "Media unavailable",
    );
    expect(saved).toBe(previous);
    expect(await communityPostStyles()).toEqual({ shareImageUrl: firstUpload });
  });

  it("clears a removed icon so later post creation cannot reuse its cached URL", async () => {
    saved = JSON.stringify({ source: firstSource, shareImageUrl: firstUpload });
    mocks.reddit.getSubredditStyles.mockResolvedValue({});
    expect(await communityPostStyles(true)).toEqual({});
    expect(saved).toBeUndefined();
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
    saved = raw;
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
      expect(saved).toBeUndefined();
    },
  );
});
