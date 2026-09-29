export type ExpandedEntry =
  | "game"
  | "challenge"
  | "daily"
  | "weekly"
  | "leaderboard"
  | "watch"
  | "solo"
  | "reddit";

/** Ordinary entry documents select a local screen. */
export function expandedInitialMode(
  entry: string | undefined,
): "challenge" | "daily" | "weekly" | "rankings" | "spectate" | null {
  switch (entry) {
    case "daily":
    case "weekly":
      return entry;
    case "challenge":
      return "challenge";
    case "leaderboard":
      return "rankings";
    case "watch":
      return "spectate";
    default:
      return null;
  }
}

export type ExpandedAction = "solo" | "reddit";
export function expandedInitialAction(
  entry: string | undefined,
): ExpandedAction | null {
  return entry === "solo" || entry === "reddit" ? entry : null;
}
