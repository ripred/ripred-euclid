import { describe, expect, it } from "vitest";
import { formatCount } from "./format";

describe("count labels", () => {
  it.each([
    [0, "square", "0 squares"],
    [1, "square", "1 square"],
    [2, "square", "2 squares"],
    [1, "personal turn", "1 personal turn"],
    [3, "Square", "3 Squares"],
  ])("labels %i %s as %s", (count, noun, label) => {
    expect(formatCount(count, noun)).toBe(label);
  });

  it("keeps the matching noun when the count is shown formatted", () => {
    expect(formatCount(1204, "rated game", "1,204")).toBe("1,204 rated games");
    expect(formatCount(1, "rated game", "1")).toBe("1 rated game");
  });
});
