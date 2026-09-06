import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { createLattice, type LatticeState } from "../../shared/edition-game";
import type { PlayMode } from "../../shared/edition-contract";
import { Lattice } from "./Lattice";
import { useEdition } from "./use-edition";

vi.mock("./use-edition", () => ({ useEdition: vi.fn() }));

function renderGame(
  game: LatticeState | null,
  watching = true,
  mode: PlayMode = "solo",
  hostName: string | null = "HostPlayer",
) {
  vi.mocked(useEdition<LatticeState>).mockReturnValue({
    game,
    gameId: game ? "lattice-test" : null,
    mode,
    watching,
    hostName,
    watchedId: watching ? "lattice-test" : null,
    ownerGameId: "personal-test",
    spectatorsEnabled: false,
    watch: vi.fn(async () => undefined),
    stopWatching: vi.fn(),
    setSpectatorsEnabled: vi.fn(async () => true),
    loading: false,
    busy: false,
    error: null,
    start: vi.fn(async () => true),
    move: vi.fn(async () => true),
    reload: vi.fn(async () => undefined),
  });
  return renderToStaticMarkup(<Lattice />);
}

describe("Lattice spectator rendering", () => {
  it("keeps inspection and camera controls without a placement action", () => {
    const markup = renderGame(createLattice());
    expect(markup).toContain("HostPlayer’s move");
    expect(markup).toContain("Layer inspector");
    expect(markup).toContain('aria-label="Layer Z 2"');
    expect(markup).toContain('aria-label="Zoom in"');
    expect(markup).toContain("Isolate selected layer");
    expect(markup).toContain("Trace a possible cube");
    expect(markup).not.toMatch(/<button[^>]*>Place point<\/button>/);
    expect(markup).toMatch(/<button disabled="">New game<\/button>/);
    expect(markup).not.toContain("Your move");
    expect(markup).toContain("This board is read-only.");
    expect(markup).not.toContain("Placement always asks for confirmation.");
  });
  it.each([1, 2] as const)(
    "identifies player %i's result without claiming a viewer win",
    (winner) => {
      const markup = renderGame({ ...createLattice(), winner });
      expect(markup).toContain(
        winner === 1 ? "HostPlayer wins." : "Euclid wins.",
      );
      expect(markup).not.toContain("You win");
      expect(markup).not.toContain("Build another lattice");
    },
  );
  it("uses role names for a same-device broadcast", () => {
    const markup = renderGame(createLattice(), true, "duel");
    expect(markup).toContain("Teal’s move");
    expect(markup).toContain("Vermilion");
    expect(markup).not.toContain("HostPlayer");
  });
  it("uses a neutral fallback when the host name is absent", () => {
    expect(renderGame(createLattice(), true, "solo", null)).toContain(
      "Redditor’s move",
    );
  });
  it("never shows a foundation preview or setup while a broadcast is loading", () => {
    const markup = renderGame(null);
    expect(markup).toContain("Waiting for the broadcast");
    expect(markup).not.toContain("Play Euclid");
    expect(markup).not.toContain("Layer inspector");
  });
  it("retains personal placement and result controls", () => {
    expect(renderGame(createLattice(), false)).toContain("Place point");
    expect(renderGame({ ...createLattice(), winner: 1 }, false)).toContain(
      "You win.",
    );
  });
});
