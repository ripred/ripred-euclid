import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { H2HLiveGameSummary } from "../shared/types/api";
import { buildWatchDemo } from "./watch-demo";
import {
  WatchActions,
  WatchLobby,
  WatchReplay,
  WatchUnavailable,
} from "./watch-view";

const noOp = () => undefined;
const callbacks = {
  onRefresh: noOp,
  onWatch: noOp,
  onDemo: noOp,
  onPlay: noOp,
};

const game: H2HLiveGameSummary = {
  gameId: "match-1",
  playerIds: ["one", "two"],
  // Profile enrichment can change map insertion order, never the score order.
  names: { two: "Second_Player", one: "First_Player" },
  scores: [35, 12],
  lastSaved: Date.UTC(2026, 8, 6, 12, 34, 56),
  revision: 12,
  width: 6,
  height: 8,
  scoring: "bbox",
  winScore: 75,
};

describe("spectator lobby", () => {
  it("shows ordered names and scores alongside match rules and exact activity time", () => {
    const markup = renderToStaticMarkup(
      <WatchLobby {...callbacks} games={[game]} loading={false} error={null} />,
    );
    expect(markup).toContain("Euclid — Watch Live");
    expect(markup).toContain("1 live game");
    expect(markup).toContain("First_Player vs Second_Player");
    expect(markup).toContain("<dt>First_Player</dt><dd>35</dd>");
    expect(markup).toContain("<dt>Second_Player</dt><dd>12</dd>");
    expect(markup).toContain("Redditor match · 6 × 8 · First to 75");
    expect(markup).toContain('dateTime="2026-09-06T12:34:56.000Z"');
    expect(markup).toContain("Last activity:");
    expect(markup).toContain("does not join the match");
    expect(markup).not.toContain("online");
    expect(markup).not.toContain("Watch demo");
  });

  it("distinguishes loading and errors from an empty lobby and hides stale counts", () => {
    const loading = renderToStaticMarkup(
      <WatchLobby {...callbacks} games={[game]} loading error={null} />,
    );
    expect(loading).toContain('role="status"');
    expect(loading).toContain("Finding live games…");
    expect(loading).not.toContain("1 live game");
    expect(loading).not.toContain("No live games");
    expect(loading).toContain('disabled=""');
    expect(loading).toContain(">Play</button>");

    const failed = renderToStaticMarkup(
      <WatchLobby
        {...callbacks}
        games={[game]}
        loading={false}
        error="Please try later."
      />,
    );
    expect(failed).toContain('role="alert"');
    expect(failed).toContain("Could not load live games");
    expect(failed).toContain("Please try later.");
    expect(failed).toContain(">Retry</button>");
    expect(failed).toContain(">Watch demo</button>");
    expect(failed).not.toContain("1 live game");
    expect(failed).not.toContain("No live games");
  });

  it("offers an explicit demo and Play in the empty lobby for either theme", () => {
    for (const theme of ["dark", "light"] as const) {
      const markup = renderToStaticMarkup(
        <WatchLobby
          {...callbacks}
          games={[]}
          loading={false}
          error={null}
          theme={theme}
        />,
      );
      expect(markup).toContain(`data-theme="${theme}"`);
      expect(markup).toContain("No live games right now");
      expect(markup).toContain("recorded teaching demo");
      expect(markup).toContain(">Watch demo</button>");
      expect(markup).toContain(">Play</button>");
      expect(markup).toContain(">Refresh</button>");
      expect(markup).not.toContain("Real Game Replay");
    }
  });

  it("uses neutral fallback names and safely renders untrusted display strings", () => {
    const markup = renderToStaticMarkup(
      <WatchLobby
        {...callbacks}
        games={[
          { ...game, names: { two: "<script>name</script>" }, lastSaved: NaN },
        ]}
        loading={false}
        error={null}
      />,
    );
    expect(markup).toContain("Player 1 vs &lt;script&gt;name&lt;/script&gt;");
    expect(markup).not.toContain("<script>");
    expect(markup).not.toContain("Invalid Date");
    expect(markup).toContain("Last activity: unknown");
  });
});

describe("spectator continuation", () => {
  it.each([true, false])(
    "focuses exactly one terminal action with replay available=%s",
    (canReplay) => {
      const markup = renderToStaticMarkup(
        <WatchActions
          initialFocus
          onReplay={canReplay ? noOp : undefined}
          onAnother={noOp}
          onPlay={noOp}
        />,
      );
      const focusedButtons = markup.match(
        /<button[^>]*autofocus=""[^>]*>[^<]*<\/button>/g,
      );
      expect(focusedButtons).toHaveLength(1);
      expect(focusedButtons?.[0]).toContain(
        `>${canReplay ? "Replay" : "Another live game"}</button>`,
      );
    },
  );

  it("does not request automatic focus outside a result dialog", () => {
    const markup = renderToStaticMarkup(
      <WatchActions onReplay={noOp} onAnother={noOp} onPlay={noOp} />,
    );
    expect(markup).not.toContain("autofocus");
  });

  it("offers replay only when a confirmed recording callback exists", () => {
    const actions = { onAnother: noOp, onPlay: noOp, onDemo: noOp };
    const ended = renderToStaticMarkup(
      <WatchActions {...actions} onReplay={noOp} />,
    );
    expect(ended).toContain(">Replay</button>");
    expect(ended).toContain(">Another live game</button>");
    expect(ended).toContain(">Play</button>");
    expect(ended).not.toContain("Watch demo");

    const unavailable = renderToStaticMarkup(<WatchUnavailable {...actions} />);
    expect(unavailable).toContain("no confirmed final board to replay");
    expect(unavailable).toContain(">Watch demo</button>");
    expect(unavailable).not.toContain(">Replay</button>");
    expect(unavailable).not.toContain("Real Game Replay");
  });

  it("reuses the replay board but never labels the teaching sequence as a real game", () => {
    const markup = renderToStaticMarkup(
      <WatchReplay board={null} theme="light" onAnother={noOp} onPlay={noOp} />,
    );
    expect(markup).toContain("Euclid — Watch demo");
    expect(markup).toContain("not a live match");
    expect(markup).toContain("Teaching Demo");
    expect(markup).toContain("Demo starting position");
    expect(markup).toContain("Demo total");
    expect(markup).not.toContain("Real Game Replay");
    expect(markup).not.toContain("real finished game");
    expect(markup).not.toContain("Final");
    expect(markup).not.toContain("Live now");
  });

  it("preserves the supplied canonical result headline instead of inferring a winner from scores", () => {
    const markup = renderToStaticMarkup(
      <WatchReplay
        board={buildWatchDemo()}
        theme="dark"
        headline="Second_Player wins by forfeit"
        onAnother={noOp}
        onPlay={noOp}
      />,
    );
    expect(markup).toContain("Euclid — Match replay");
    expect(markup).toContain("Second_Player wins by forfeit");
    expect(markup).toContain("Real Game Replay");
    expect(markup).toContain("This does not affect the result.");
    expect(markup).not.toContain("Teaching Demo");
  });
});
