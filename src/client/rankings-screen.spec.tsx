import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { RankingsScreen } from "./rankings-screen";
import { PreviewLeaderboard } from "./preview";
import type { LoadedRankings } from "./rankings-loader";

vi.mock("@devvit/web/client", () => ({ requestExpandedMode: vi.fn() }));
const rankings: LoadedRankings = {
  preview: true,
  hvh: Array.from({ length: 500 }, (_, i) => ({
    userId: `sample-${i}`,
    name: `sample_player_${i}`,
    rating: 2400 - i,
    games: 20,
    wins: 10,
    losses: 9,
    draws: 1,
  })),
  hva: [],
};

it("renders all 500 sample players on the full leaderboard and disables sharing fictional results", () => {
  const html = renderToStaticMarkup(
    <RankingsScreen
      rankings={rankings}
      loaded
      loading={false}
      error={null}
      notice=""
      shareBusy={null}
      onRetry={() => {}}
      onShare={() => {}}
      onBack={() => {}}
    />,
  );
  expect(html.match(/<li /g)).toHaveLength(500);
  expect(html).toContain("sample_player_499");
  expect(html).toContain("500 players");
  expect(html).toContain("Results are fictional");
  expect(html).not.toContain("Share leaderboard");
});

it("keeps the splash limited to three of the 500 sample entries", () => {
  const html = renderToStaticMarkup(
    <PreviewLeaderboard
      theme="dark"
      rankings={rankings}
      rankingsLoading={false}
      rankingsError={null}
      onInteract={() => {}}
    />,
  );
  expect(html.match(/<li /g)).toHaveLength(3);
  expect(html).toContain("500 sample players");
  expect(html).not.toContain("sample_player_3");
});
