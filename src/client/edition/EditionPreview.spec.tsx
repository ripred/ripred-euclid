import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { requestExpandedMode } from "@devvit/web/client";
import { EditionPreview } from "./EditionPreview";

vi.mock("@devvit/web/client", () => ({ requestExpandedMode: vi.fn() }));
vi.mock("./use-edition", () => ({
  useEdition: () => {
    throw new Error("Inline artwork must not load a session.");
  },
}));

describe("Weave inline entry", () => {
  it("renders its existing board with only an explicit expansion button", () => {
    const markup = renderToStaticMarkup(<EditionPreview />);
    expect(markup).toContain("Weave game preview");
    expect(markup).toContain("<svg");
    expect(markup.match(/<button\b/g)).toHaveLength(1);
    expect(markup).toContain("Open Weave");
    expect(markup).toContain('inert=""');
    expect(markup).not.toMatch(
      /tabindex=|<dialog|<form|Live games|Allow spectators/,
    );
    expect(requestExpandedMode).not.toHaveBeenCalled();
  });
  it("routes the passive post and expanded game to separate bootstraps", () => {
    const inline = readFileSync(
      new URL("../preview.html", import.meta.url),
      "utf8",
    );
    const expanded = readFileSync(
      new URL("../index.html", import.meta.url),
      "utf8",
    );
    expect(inline).toContain('data-entry="inline"');
    expect(inline).toContain("./edition-preview.tsx");
    expect(inline).not.toContain("./edition-main.tsx");
    expect(expanded).toContain("./edition-main.tsx");
  });
});
