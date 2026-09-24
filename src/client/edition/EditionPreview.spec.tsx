import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { EditionPreview } from "./EditionPreview";
import { PrismBoard } from "./PrismBoard";
import { makeExhibit } from "./prism-exhibit";

vi.mock("@devvit/web/client", () => ({ requestExpandedMode: vi.fn() }));
vi.mock("./use-edition", () => {
  throw new Error("An inline preview must not load the session provider.");
});

describe("Prism inline preview", () => {
  it("reuses its illustrative board with only an expansion action", () => {
    const markup = renderToStaticMarkup(<EditionPreview />);
    expect(markup).toContain("prism-board");
    expect(markup).toContain("Open Prism");
    expect(markup.match(/<button\b/g)).toHaveLength(1);
    expect(markup).not.toContain("tabindex");
    expect(markup).not.toContain("board-controls");
    expect(markup).not.toContain("Live games");
  });

  it("omits gameplay targets even if a decorative board is marked active", () => {
    const markup = renderToStaticMarkup(
      <PrismBoard
        game={makeExhibit()}
        active
        decorative
        flat={false}
        onMove={vi.fn()}
      />,
    );
    expect(markup).toContain("<canvas");
    expect(markup).not.toContain("<button");
    expect(markup).not.toContain("tabindex");
  });
});
