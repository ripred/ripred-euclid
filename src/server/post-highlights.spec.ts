import { beforeEach, describe, expect, it, vi } from "vitest";
import { ensurePostHighlighted } from "./post-highlights";

const mocks = vi.hoisted(() => ({
  metadata: { requestId: "test-request" },
  subredditId: "t5_euclid" as string | undefined,
  use: vi.fn(),
  client: {
    GetHighlightedPosts: vi.fn(),
    AddPostToHighlights: vi.fn(),
  },
}));
vi.mock("@devvit/web/server", () => ({
  context: {
    metadata: mocks.metadata,
    get subredditId() {
      return mocks.subredditId;
    },
  },
}));
vi.mock("@devvit/shared-types/server/get-devvit-config.js", () => ({
  getDevvitConfig: () => ({ use: mocks.use }),
}));

beforeEach(() => {
  vi.resetAllMocks();
  mocks.subredditId = "t5_euclid";
  mocks.use.mockReturnValue(mocks.client);
  mocks.client.AddPostToHighlights.mockResolvedValue({});
});

describe("community highlights", () => {
  it("requires the trusted subreddit before reading or changing highlights", async () => {
    mocks.subredditId = undefined;
    await expect(ensurePostHighlighted("t3_hub")).rejects.toThrow(
      "Subreddit context",
    );
    expect(mocks.use).not.toHaveBeenCalled();
    expect(mocks.client.AddPostToHighlights).not.toHaveBeenCalled();
  });

  it("preserves an existing highlight without changing its position or expiry", async () => {
    mocks.client.GetHighlightedPosts.mockResolvedValue({
      highlightedPosts: [{ postId: "t3_game", expiresAt: 123, label: 1 }],
    });
    expect(await ensurePostHighlighted("t3_game")).toBe(true);
    expect(mocks.client.GetHighlightedPosts).toHaveBeenCalledExactlyOnceWith(
      { subredditId: "t5_euclid" },
      mocks.metadata,
    );
    expect(mocks.client.AddPostToHighlights).not.toHaveBeenCalled();
  });

  it("adds a missing highlight once and verifies it before returning", async () => {
    mocks.client.GetHighlightedPosts.mockResolvedValueOnce({
      highlightedPosts: [{ postId: "t3_another_post" }],
    }).mockResolvedValue({ highlightedPosts: [{ postId: "t3_hub" }] });
    expect(await ensurePostHighlighted("t3_hub")).toBe(true);
    expect(await ensurePostHighlighted("t3_hub")).toBe(true);
    expect(mocks.client.AddPostToHighlights).toHaveBeenCalledExactlyOnceWith(
      { postId: "t3_hub" },
      mocks.metadata,
    );
    expect(mocks.client.GetHighlightedPosts).toHaveBeenCalledTimes(3);
  });

  it("reports a failed readback instead of claiming the post was highlighted", async () => {
    mocks.client.GetHighlightedPosts.mockResolvedValue({
      highlightedPosts: [],
    });
    await expect(ensurePostHighlighted("t3_hub")).rejects.toThrow(
      "did not highlight",
    );
  });

  it("propagates an unavailable lookup without adding a duplicate highlight", async () => {
    mocks.client.GetHighlightedPosts.mockRejectedValue(
      new Error("Unavailable"),
    );
    await expect(ensurePostHighlighted("t3_hub")).rejects.toThrow(
      "Unavailable",
    );
    expect(mocks.client.AddPostToHighlights).not.toHaveBeenCalled();
  });

  const stages = ["lookup", "add", "readback"] as const;
  const failAt = (stage: (typeof stages)[number], error: Error) => {
    mocks.client.GetHighlightedPosts.mockResolvedValueOnce({
      highlightedPosts: [],
    }).mockResolvedValue({ highlightedPosts: [{ postId: "t3_hub" }] });
    if (stage === "lookup")
      mocks.client.GetHighlightedPosts.mockReset().mockRejectedValue(error);
    else if (stage === "add")
      mocks.client.AddPostToHighlights.mockRejectedValue(error);
    else mocks.client.GetHighlightedPosts.mockRejectedValueOnce(error);
  };

  it.each(
    stages.flatMap((stage) =>
      [12, "UNIMPLEMENTED"].map((code) => ({ stage, code })),
    ),
  )(
    "reports unsupported $stage RPC code $code without claiming a highlight",
    async ({ stage, code }) => {
      failAt(stage, Object.assign(new Error("Unknown method"), { code }));
      expect(await ensurePostHighlighted("t3_hub")).toBe(false);
      expect(mocks.client.GetHighlightedPosts).toHaveBeenCalledTimes(
        stage === "readback" ? 2 : 1,
      );
      expect(mocks.client.AddPostToHighlights).toHaveBeenCalledTimes(
        stage === "lookup" ? 0 : 1,
      );
    },
  );

  it.each(stages)("propagates real %s RPC failures", async (stage) => {
    const error = Object.assign(new Error("Temporarily unavailable"), {
      code: 14,
    });
    failAt(stage, error);
    await expect(ensurePostHighlighted("t3_hub")).rejects.toBe(error);
  });

  it("does not infer unsupported RPCs from error messages", async () => {
    const error = new Error("unimplemented method");
    mocks.client.GetHighlightedPosts.mockRejectedValue(error);
    await expect(ensurePostHighlighted("t3_hub")).rejects.toBe(error);
  });
});
