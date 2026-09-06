import { describe, expect, it } from "vitest";

import { errorMessage } from "./error-message";

describe("request error messages", () => {
  const fallback = "Unable to load. Try again.";

  it("retains a non-empty error message", () => {
    expect(errorMessage(new Error("Connection lost."), fallback)).toBe(
      "Connection lost.",
    );
  });

  it("retains a non-empty thrown string", () => {
    expect(errorMessage("Service unavailable.", fallback)).toBe(
      "Service unavailable.",
    );
  });

  it.each([
    new Error(""),
    "",
    null,
    undefined,
    0,
    false,
    {},
    { message: "Unknown" },
  ])("uses the fallback for an empty or unsupported failure: %j", (error) => {
    expect(errorMessage(error, fallback)).toBe(fallback);
  });
});
