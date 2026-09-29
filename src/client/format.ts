import {
  AI_DIFFICULTY_LABELS,
  RANKED_SOLO_RULES,
  type AiDifficulty,
  type GameVariant,
} from "../shared/game/rules";

/** Long-form date shared by posts and share snapshots. */
export const formatDisplayDate = (input: string | number | Date = Date.now()) =>
  new Date(input).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });

/** "first to 150": every game shares the standard board and scoring. */
export const rulesSummary = (rules: {
  winScore: number;
  variant?: GameVariant;
}) => `${rules.variant === "tide" ? "Tide · " : ""}first to ${rules.winScore}`;

/** The Ranked preset as players read it, from the server's rules when known. */
export const rankedPresetLabel = (
  rules: {
    winScore: number;
    difficulty: AiDifficulty;
    variant?: GameVariant;
  } = RANKED_SOLO_RULES,
) =>
  `${rulesSummary(rules)} · Euclid on ${AI_DIFFICULTY_LABELS[rules.difficulty]}`;
