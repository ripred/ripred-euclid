import {
  AI_DIFFICULTY_LABELS,
  RANKED_SOLO_RULES,
  type AiDifficulty,
  type SoloMode,
} from "./game/rules";
import { fadeLabel, rulesSummary } from "./format";
import type { PlayerRecords, Tally } from "./solo/records";
import { isHumanTurn, type SoloGame } from "./solo/session";

/** Copy for the home screen, derived from local records and the saved game. */

export interface RecordPresentation {
  label: "Ranked" | "Practice";
  /** The headline number: the rating for Ranked, wins for Practice. */
  stat: string;
  statLabel: "Rating" | "Wins";
  record: string;
  detail: string;
}

export interface ContinuationPresentation {
  title: string;
  detail: string;
  score: string;
  rules: string;
}

const NUMBER = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

const recordLine = (tally: Tally, empty: string) =>
  tally.games === 0
    ? empty
    : `${NUMBER.format(tally.wins)}W · ${NUMBER.format(tally.losses)}L · ${NUMBER.format(tally.draws)}D`;

const gamesLine = (count: number, kind: string) =>
  `${NUMBER.format(count)} ${kind} ${count === 1 ? "game" : "games"}`;

export function recordPresentations(
  records: PlayerRecords,
): [RecordPresentation, RecordPresentation] {
  const { ranked, practice } = records;
  return [
    {
      label: "Ranked",
      stat: NUMBER.format(ranked.rating),
      statLabel: "Rating",
      record: recordLine(ranked, "No rated games yet"),
      detail:
        ranked.games === 0
          ? "Every player starts at 1,200"
          : `Best ${NUMBER.format(ranked.best)} · ${gamesLine(ranked.games, "rated")}`,
    },
    {
      label: "Practice",
      stat: NUMBER.format(practice.wins),
      statLabel: "Wins",
      record: recordLine(practice, "No practice games yet"),
      detail: gamesLine(practice.games, "practice"),
    },
  ];
}

/** Summarizes the selected path without implying that Practice is rated. */
export function playEuclidSubtitle(
  mode: SoloMode,
  difficulty: AiDifficulty,
  fadeTurns = 0,
): string {
  return mode === "ranked"
    ? `Ranked · ${AI_DIFFICULTY_LABELS[RANKED_SOLO_RULES.difficulty]} · fixed rules · rating on the line`
    : [
        "Practice",
        AI_DIFFICULTY_LABELS[difficulty],
        fadeLabel(fadeTurns),
        "no rating changes",
      ]
        .filter(Boolean)
        .join(" · ");
}

export function continuationPresentation(
  game: SoloGame,
): ContinuationPresentation {
  const human = game.rules.humanPlayer;
  const euclid = human === 0 ? 1 : 0;
  const scores = game.board.m_players;
  return {
    title: `Continue ${game.rules.mode === "ranked" ? "Ranked" : "Practice"} game`,
    detail: isHumanTurn(game) ? "Your turn against Euclid" : "Euclid's turn",
    score: `You ${scores[human]?.m_score ?? 0} · Euclid ${scores[euclid]?.m_score ?? 0}`,
    rules: rulesSummary(game.rules),
  };
}
