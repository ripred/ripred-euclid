import { describe, expect, it, vi } from "vitest";
import { Board, Player } from "../shared/game/engine";
import type { ResultSharePayload } from "../shared/types/api";
import {
  buildShareComment,
  ShareCommentPendingError,
  ShareComments,
  type ShareCommentRedis,
} from "./share-comments";

class CommentRedis implements ShareCommentRedis {
  readonly values = new Map<string, string>();
  readonly writes: {
    key: string;
    value: string;
    options?: { nx?: boolean; expiration?: Date };
  }[] = [];
  failPosted = false;
  postedFailure: unknown = new Error("Redis write failed");
  async get(key: string) {
    return this.values.get(key);
  }
  async set(
    key: string,
    value: string,
    options?: { nx?: boolean; expiration?: Date },
  ) {
    this.writes.push({ key, value, ...(options ? { options } : {}) });
    if (options?.nx && this.values.has(key)) return null;
    if (this.failPosted && JSON.parse(value).status === "posted")
      throw this.postedFailure;
    this.values.set(key, value);
    return "OK";
  }
  async del(key: string) {
    this.values.delete(key);
  }
}

const target = {
  postId: "t3_hub",
  gamePermalink: "/r/Euclid/comments/game/play/",
};
const comment = {
  id: "t1_result",
  permalink: "/r/Euclid/comments/hub/results/result/",
};

function resultFixture(
  overrides: Partial<ResultSharePayload> = {},
): ResultSharePayload {
  const board = new Board(new Player(), new Player(), {
    W: 8,
    H: 8,
    winScore: 150,
  }).toJSON();
  board.m_players[0]!.m_score = 0;
  board.m_players[1]!.m_score = 165;
  return {
    kind: "result",
    shareId: "share-1",
    subredditName: "Euclid",
    sharedAt: "2026-09-29T12:00:00Z",
    mode: "ai",
    title: "Rip_red beat Euclid, 165–0",
    headline: "Rip_red beat Euclid!",
    subtitle: "Practice · Beginner",
    details: "165–0",
    footer: "Play Euclid on Reddit",
    p1Name: "Euclid",
    p2Name: "Rip_red",
    winnerSide: 2,
    board,
    ...overrides,
  };
}

describe("share comment body", () => {
  it.each(["ai", "h2h"] as const)(
    "uses one canonical winner-first %s heading with preserved usernames",
    (mode) => {
      const body = buildShareComment(
        resultFixture({ mode }),
        target.gamePermalink,
      );
      expect(body).toBe(
        [
          "### Rip\\_red beat Euclid, 165–0",
          "Practice · Beginner",
          "[Play Euclid](<https://www.reddit.com/r/Euclid/comments/game/play/>)",
        ].join("\n\n"),
      );
      expect(body.match(/beat Euclid/g)).toHaveLength(1);
      expect(body).not.toContain("0–165");
    },
  );

  it("escapes markup in names and descriptions while retaining useful forfeit details", () => {
    const body = buildShareComment(
      resultFixture({
        p2Name: "[winner](https://wrong.example)",
        p1Name: "<opponent>",
        subtitle: "# ranked\n> quoted",
        details: "The opponent *left* the match.",
        footer: "First to 150 points",
      }),
      "https://www.reddit.com/r/Euclid/comments/game/a(b)/",
    );
    expect(body).toContain(
      "### \\[winner\\]\\(https://wrong\\.example\\) beat \\<opponent\\>, 165–0",
    );
    expect(body).toContain("\\# ranked \\> quoted");
    expect(body).toContain("The opponent \\*left\\* the match\\.");
    expect(body).toContain("First to 150 points");
    expect(body).toContain(
      "[Play Euclid](<https://www.reddit.com/r/Euclid/comments/game/a(b)/>)",
    );
  });

  it("derives the winner and score for legacy receipts with a generic stored title", () => {
    const payload = resultFixture({
      title: "Redditor vs Euclid",
      headline: "A generic old headline",
    });
    expect(buildShareComment(payload, target.gamePermalink)).toContain(
      "### Rip\\_red beat Euclid, 165–0",
    );
    expect(buildShareComment(payload, target.gamePermalink)).not.toMatch(
      /Redditor vs Euclid|generic old headline/,
    );
    payload.winnerSide = 1;
    payload.board.m_players[0]!.m_score = 200;
    payload.board.m_players[1]!.m_score = 55;
    payload.details = "200–55";
    expect(buildShareComment(payload, target.gamePermalink)).toContain(
      "### Euclid beat Rip\\_red, 200–55",
    );
  });
});

