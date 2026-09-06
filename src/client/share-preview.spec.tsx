import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { Board, Player } from "../shared/game/engine";
import type { ResultSharePayload } from "../shared/types/api";
import { ResultShareView, SharePreview } from "./share-preview";

function resultFixture(
  overrides: Partial<ResultSharePayload> = {},
): ResultSharePayload {
  const board = new Board(new Player(), new Player(), {
    W: 8,
    H: 8,
    winScore: 150,
    scoring: "bbox",
  }).toJSON();
  board.m_players = board.m_players.map((player, index) => ({
    ...player,
    m_score: index === 0 ? 165 : 0,
  }));
  return {
    kind: "result",
    shareId: "shared-victory",
    subredditName: "ripred_euclid_dev",
    sharedAt: "2026-09-05T22:00:00.000Z",
    mode: "ai",
    title: "Redditor vs Euclid",
    subtitle: "Practice · 8×8 · Grid Footprint · First to 150 · Beginner",
    headline: "ripred3 defeated Euclid!",
    details: "165–0",
    footer: "Play Euclid on Reddit",
    p1Name: "ripred3",
    p2Name: "Euclid",
    winnerSide: 1,
    board,
    ...overrides,
  };
}

describe("shared victory presentation", () => {
  it.each(["dark", "light"] as const)(
    "uses one result layout in both entrypoints (%s)",
    (theme) => {
      const share = resultFixture();
      const result = renderToStaticMarkup(
        <ResultShareView share={share} theme={theme} />,
      );
      expect(
        renderToStaticMarkup(<SharePreview share={share} theme={theme} />),
      ).toBe(result);
      expect(result.match(/<h1>/g)).toHaveLength(1);
      expect(result).toContain("<h1>ripred3 defeated Euclid!</h1>");
      expect(result).toContain('aria-label="Final scores"');
      expect(result).toContain(">165<span");
      expect(result).toContain(">0<span");
      expect(result).toContain(share.subtitle);
      expect(result).toContain(share.footer);
      expect(result).toContain("Real Game Replay");
      expect(result).toContain('dateTime="2026-09-05T22:00:00.000Z"');
    },
  );

  it("keeps the canonical winner and explanation when the lower-scoring side wins by forfeit", () => {
    const share = resultFixture({
      mode: "h2h",
      p2Name: "player_two",
      winnerSide: 2,
      headline: "player_two Wins!",
      details: "player_two advanced after ripred3 left the match.",
    });
    const markup = renderToStaticMarkup(
      <ResultShareView share={share} theme="dark" />,
    );
    const scores = markup.slice(markup.indexOf("<dl"), markup.indexOf("</dl>"));
    expect(scores).toMatch(/ripred3[\s\S]*>165<span[^>]*>Opponent/);
    expect(scores).toMatch(/player_two[\s\S]*>0<span[^>]*>Winner/);
    expect(markup).toContain(share.details);
  });

  it("keeps long text intact and escapes user-provided content", () => {
    const name = "a_very_long_player_name";
    const share = resultFixture({
      p1Name: name,
      headline: name + " Wins!",
      details: "<script>bad()</script>",
    });
    const markup = renderToStaticMarkup(
      <ResultShareView share={share} theme="light" />,
    );
    expect(markup).toContain(name);
    expect(markup).toContain("&lt;script&gt;bad()&lt;/script&gt;");
    expect(markup).not.toContain("<script>");
  });

  // Structural guard for the clipping regression; this does not substitute for
  // checking actual embed dimensions and scrolling in Reddit.
  it("gives the result a focusable, viewport-bounded scroll owner", () => {
    const markup = renderToStaticMarkup(
      <ResultShareView share={resultFixture()} theme="dark" />,
    );
    expect(markup).toContain('aria-label="Shared game result" tabindex="0"');
    const css = readFileSync(
      new URL("./share-preview.css", import.meta.url),
      "utf8",
    );
    const shell = css.match(/\.euclid-result-share \{([^}]+)\}/)?.[1];
    expect(shell).toContain("height: 100vh;");
    expect(shell).toContain("height: 100dvh;");
    expect(shell).toContain("overflow: auto;");
    expect(shell).toContain("overflow-wrap: anywhere;");
    expect(shell).not.toContain("min-height:");
    const app = readFileSync(new URL("./App.tsx", import.meta.url), "utf8");
    expect(app).toContain(
      'return <ResultShareView share={share} theme="dark" />',
    );
  });
});
