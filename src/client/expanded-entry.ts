export type ExpandedEntry =
  | "game"
  | "leaderboard"
  | "watch"
  | "solo"
  | "reddit";

/** Ordinary entry documents select a local screen. */
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

export type ExpandedAction = "solo" | "reddit";
export function expandedInitialAction(
  entry: string | undefined,
): ExpandedAction | null {
  return entry === "solo" || entry === "reddit" ? entry : null;
}
