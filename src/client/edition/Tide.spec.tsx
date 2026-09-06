import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { edition, type TideState } from "../../shared/edition-game";
import type { PlayMode } from "../../shared/edition-contract";
import { Tide } from "./Tide";
import { useEdition } from "./use-edition";

vi.mock("./use-edition", () => ({ useEdition: vi.fn() }));

function renderGame(
  game: TideState | null,
  watching = true,
  mode: PlayMode = "solo",
  hostName: string | null = "HostPlayer",
) {
  vi.mocked(useEdition<TideState>).mockReturnValue({
    game,
    gameId: game ? "tide-test" : null,
    mode,
    watching,
    hostName,
    watchedId: watching ? "tide-test" : null,
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
  return renderToStaticMarkup(<Tide />);
}

describe("Tide spectator rendering", () => {
  it("keeps coordinate inspection but removes placement controls", () => {
    const markup = renderGame(edition.create({}));
    expect(markup).toContain("HostPlayer’s turn");
    expect(markup).toContain("Read-only live board");
    expect(markup.match(/aria-disabled="true"/g)).toHaveLength(36);
    expect(markup.match(/tabindex="0"/g)).toHaveLength(1);
    expect(markup).not.toContain("Place stone");
    expect(markup).not.toContain("Start fresh");
    expect(markup).toMatch(/<button disabled="">New game<\/button>/);
  });
  it("renders expiration from the canonical revision and keeps anchored stones", () => {
    const game = edition.create({});
    game.board[0] = 1;
    game.board[1] = 2;
    game.expires[0] = 12;
    game.anchored[1] = true;
    game.revision = 10;
    const markup = renderGame(game);
    expect(markup).toContain("HostPlayer, 1 turn until it washes away");
    expect(markup).toContain("Undertow, anchored");
    expect(renderGame(game)).toBe(markup);
  });
  it.each([1, 2] as const)(
    "announces the actual player %i winner",
    (winner) => {
      const markup = renderGame({ ...edition.create({}), winner });
      expect(markup).toContain(
        winner === 1 ? "HostPlayer wins!" : "Undertow wins!",
      );
      expect(markup).not.toContain("You win");
      expect(markup).not.toContain("Play again");
    },
  );
  it("uses same-device role names and a neutral fallback", () => {
    expect(renderGame(edition.create({}), true, "duel")).toContain(
      "Coral’s turn",
    );
    expect(renderGame(edition.create({}), true, "solo", null)).toContain(
      "Redditor’s turn",
    );
  });
  it("does not offer a new game while waiting for a broadcast", () => {
    const markup = renderGame(null);
    expect(markup).toContain("Waiting for the broadcast");
    expect(markup).not.toContain("Begin a game");
  });
  it("retains personal play controls", () => {
    const markup = renderGame(edition.create({}), false);
    expect(markup).toContain("Your turn");
    expect(markup).toContain("Place stone");
  });
});
