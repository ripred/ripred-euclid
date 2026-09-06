import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { Board, Player } from "../shared/game/engine";
import type {
  RankingsSharePayload,
  ResultSharePayload,
} from "../shared/types/api";
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

function rankingsFixture(
  overrides: Partial<RankingsSharePayload> = {},
): RankingsSharePayload {
  return {
    kind: "rankings",
    shareId: "frozen-rankings",
    subredditName: "ripred_euclid_dev",
    sharedAt: "2026-09-05T22:00:00.000Z",
    bucket: "hvh",
    title: "Redditor rankings",
    subtitle: "A frozen snapshot of the leaderboard",
    rows: Array.from({ length: 6 }, (_, index) => ({
      userId: `player-${index + 1}`,
      name: `Frozen player ${index + 1}`,
      rating: 1100 + index * 10,
      games: 10,
      wins: 6,
      losses: 4,
      draws: 0,
    })),
    ...overrides,
  };
}

const noOp = () => undefined;

describe("shared victory presentation", () => {
  it.each(["dark", "light"] as const)(
    "keeps canonical scores in the inline summary and full expanded replay (%s)",
    (theme) => {
      const share = resultFixture();
      const result = renderToStaticMarkup(
        <ResultShareView share={share} theme={theme} />,
      );
      const inline = renderToStaticMarkup(
        <SharePreview share={share} theme={theme} onExpand={noOp} />,
      );
      for (const markup of [inline, result]) {
        expect(markup.match(/<h1>/g)).toHaveLength(1);
        expect(markup).toContain("<h1>ripred3 defeated Euclid!</h1>");
        expect(markup).toContain('aria-label="Final scores"');
        expect(markup).toContain(">165<span");
        expect(markup).toContain(">0<span");
        expect(markup).toContain(share.subtitle);
        expect(markup).toContain('dateTime="2026-09-05T22:00:00.000Z"');
      }
      expect(result).toContain(share.footer);
      expect(result).toContain("Real Game Replay");
      expect(result).toContain("<svg");
      expect(inline).toContain('aria-label="View full result &amp; replay"');
      expect(inline).not.toContain("Real Game Replay");
      expect(inline).not.toContain("<svg");
      expect(inline).not.toContain(share.footer);
      expect(inline).not.toContain('tabindex="0"');
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
    for (const view of [
      <ResultShareView share={share} theme="dark" />,
      <SharePreview share={share} theme="dark" onExpand={noOp} />,
    ]) {
      const markup = renderToStaticMarkup(view);
      const scores = markup.slice(
        markup.indexOf("<dl"),
        markup.indexOf("</dl>"),
      );
      expect(scores).toMatch(/ripred3[\s\S]*>165<span[^>]*>Opponent/);
      expect(scores).toMatch(/player_two[\s\S]*>0<span[^>]*>Winner/);
      expect(markup).toContain(share.details);
    }
  });

  it("keeps long text intact and escapes user-provided content", () => {
    const name = "a_very_long_player_name".repeat(12);
    const share = resultFixture({
      p1Name: name,
      headline: name + " Wins!",
      details: "<script>bad()</script>",
    });
    for (const view of [
      <ResultShareView share={share} theme="light" />,
      <SharePreview share={share} theme="light" onExpand={noOp} />,
    ]) {
      const markup = renderToStaticMarkup(view);
      expect(markup).toContain(name);
      expect(markup).toContain("&lt;script&gt;bad()&lt;/script&gt;");
      expect(markup).not.toContain("<script>");
    }
  });

  // Structural guard for the clipping regression; this does not substitute for
  // checking actual embed dimensions and scrolling in Reddit.
  it("retains the expanded result's focusable viewport-bounded scroll owner", () => {
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

describe("inline shared leaderboard snapshots", () => {
  it.each([
    ["hvh", "dark"],
    ["hvh", "light"],
    ["hva", "dark"],
    ["hva", "light"],
  ] as const)(
    "preserves snapshot order and identity for %s in %s",
    (bucket, theme) => {
      const share = rankingsFixture({ bucket });
      const markup = renderToStaticMarkup(
        <SharePreview share={share} theme={theme} onExpand={noOp} />,
      );
      expect(markup).toContain("Euclid · Leaderboard snapshot");
      expect(markup).toContain(share.title);
      expect(markup).toContain(share.subtitle);
      expect(markup).toContain('dateTime="2026-09-05T22:00:00.000Z"');
      expect(markup.match(/<li>/g)).toHaveLength(3);
      expect(markup.indexOf("Frozen player 1")).toBeLessThan(
        markup.indexOf("Frozen player 2"),
      );
      expect(markup.indexOf("Frozen player 2")).toBeLessThan(
        markup.indexOf("Frozen player 3"),
      );
      expect(markup).not.toContain("Frozen player 4");
      expect(markup).toContain('aria-label="View full leaderboard snapshot"');
    },
  );

  it.each([0, 1, 3, 6])("handles a snapshot containing %i rows", (count) => {
    const share = rankingsFixture();
    share.rows = share.rows.slice(0, count);
    const markup = renderToStaticMarkup(
      <SharePreview share={share} theme="dark" onExpand={noOp} />,
    );
    expect(markup.match(/<li>/g) ?? []).toHaveLength(Math.min(count, 3));
    expect(markup.includes("No ranked players in this snapshot.")).toBe(
      count === 0,
    );
    expect(markup).toContain('aria-label="View full leaderboard snapshot"');
  });

  it("retains long canonical names and ratings while escaping display text", () => {
    const share = rankingsFixture({
      title: "A very long leaderboard title ".repeat(20),
      subtitle: "A very long leaderboard explanation ".repeat(20),
    });
    share.rows[0]!.name = "";
    share.rows[0]!.userId = "long_player_".repeat(30);
    share.rows[1]!.name = "<script>bad()</script>";
    share.rows[1]!.rating = 123456789;
    const markup = renderToStaticMarkup(
      <SharePreview share={share} theme="light" onExpand={noOp} />,
    );
    expect(markup).toContain(share.rows[0]!.userId);
    expect(markup).toContain("&lt;script&gt;bad()&lt;/script&gt;");
    expect(markup).not.toContain("<script>");
    expect(markup).toContain('aria-label="Rating 123456789"');
    expect(markup).toContain(share.title);
    expect(markup).toContain(share.subtitle);
  });
});

describe("inline share expansion and sizing", () => {
  it.each([resultFixture(), rankingsFixture()])(
    "offers one explicit $kind expansion action without invoking it during render",
    (share) => {
      const onExpand = vi.fn();
      const markup = renderToStaticMarkup(
        <SharePreview share={share} theme="dark" onExpand={onExpand} />,
      );
      expect(onExpand).not.toHaveBeenCalled();
      expect(markup.match(/<button\b/g)).toHaveLength(1);
      expect(markup).toContain('<button type="button"');
      expect(markup).not.toContain('role="alert"');
    },
  );

  // CSS guards establish separate inline/expanded responsibilities; actual
  // viewport fit and parent-feed scrolling still require browser verification.
  it("reserves the inline action row and adapts summaries in short or narrow frames", () => {
    const css = readFileSync(
      new URL("./share-preview.css", import.meta.url),
      "utf8",
    );
    const shell = css.match(/\.euclid-share-preview \{([^}]+)\}/)?.[1];
    expect(shell).toContain("height: 100vh;");
    expect(shell).toContain("height: 100dvh;");
    expect(shell).toContain("overflow: clip;");
    const inlineCss = css.slice(css.indexOf(".euclid-share-preview {"));
    expect(inlineCss).toContain("grid-template-rows: minmax(0, 1fr) auto;");
    expect(inlineCss).toContain("min-height: 44px;");
    expect(inlineCss).toContain("@media (max-height: 380px)");
    expect(inlineCss).toContain("@media (max-height: 260px)");
    expect(inlineCss).toContain("@media (max-width: 260px)");
    expect(inlineCss).not.toMatch(/overflow(?:-[xy])?:\s*(?:auto|scroll)/);
    expect(inlineCss).not.toContain("touch-action:");
  });
});
