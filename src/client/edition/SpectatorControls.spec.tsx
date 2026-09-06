import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { EditionState } from "../../shared/edition-contract";
import { requestEdition } from "./edition-api";
import { SpectatorControls } from "./SpectatorControls";
import { useEdition } from "./use-edition";

vi.mock("./use-edition", () => ({ useEdition: vi.fn() }));
vi.mock("./edition-api", () => ({ requestEdition: vi.fn() }));

type Session = ReturnType<typeof useEdition<EditionState>>;

function renderControls(overrides: Partial<Session> = {}): string {
  const session: Session = {
    game: { revision: 1, turn: 1, winner: null },
    gameId: "personal-game",
    mode: "solo",
    loading: false,
    busy: false,
    error: null,
    watching: false,
    watchedId: null,
    hostName: null,
    ownerGameId: "personal-game",
    spectatorsEnabled: false,
    start: vi.fn(async () => true),
    move: vi.fn(async () => true),
    reload: vi.fn(async () => undefined),
    watch: vi.fn(async () => undefined),
    stopWatching: vi.fn(),
    setSpectatorsEnabled: vi.fn(async () => true),
    ...overrides,
  };
  vi.mocked(useEdition<EditionState>).mockReturnValue(session);
  return renderToStaticMarkup(<SpectatorControls />);
}

function button(markup: string, label: string): string {
  const tag = markup.match(
    new RegExp(`<button\\b[^>]*>${label}</button>`),
  )?.[0];
  expect(tag).toBeDefined();
  return tag ?? "";
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("Live spectator controls", () => {
  it("requires a personal game before offering an opt-in broadcast", () => {
    const markup = renderControls({
      game: null,
      gameId: null,
      ownerGameId: null,
    });
    expect(button(markup, "Allow spectators")).toContain("disabled");
    expect(markup).toContain("Start a game to allow spectators.");
    expect(markup).toContain("<summary>Live games</summary>");
  });

  it("shows an active game as private until sharing is explicitly enabled", () => {
    const setSpectatorsEnabled = vi.fn(async () => true);
    const markup = renderControls({ setSpectatorsEnabled });
    expect(button(markup, "Allow spectators")).not.toContain("disabled");
    expect(button(markup, "Allow spectators")).toContain(
      'aria-pressed="false"',
    );
    expect(markup).toContain("This game is private until you share it.");
    expect(setSpectatorsEnabled).not.toHaveBeenCalled();
    expect(requestEdition).not.toHaveBeenCalled();
  });

  it("lets a broadcaster stop sharing", () => {
    const markup = renderControls({ spectatorsEnabled: true });
    expect(button(markup, "Stop sharing")).toContain('aria-pressed="true"');
    expect(button(markup, "Stop sharing")).not.toContain("disabled");
    expect(markup).toContain("Spectators are allowed for this game.");
  });

  it("does not start a new broadcast for a completed private game", () => {
    const markup = renderControls({
      game: { revision: 8, turn: 1, winner: 1 },
    });
    expect(button(markup, "Allow spectators")).toContain("disabled");
    expect(markup).toContain("Share an active game to let others watch.");
  });

  it("still allows an existing broadcast to be revoked after its final result", () => {
    const markup = renderControls({
      game: { revision: 8, turn: 1, winner: 1 },
      spectatorsEnabled: true,
    });
    expect(button(markup, "Stop sharing")).not.toContain("disabled");
  });

  it("identifies the host and read-only view without an owner sharing toggle", () => {
    const markup = renderControls({
      watching: true,
      watchedId: "host-game",
      gameId: "host-game",
      hostName: "HostPlayer",
    });
    expect(markup).toContain("Watching HostPlayer");
    expect(markup).toContain("Read-only · updates live");
    expect(button(markup, "Back to my game")).not.toContain("disabled");
    expect(markup).not.toContain("Allow spectators");
    expect(markup).not.toContain("Stop sharing");
  });

  it("uses neutral text while connecting without a host snapshot", () => {
    const markup = renderControls({
      watching: true,
      watchedId: "host-game",
      gameId: null,
      game: null,
      loading: true,
      busy: true,
    });
    expect(markup).toContain("Spectator view");
    expect(markup).toContain("Connecting…");
    expect(markup).not.toContain("final result");
    expect(button(markup, "Back to my game")).not.toContain("disabled");
  });

  it("keeps reconnect and return actions available after access is revoked", () => {
    const markup = renderControls({
      watching: true,
      watchedId: "host-game",
      game: null,
      error: "This player stopped sharing the game.",
    });
    expect(markup).toContain("Connection paused");
    expect(markup).toContain("This player stopped sharing the game.");
    expect(button(markup, "Retry connection")).not.toContain("disabled");
    expect(button(markup, "Back to my game")).not.toContain("disabled");
    expect(markup).not.toContain("Allow spectators");
  });

  it("labels a watched final result without implying the spectator won", () => {
    const markup = renderControls({
      watching: true,
      watchedId: "host-game",
      hostName: "HostPlayer",
      game: { revision: 8, turn: 1, winner: 1 },
    });
    expect(markup).toContain("Read-only · final result");
    expect(markup).not.toContain("You win");
  });

  it("renders broadcaster names as text, not markup", () => {
    const hostName = "<script>alert('watch')</script>";
    const markup = renderControls({
      watching: true,
      watchedId: "host-game",
      hostName,
    });
    expect(markup).toContain("Watching &lt;script&gt;");
    expect(markup).not.toContain("<script>");
  });
});
