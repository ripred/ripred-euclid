import { beforeEach, describe, expect, it, vi } from "vitest";
import { ensurePostHighlighted } from "./post-highlights";

const mocks = vi.hoisted(() => ({
  metadata: { requestId: "test-request" },
  use: vi.fn(),
  client: {
    GetIsPostHighlighted: vi.fn(),
    AddPostToHighlights: vi.fn(),
  },
}));
vi.mock("@devvit/web/server", () => ({
  context: { metadata: mocks.metadata },
}));
vi.mock("@devvit/shared-types/server/get-devvit-config.js", () => ({
  getDevvitConfig: () => ({ use: mocks.use }),
}));

beforeEach(() => {
  vi.resetAllMocks();
  mocks.use.mockReturnValue(mocks.client);
  mocks.client.AddPostToHighlights.mockResolvedValue({});
});

describe("community highlights", () => {
  it("preserves an existing highlight without changing its position or expiry", async () => {
    mocks.client.GetIsPostHighlighted.mockResolvedValue({
      isHighlighted: true,
    });
    expect(await ensurePostHighlighted("t3_game")).toBe(true);
    expect(mocks.client.GetIsPostHighlighted).toHaveBeenCalledExactlyOnceWith(
      { postId: "t3_game" },
      mocks.metadata,
    );
    expect(mocks.client.AddPostToHighlights).not.toHaveBeenCalled();
  });

  it("adds a missing highlight once and verifies it before returning", async () => {
    mocks.client.GetIsPostHighlighted.mockResolvedValueOnce({
      isHighlighted: false,
    }).mockResolvedValue({ isHighlighted: true });
    expect(await ensurePostHighlighted("t3_hub")).toBe(true);
    expect(await ensurePostHighlighted("t3_hub")).toBe(true);
    expect(mocks.client.AddPostToHighlights).toHaveBeenCalledExactlyOnceWith(
      { postId: "t3_hub" },
      mocks.metadata,
    );
    expect(mocks.client.GetIsPostHighlighted).toHaveBeenCalledTimes(3);
  });

  it("reports a failed readback instead of claiming the post was highlighted", async () => {
    mocks.client.GetIsPostHighlighted.mockResolvedValue({
      isHighlighted: false,
    });
    await expect(ensurePostHighlighted("t3_hub")).rejects.toThrow(
      "did not highlight",
    );
  });

  it("propagates an unavailable lookup without adding a duplicate highlight", async () => {
    mocks.client.GetIsPostHighlighted.mockRejectedValue(
      new Error("Unavailable"),
    );
    await expect(ensurePostHighlighted("t3_hub")).rejects.toThrow(
      "Unavailable",
    );
    expect(mocks.client.AddPostToHighlights).not.toHaveBeenCalled();
  });

  const stages = ["lookup", "add", "readback"] as const;
  const failAt = (stage: (typeof stages)[number], error: Error) => {
    mocks.client.GetIsPostHighlighted.mockResolvedValueOnce({
      isHighlighted: false,
    }).mockResolvedValue({ isHighlighted: true });
    if (stage === "lookup")
      mocks.client.GetIsPostHighlighted.mockReset().mockRejectedValue(error);
    else if (stage === "add")
      mocks.client.AddPostToHighlights.mockRejectedValue(error);
    else mocks.client.GetIsPostHighlighted.mockRejectedValueOnce(error);
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
      expect(mocks.client.GetIsPostHighlighted).toHaveBeenCalledTimes(
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
    mocks.client.GetIsPostHighlighted.mockRejectedValue(error);
    await expect(ensurePostHighlighted("t3_hub")).rejects.toBe(error);
  });
});
