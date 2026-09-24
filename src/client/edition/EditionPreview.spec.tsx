import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { createLattice } from "../../shared/edition-game";
import { EditionPreview } from "./EditionPreview";
import { LatticeBoard } from "./LatticeBoard";

vi.mock("@devvit/web/client", () => ({ requestExpandedMode: vi.fn() }));
vi.mock("./use-edition", () => {
  throw new Error("An inline preview must not load the session provider.");
});

describe("Lattice inline preview", () => {
  it("reuses the lattice stage with only an expansion action", () => {
    const markup = renderToStaticMarkup(<EditionPreview />);
    expect(markup).toContain("lattice-stage");
    expect(markup).toContain("Open Lattice");
    expect(markup.match(/<button\b/g)).toHaveLength(1);
    expect(markup).not.toContain("tabindex");
    expect(markup).not.toContain("Drag to rotate");
    expect(markup).not.toContain("Zoom in");
    expect(markup).not.toContain("Live games");
  });

  it("retains camera controls on the expanded board", () => {
    const markup = renderToStaticMarkup(
      <LatticeBoard
        model={{
          game: createLattice(),
          selected: null,
          layer: 1,
          isolate: false,
          showCubes: true,
          trace: null,
        }}
        onSelect={vi.fn()}
      />,
    );
    expect(markup).toContain("Drag to rotate");
    expect(markup).toContain("Zoom in");
    expect(markup).toContain('tabindex="0"');
  });
});
