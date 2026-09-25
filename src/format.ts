import type { SerializableBoard } from "./game/types";

export const scoringLabel = (scoring: SerializableBoard["scoring"]) =>
  scoring === "true" ? "True Area" : "Grid Footprint";

/** Fading pieces as a phrase or a sentence; nothing when stones are permanent. */
export const fadeLabel = (
  fadeTurns = 0,
  form: "phrase" | "sentence" = "phrase",
) =>
  fadeTurns
    ? `${form === "sentence" ? "Stones" : "stones"} fade after ${fadeTurns} turns`
    : "";

/** "8×8 · Grid Footprint · first to 150", plus fading pieces when on. */
export const rulesSummary = (rules: {
  W: number;
  H: number;
  scoring: SerializableBoard["scoring"];
  winScore: number;
  fadeTurns?: number;
}) =>
  [
    `${rules.W}×${rules.H}`,
    scoringLabel(rules.scoring),
    `first to ${rules.winScore}`,
    fadeLabel(rules.fadeTurns),
  ]
    .filter(Boolean)
    .join(" · ");
