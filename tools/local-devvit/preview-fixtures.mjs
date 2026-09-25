import { rankedSoloSessionMetadata } from "../../src/server/solo.ts";

/** Synthetic identities and results are confined to the local adapter. */
export function mockAvatarUrl(username) {
  if (!/^(sample_player_\d{3}|local_[a-z0-9_-]+)$/i.test(username))
    return undefined;
  const variant =
    [...username].reduce((sum, letter) => sum + letter.charCodeAt(0), 0) % 3;
  return `https://www.redditstatic.com/avatars/defaults/v2/avatar_default_${variant}.png`;
}

const names = Array.from(
  { length: 500 },
  (_, index) => `sample_player_${String(index + 1).padStart(3, "0")}`,
);
const rows = (players, offset) =>
  players.map((name, index) => {
    const wins = 8 + ((500 - index) % 143);
    const losses = 2 + ((index * 7 + offset) % 81);
    const draws = index % 7;
    return {
      userId: `t2_${name}`,
      name,
      avatar: mockAvatarUrl(name),
      rating: 2400 + offset - index * 2,
      wins,
      losses,
      draws,
      games: wins + losses + draws,
    };
  });

export const MOCK_RANKINGS = {
  preview: true,
  hvh: rows(names, 0),
  hva: rows([...names].reverse(), 32),
  hvaRules: rankedSoloSessionMetadata(),
};

// Omit avatar URLs here so winner cards exercise the real lookup route and cache.
export const MOCK_SPOTLIGHTS = {
  preview: true,
  daily: {
    username: names[0],
    moves: 2,
    elapsedMs: 18400,
    dailyWins: 7,
    weeklyWins: 2,
  },
  weekly: {
    username: names[499],
    moves: 3,
    elapsedMs: 42700,
    dailyWins: 12,
    weeklyWins: 3,
  },
};
