import { describe, expect, it } from "vitest";
import { gamePostContent } from "./community-post-content";

const imageUrl = "https://i.redd.it/community.png";

describe("community post content", () => {
  it("keeps the plain game description when no icon exists", () => {
    expect(gamePostContent()).toEqual({
      text: expect.stringContaining("placing dots and completing squares"),
    });
  });

  it("links the icon first while retaining the complete game fallback description", () => {
    const content = gamePostContent(imageUrl);
    expect(content).toEqual({
      text: `[Euclid](${imageUrl})\n\n${gamePostContent().text}`,
    });
  });
});
