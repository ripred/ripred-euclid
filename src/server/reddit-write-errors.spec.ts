import { describe, expect, it } from "vitest";
import { isDefinitiveRedditRejection } from "./reddit-write-errors";

describe("Reddit write rejection classification", () => {
  it.each([
    "permission_denied",
    "INVALID_ARGUMENT",
    "not_found",
    "unauthenticated",
    3,
    5,
    7,
    16,
  ])(
    "recognizes structured comment rejection %s without treating it as a post rejection",
    (code) => {
      const error = Object.assign(new Error("The operation was rejected"), {
        code,
      });
      expect(isDefinitiveRedditRejection(error, "comment")).toBe(true);
      expect(isDefinitiveRedditRejection(error, "post")).toBe(false);
    },
  );

  it("recognizes the installed SDK's exact comment rejection", () => {
    expect(
      isDefinitiveRedditRejection(
        new Error("failed to reply to comment"),
        "comment",
      ),
    ).toBe(true);
    expect(
      isDefinitiveRedditRejection(
        new Error("failed to reply to comment"),
        "post",
      ),
    ).toBe(false);
  });

  it("releases post claims only for an explicit response error without an assigned post ID", () => {
    expect(
      isDefinitiveRedditRejection(
        new Error("post submission failed: RATELIMIT: try later"),
        "post",
      ),
    ).toBe(true);
    for (const message of [
      "post submission failed: ",
      "post submission failed:    ",
      "post abc123 submission failed: RATELIMIT: try later",
      "Permission denied",
      "not found",
    ])
      expect(isDefinitiveRedditRejection(new Error(message), "post")).toBe(
        false,
      );
  });

  it.each([
    new Error("Connection reset after submission"),
    new Error("network permission_denied"),
    new Error("failed to reply to comment: connection reset"),
    { code: "unavailable" },
    { code: "deadline_exceeded" },
    { code: 4 },
    { code: 13 },
    { code: "7" },
    { status: 403 },
    null,
    "failed to reply to comment",
  ])("keeps ambiguous failures reserved: %j", (error) => {
    expect(isDefinitiveRedditRejection(error, "comment")).toBe(false);
    expect(isDefinitiveRedditRejection(error, "post")).toBe(false);
  });
});
