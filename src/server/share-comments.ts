import { createHash } from "node:crypto";
import type { ResultSharePayload } from "../shared/types/api";
import { isRecord } from "../shared/guards";
import { describeSharedResult } from "../shared/result-sharing";
import { isDefinitiveRedditRejection } from "./reddit-write-errors";

export interface ShareCommentRedis {
  get(key: string): Promise<string | null | undefined>;
  set(
    key: string,
    value: string,
    options?: { nx?: boolean; expiration?: Date },
  ): Promise<string | null | undefined>;
  del(key: string): Promise<unknown>;
}

export interface ShareCommentReddit {
  submitComment(options: {
    id: `t3_${string}`;
    text: string;
    runAs: "APP";
  }): Promise<{ id: string; permalink: string }>;
}

export interface PublishedShareComment {
  /** The hub remains a post; the shared result is its comment. */
  postId: string;
  commentId: string;
  permalink: string;
  sharedAs: "APP";
}

export class ShareCommentPendingError extends Error {
  override readonly name = "ShareCommentPendingError";
  readonly statusCode = 409;

  constructor(options?: ErrorOptions) {
    super(
      "This share is awaiting confirmation from Reddit. No duplicate comment was submitted.",
      options,
    );
  }
}

const escapeMarkdown = (value: string) =>
  value.replace(/[\r\n]+/g, " ").replace(/[\\`*_[\]{}()#+.!|<>~-]/g, "\\$&");

/** All game results use the same plain Markdown presentation. */
export function buildShareComment(
  payload: ResultSharePayload,
  gamePermalink: string,
): string {
  const gameUrl = new URL(gamePermalink, "https://www.reddit.com");
  if (gameUrl.protocol !== "https:" && gameUrl.protocol !== "http:")
    throw new TypeError("The game link must use HTTP or HTTPS.");
  const title = describeSharedResult({
    board: payload.board,
    p1Name: payload.p1Name,
    p2Name: payload.p2Name,
    outcome:
      payload.winnerSide === 1
        ? { state: 1, status: "player1_win", winner: 1 }
        : { state: 2, status: "player2_win", winner: 2 },
  }).title;
  const lines = [
    `### ${escapeMarkdown(title)}`,
    escapeMarkdown(payload.subtitle),
  ];
  // The title already contains the canonical winner and score.
  if (payload.details && !title.includes(payload.details))
    lines.push(escapeMarkdown(payload.details));
  if (payload.footer && payload.footer !== "Play Euclid on Reddit")
    lines.push(escapeMarkdown(payload.footer));
  lines.push(
    `[Play Euclid](<${gameUrl.href.replaceAll("<", "%3C").replaceAll(">", "%3E")}>)`,
  );
  return lines.filter(Boolean).join("\n\n");
}

const receiptKey = (key: string) => {
  if (!key.trim())
    throw new TypeError("A share idempotency key cannot be blank.");
  return `euclid:share:comment:v1:${createHash("sha256").update(key).digest("hex")}`;
};

function readPostedReceipt(
  raw: string | null | undefined,
): PublishedShareComment | null {
  if (raw === undefined || raw === null) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (
      isRecord(value) &&
      value.status === "posted" &&
      typeof value.postId === "string" &&
      value.postId.startsWith("t3_") &&
      typeof value.commentId === "string" &&
      value.commentId.startsWith("t1_") &&
      typeof value.permalink === "string" &&
      value.permalink.length > 0 &&
      value.sharedAs === "APP"
    )
      return {
        postId: value.postId,
        commentId: value.commentId,
        permalink: value.permalink,
        sharedAs: "APP",
      };
  } catch {
    // A corrupt or incomplete receipt cannot authorize another remote write.
  }
  throw new ShareCommentPendingError();
}

/** Canonical solo receipts can own deduplication; other callers supply a stable round key. */
export class ShareComments {
  private readonly now: () => number;

  constructor(
    private readonly redis: ShareCommentRedis,
    private readonly reddit: ShareCommentReddit,
    options: { now?: () => number } = {},
  ) {
    this.now = options.now ?? Date.now;
  }

  /** Call after canonical authorization, before preparing another remote write. */
  async getPosted(
    idempotencyKey: string,
  ): Promise<PublishedShareComment | null> {
    return readPostedReceipt(await this.redis.get(receiptKey(idempotencyKey)));
  }

  async publish(
    payload: ResultSharePayload,
    target: { postId: string; gamePermalink: string },
    idempotencyKey?: string,
  ): Promise<PublishedShareComment> {
    if (!/^t3_[a-z0-9_]+$/i.test(target.postId))
      throw new TypeError("Choose a Reddit post for shared result comments.");
    const text = buildShareComment(payload, target.gamePermalink);
    const key =
      idempotencyKey === undefined ? null : receiptKey(idempotencyKey);
    if (key) {
      const posted = readPostedReceipt(await this.redis.get(key));
      if (posted) return posted;
      // Do not expire the reservation: an unconfirmed remote write may have
      // succeeded, and a timeout must never authorize a duplicate comment.
      const reserved = await this.redis.set(
        key,
        JSON.stringify({
          status: "pending",
          postId: target.postId,
          shareId: payload.shareId,
          startedAt: this.now(),
        }),
        { nx: true },
      );
      if (reserved !== "OK") {
        const posted = readPostedReceipt(await this.redis.get(key));
        if (posted) return posted;
        throw new ShareCommentPendingError();
      }
    }

    let comment: { id: string; permalink: string };
    try {
      comment = await this.reddit.submitComment({
        id: target.postId as `t3_${string}`,
        text,
        runAs: "APP",
      });
    } catch (cause) {
      if (isDefinitiveRedditRejection(cause, "comment")) {
        if (key) await this.redis.del(key);
        throw cause;
      }
      throw new ShareCommentPendingError({ cause });
    }
    try {
      if (!comment.id.startsWith("t1_") || !comment.permalink)
        throw new Error(
          "Reddit did not return a confirmed comment destination.",
        );
      const result: PublishedShareComment = {
        postId: target.postId,
        commentId: comment.id,
        permalink: comment.permalink,
        sharedAs: "APP",
      };
      if (key)
        await this.redis.set(
          key,
          JSON.stringify({ status: "posted", ...result }),
        );
      return result;
    } catch (cause) {
      // The caller must also keep any canonical solo preparation pending here.
      throw new ShareCommentPendingError({ cause });
    }
  }
}
