import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchJsonRecord } from "./fetch-json";

afterEach(() => vi.unstubAllGlobals());

describe("JSON request errors", () => {
  it.each([null, [], {}, { message: "" }, { message: 42 }, { message: {} }])(
    "uses the caller's fallback for a missing or invalid error message",
    async (payload) => {
      vi.stubGlobal(
        "fetch",
        vi
          .fn()
          .mockResolvedValue(
            new Response(JSON.stringify(payload), { status: 503 }),
          ),
      );
      await expect(
        fetchJsonRecord("/api/example", "Try later."),
      ).rejects.toThrow("Try later.");
    },
  );
});
