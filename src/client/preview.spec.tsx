import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { RankingsShareRow } from "../shared/types/api";

vi.mock("@devvit/web/client", () => ({ requestExpandedMode: vi.fn() }));
import { PreviewApp, PreviewLeaderboard, PreviewStatus } from "./preview";

const source = (file: string) =>
  readFileSync(new URL(file, import.meta.url), "utf8");
const rows: RankingsShareRow[] = Array.from({ length: 8 }, (_, index) => ({
  userId: `player-${index}`,
  name: `Player ${index}`,
  rating: 1600 - index,
  wins: 12,
  losses: 8,
  draws: 0,
  games: 20,
}));

describe("inline preview", () => {
  it("loads without mounting a game or requesting expansion", () => {
    const html = renderToStaticMarkup(<PreviewApp />);
    expect(html).toBe("");
  });

  it.each(["dark", "light"] as const)(
    "offers bounded standings in %s mode",
    (theme) => {
      const html = renderToStaticMarkup(
        <PreviewLeaderboard
          theme={theme}
          rankings={{ hvh: rows, hva: [] }}
          rankingsLoading={false}
          rankingsError={null}
          onInteract={() => {}}
        />,
      );
      expect(html).toContain("Player 0");
      expect(html).toContain("Player 2");
      expect(html).not.toContain("Player 3");
      expect(html).toContain('aria-label="Leaderboard mode"');
      expect(html.match(/aria-pressed=/g)).toHaveLength(2);
      expect(html).not.toContain("overflow-y:auto");
      expect(html).not.toContain("Scroll to explore");
    },
  );

  it.each([
    [true, null, "Loading leaderboard"],
    [false, "unavailable", "Unable to load standings"],
    [false, null, "No entries yet"],
  ] as const)(
    "explains empty standings without a scroll panel",
    (loading, error, message) => {
      const html = renderToStaticMarkup(
        <PreviewLeaderboard
          theme="dark"
          rankings={{ hvh: [], hva: [] }}
          rankingsLoading={loading}
          rankingsError={error}
          onInteract={() => {}}
        />,
      );
      expect(html).toContain(message);
    },
  );

  it("makes an initialization failure retryable and escapes error text", () => {
    const html = renderToStaticMarkup(
      <PreviewStatus
        theme="dark"
        title="Unable to load Euclid"
        body="<script>invalid</script>"
        onRetry={() => {}}
      />,
    );
    expect(html).toContain("Try again");
    expect(html).toContain("&lt;script&gt;");
  });

  it("keeps inline bounds separate from every expanded entry", () => {
    const preview = source("./preview.html");
    expect(preview).toContain('class="euclid-inline"');
    expect(preview).toContain("preview-main.tsx");
    const manifest = JSON.parse(source("../../devvit.json"));
    expect(manifest.post.entrypoints.default.inline).toBe(true);
    for (const [entry, file] of [
      ["game", "index.html"],
      ["leaderboard", "leaderboard.html"],
      ["watch", "watch.html"],
      ["solo", "solo.html"],
      ["reddit", "reddit.html"],
    ] as const) {
      const html = source(`./${file}`);
      expect(html).not.toContain("euclid-inline");
      expect(html).toContain("main.tsx");
      if (entry !== "game") expect(html).toContain(`data-entry="${entry}"`);
      expect(manifest.post.entrypoints[entry].entry).toBe(file);
      expect(manifest.post.entrypoints[entry].inline).toBeUndefined();
      expect(source("./vite.config.ts")).toContain(`${entry}: "${file}"`);
    }
    expect(source("./preview.css")).toContain("overflow: clip;");
    expect(source("./preview.tsx")).not.toMatch(
      /onWheel=|onTouchStart=|onScroll=/,
    );
  });
});
