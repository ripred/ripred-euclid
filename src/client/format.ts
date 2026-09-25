import {
  AI_DIFFICULTY_LABELS,
  RANKED_SOLO_RULES,
  type AiDifficulty,
} from "../shared/game/rules";
import type { SerializableBoard } from "../shared/types/api";

/** Long-form date shared by posts and share snapshots. */
export const formatDisplayDate = (input: string | number | Date = Date.now()) =>
  new Date(input).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });

export const scoringLabel = (scoring: SerializableBoard["scoring"]) =>
  scoring === "true" ? "True Area" : "Grid Footprint";

/** "8×8 · Grid Footprint · first to 150" */
export const rulesSummary = (rules: {
  W: number;
  H: number;
  scoring: SerializableBoard["scoring"];
  winScore: number;
}) =>
  `${rules.W}×${rules.H} · ${scoringLabel(rules.scoring)} · first to ${rules.winScore}`;

/** The Ranked preset as players read it, from the server's rules when known. */
export const rankedPresetLabel = (
  rules: {
    W: number;
    H: number;
    scoring: SerializableBoard["scoring"];
    winScore: number;
    difficulty: AiDifficulty;
  } = RANKED_SOLO_RULES,
) =>
  `${rulesSummary(rules)} · Euclid on ${AI_DIFFICULTY_LABELS[rules.difficulty]}`;
