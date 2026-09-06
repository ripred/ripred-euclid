export type ExpandedEntry = "game" | "leaderboard" | "watch";

/** Entry documents select a local screen; they never join or start a game. */
export function expandedInitialMode(
  entry: string | undefined,
): "rankings" | "spectate" | null {
  switch (entry) {
    case "leaderboard":
      return "rankings";
    case "watch":
      return "spectate";
    default:
      return null;
  }
}