describe("share comment publication", () => {
  it.each([
    new Error("failed to reply to comment"),
    Object.assign(new Error("Comment rejected"), { code: "permission_denied" }),
  ])(
    "releases only a confirmed Reddit rejection so the result can be retried",
    async (failure) => {
      const redis = new CommentRedis();
      const reddit = {
        submitComment: vi
          .fn()
          .mockRejectedValueOnce(failure)
          .mockResolvedValue(comment),
      };
      const publisher = new ShareComments(redis, reddit);
      expect(await publisher.getPosted("round-1")).toBeNull();
      await expect(
        publisher.publish(resultFixture(), target, "round-1"),
      ).rejects.toBe(failure);
      expect(redis.values.size).toBe(0);
      const posted = await publisher.publish(
        resultFixture(),
        target,
        "round-1",
      );
      expect(await publisher.getPosted("round-1")).toEqual(posted);
      expect(reddit.submitComment).toHaveBeenCalledTimes(2);
    },
  );

  it("admits one concurrent writer and replays its comment after the hub or payload changes", async () => {
    const redis = new CommentRedis();
    let release!: () => void;
    let begun!: () => void;
    const started = new Promise<void>((resolve) => {
      begun = resolve;
    });
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const reddit = {
      submitComment: vi.fn(async () => {
        begun();
        await blocked;
        return comment;
      }),
    };
    const publisher = new ShareComments(redis, reddit, { now: () => 1000 });
    const attempts = Promise.allSettled([
      publisher.publish(resultFixture(), target, "h2h:game:33"),
      publisher.publish(
        resultFixture({ shareId: "a-new-uuid" }),
        target,
        "h2h:game:33",
      ),
    ]);
    await started;
    expect(reddit.submitComment).toHaveBeenCalledTimes(1);
    release();
    const outcomes = await attempts;
    expect(
      outcomes.filter((outcome) => outcome.status === "fulfilled"),
    ).toHaveLength(1);
    expect(
      outcomes.find((outcome) => outcome.status === "rejected"),
    ).toMatchObject({ reason: { name: "ShareCommentPendingError" } });
    const expected = {
      postId: target.postId,
      commentId: comment.id,
      permalink: comment.permalink,
      sharedAs: "APP",
    };
    expect(
      await publisher.publish(
        resultFixture({ shareId: "retry-next-day" }),
        { ...target, postId: "t3_newhub" },
        "h2h:game:33",
      ),
    ).toEqual(expected);
    expect(reddit.submitComment).toHaveBeenCalledTimes(1);
    expect(reddit.submitComment).toHaveBeenCalledWith({
      id: target.postId,
      runAs: "APP",
      text: expect.stringContaining("Rip\\_red beat Euclid, 165–0"),
    });
    expect(redis.writes.filter((write) => write.options?.nx)).toHaveLength(2);
    expect(
      redis.writes.every((write) => write.options?.expiration === undefined),
    ).toBe(true);
  });

  it("keeps an ambiguous Reddit failure pending across retries and publisher restarts", async () => {
    const redis = new CommentRedis();
    const reddit = {
      submitComment: vi.fn(async () => {
        throw new Error("Connection lost after submission");
      }),
    };
    const publisher = new ShareComments(redis, reddit);
    await expect(
      publisher.publish(resultFixture(), target, "h2h:game:33"),
    ).rejects.toBeInstanceOf(ShareCommentPendingError);
    await expect(publisher.getPosted("h2h:game:33")).rejects.toBeInstanceOf(
      ShareCommentPendingError,
    );
    const restarted = new ShareComments(redis, reddit, {
      now: () => Date.now() + 365 * 86_400_000,
    });
    await expect(
      restarted.publish(resultFixture(), target, "h2h:game:33"),
    ).rejects.toBeInstanceOf(ShareCommentPendingError);
    expect(reddit.submitComment).toHaveBeenCalledTimes(1);
    expect(
      [...redis.values.values()].map((value) => JSON.parse(value).status),
    ).toEqual(["pending"]);
  });

  it.each([
    "",
    "not json",
    "{}",
    '{"status":"pending"}',
    '{"status":"posted","commentId":"t1_result"}',
  ])(
    "keeps present incomplete or corrupt receipts pending on direct lookup: %j",
    async (raw) => {
      const redis = new CommentRedis();
      const reddit = { submitComment: vi.fn(async () => comment) };
      const publisher = new ShareComments(redis, reddit);
      expect(await publisher.getPosted("round-1")).toBeNull();
      const posted = await publisher.publish(
        resultFixture(),
        target,
        "round-1",
      );
      expect(await publisher.getPosted("round-1")).toEqual(posted);
      redis.values.set(redis.writes[0]!.key, raw);
      const writes = redis.writes.length;
      await expect(publisher.getPosted("round-1")).rejects.toBeInstanceOf(
        ShareCommentPendingError,
      );
      await expect(
        publisher.publish(resultFixture(), target, "round-1"),
      ).rejects.toBeInstanceOf(ShareCommentPendingError);
      expect(redis.writes).toHaveLength(writes);
      expect(reddit.submitComment).toHaveBeenCalledTimes(1);
    },
  );

  it.each([
    new Error("Redis write failed"),
    Object.assign(new Error("Redis permission denied"), { code: 7 }),
  ])(
    "does not duplicate an accepted comment when recording its destination fails",
    async (failure) => {
      const redis = new CommentRedis();
      redis.failPosted = true;
      redis.postedFailure = failure;
      const reddit = { submitComment: vi.fn(async () => comment) };
      const publisher = new ShareComments(redis, reddit);
      await expect(
        publisher.publish(resultFixture(), target, "round-1"),
      ).rejects.toBeInstanceOf(ShareCommentPendingError);
      redis.failPosted = false;
      await expect(
        publisher.publish(resultFixture(), target, "round-1"),
      ).rejects.toBeInstanceOf(ShareCommentPendingError);
      expect(reddit.submitComment).toHaveBeenCalledTimes(1);
      expect(redis.values.size).toBe(1);
    },
  );

  it("supports solo-owned receipts without adding another reservation", async () => {
    const redis = new CommentRedis();
    const reddit = { submitComment: vi.fn(async () => comment) };
    const publisher = new ShareComments(redis, reddit);
    expect(await publisher.publish(resultFixture(), target)).toEqual({
      postId: target.postId,
      commentId: comment.id,
      permalink: comment.permalink,
      sharedAs: "APP",
    });
    expect(redis.writes).toHaveLength(0);
    expect(reddit.submitComment).toHaveBeenCalledTimes(1);
  });

  it("rejects an unsafe game link before reserving or submitting a comment", async () => {
    const redis = new CommentRedis();
    const reddit = { submitComment: vi.fn(async () => comment) };
    const publisher = new ShareComments(redis, reddit);
    await expect(
      publisher.publish(
        resultFixture(),
        { ...target, gamePermalink: "javascript:alert(1)" },
        "round-1",
      ),
    ).rejects.toThrow("HTTP or HTTPS");
    expect(redis.writes).toHaveLength(0);
    expect(reddit.submitComment).not.toHaveBeenCalled();
  });
});
