import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { createWeave, type WeaveState } from "../../shared/edition-game";
import type { PlayMode } from "../../shared/edition-contract";
import { Weave } from "./Weave";
import { useEdition } from "./use-edition";

vi.mock("./use-edition", () => ({ useEdition: vi.fn() }));

function renderGame(
  game: WeaveState | null,
  watching = true,
  mode: PlayMode = "solo",
  hostName: string | null = "HostPlayer",
) {
  vi.mocked(useEdition<WeaveState>).mockReturnValue({
    game,
    gameId: game ? "weave-test" : null,
    mode,
    watching,
    hostName,
    watchedId: watching ? "weave-test" : null,
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
  return renderToStaticMarkup(<Weave />);
}

describe("Weave spectator rendering", () => {
  it("keeps point inspection and triangle scores without claim controls", () => {
    const markup = renderGame(createWeave());
    expect(markup).toContain("HostPlayer’s thread.");
    expect(markup).toContain("HostPlayer versus Euclid");
    expect(markup.match(/aria-disabled="true"/g)).toHaveLength(28);
    expect(markup.match(/tabindex="0"/g)).toHaveLength(1);
    expect(markup).toMatch(
      /<button class="primary" disabled="">New game<\/button>/,
    );
    expect(markup).not.toContain("Your thread");
  });
  it.each([1, 2] as const)(
    "identifies winner %i without a spectator replay action",
    (winner) => {
      const markup = renderGame({ ...createWeave(), winner });
      expect(markup).toContain(
        winner === 1 ? "HostPlayer’s weave wins." : "Euclid wins.",
      );
      expect(markup).not.toContain("Your weave wins");
      expect(markup).not.toContain("Weave again");
    },
  );
  it("uses role labels for two people sharing a board", () => {
    const markup = renderGame(createWeave(), true, "duel");
    expect(markup).toContain("Terracotta’s thread.");
    expect(markup).toContain("Player 1");
    expect(markup).toContain("Player 2");
    expect(markup).not.toContain("HostPlayer");
  });
  it("attributes the human's previous triangle to the host, not the viewer", () => {
    const game = createWeave();
    game.previousMove = {
      point: 0,
      player: 1,
      triangles: ["test"],
      area: 1,
      links: 1,
      points: 3,
    };
    game.lastMove = {
      point: 1,
      player: 2,
      triangles: [],
      area: 0,
      links: 0,
      points: 0,
    };
    const markup = renderGame(game);
    expect(markup).toContain("HostPlayer’s stitch");
    expect(markup).not.toContain("Your stitch");
  });
  it("uses a neutral fallback and no setup while waiting", () => {
    expect(renderGame(createWeave(), true, "solo", null)).toContain(
      "Redditor’s thread.",
    );
    const markup = renderGame(null);
    expect(markup).toContain("Waiting for the broadcast");
    expect(markup).not.toContain("Begin a weave");
  });
  it("uses singular scoring feedback for a one-point triangle", () => {
    const game = createWeave();
    game.lastMove = {
      point: 0,
      player: 1,
      triangles: ["test"],
      area: 1,
      links: 0,
      points: 1,
    };
    const markup = renderGame(game);
    expect(markup).toContain("HostPlayer added 1 point.");
    expect(markup).not.toContain("1 points");
  });
  it("retains personal move instructions", () => {
    const markup = renderGame(createWeave(), false);
    expect(markup).toContain("Your thread.");
    expect(markup).toContain("Claim one empty point.");
  });
});
