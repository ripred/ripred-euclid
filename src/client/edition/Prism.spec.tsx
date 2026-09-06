import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  createPrism,
  PRISM_SQUARES,
  type PrismState,
} from "../../shared/edition-game";
import type { PlayMode } from "../../shared/edition-contract";
import { Prism } from "./Prism";
import { PrismBoard } from "./PrismBoard";
import { useEdition } from "./use-edition";

vi.mock("./use-edition", () => ({ useEdition: vi.fn() }));

function renderGame(
  game: PrismState | null,
  watching = true,
  mode: PlayMode = "solo",
  hostName: string | null = "HostPlayer",
) {
  vi.mocked(useEdition<PrismState>).mockReturnValue({
    game,
    gameId: game ? "prism-test" : null,
    mode,
    watching,
    hostName,
    watchedId: watching ? "prism-test" : null,
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
  return renderToStaticMarkup(<Prism />);
}

describe("Prism spectator rendering", () => {
  it.each([0, 1, 2])(
    "formats %i completed squares in board and result summaries",
    (count) => {
      const game = createPrism();
      game.completed = PRISM_SQUARES.slice(0, count).map((square) => ({
        ...square,
        owner: 1,
      }));
      const label = `${count} ${count === 1 ? "square" : "squares"}`;
      expect(renderGame(game)).toContain(`${label} · 64 open`);
      expect(renderGame({ ...game, winner: 1 })).toContain(
        `${label}. One well-earned victory.`,
      );
    },
  );
  it("keeps flat and tilted inspection with one read-only keyboard entry point", () => {
    const markup = renderGame(createPrism());
    expect(markup).toContain("HostPlayer&#x27;s turn");
    expect(markup).toContain("Tilt view");
    expect(markup).toContain("Flat view");
    expect(markup).toContain("Arrows to explore · Read-only board");
    expect(markup.match(/aria-disabled="true"/g)).toHaveLength(64);
    expect(markup.match(/tabindex="0"/g)).toHaveLength(1);
    expect(markup).toMatch(/<button disabled="">New game<\/button>/);
    expect(markup).not.toContain("Your turn");
  });
  it.each([1, 2] as const)(
    "identifies player %i's result without viewer replay controls",
    (winner) => {
      const markup = renderGame({ ...createPrism(), winner });
      expect(markup).toContain(
        winner === 1 ? "HostPlayer wins." : "Euclid wins.",
      );
      expect(markup).not.toContain("You win.");
      expect(markup).not.toContain("Play again");
    },
  );
  it("uses same-device role names and a neutral missing-name fallback", () => {
    expect(renderGame(createPrism(), true, "duel")).toContain(
      "Coral&#x27;s turn",
    );
    expect(renderGame(createPrism(), true, "solo", null)).toContain(
      "Redditor&#x27;s turn",
    );
  });
  it("does not show the exhibit or setup while a broadcast is loading", () => {
    const markup = renderGame(null);
    expect(markup).toContain("Waiting for the broadcast");
    expect(markup).not.toContain("point-target");
    expect(markup).not.toContain("Pass &amp; play");
  });
  it("makes the board read-only even if active is accidentally true", () => {
    const markup = renderToStaticMarkup(
      <PrismBoard
        game={createPrism()}
        active
        readOnly
        flat={false}
        onMove={vi.fn()}
      />,
    );
    expect(markup.match(/aria-disabled="true"/g)).toHaveLength(64);
    expect(markup.match(/tabindex="0"/g)).toHaveLength(1);
  });
  it("retains personal turn and victory copy", () => {
    expect(renderGame(createPrism(), false)).toContain("Your turn");
    expect(renderGame({ ...createPrism(), winner: 1 }, false)).toContain(
      "You win.",
    );
  });
});
