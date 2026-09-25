/** Finalized results only. Active attempts and solution boards stay private. */
export interface ChallengeWinner {
  username: string;
  avatar?: string;
  moves: number;
  elapsedMs: number;
  dailyWins: number;
  weeklyWins: number;
}

export interface ChallengeSpotlights {
  preview: boolean;
  daily: ChallengeWinner | null;
  weekly: ChallengeWinner | null;
}

export const EMPTY_CHALLENGE_SPOTLIGHTS: ChallengeSpotlights = {
  preview: false,
  daily: null,
  weekly: null,
};
