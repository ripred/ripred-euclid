import {
  playerColorForIndex,
  type PlayerColor,
  type SoloMode,
} from "../game/rules";
import { countsAsForfeit, isHumanTurn, type SoloGame } from "./session";

/** Player-facing reading of a game: who won, what to say, what leaving does. */

export type SoloResultKind = "running" | "win" | "loss" | "tie" | "abandoned";

export interface SoloResultPresentation {
  result: SoloResultKind;
  headline: string;
  terminal: boolean;
  humanSide: PlayerColor;
  euclidSide: PlayerColor;
  winnerSide: PlayerColor | null;
  isLocalVictory: boolean;
}

export type SoloExitLabel =
  | "Close"
  | "End Practice"
  | "Cancel Ranked"
  | "Abandon Ranked";

export interface SoloExitAction {
  label: SoloExitLabel;
  /** Leaving records a Ranked loss, so the player confirms first. */
  countsAsLoss: boolean;
}

/** Hints are a Practice aid; Ranked results are always earned unassisted. */
export const allowsHints = (mode: SoloMode) => mode === "practice";

export function soloResultPresentation(game: SoloGame): SoloResultPresentation {
  const humanSide = playerColorForIndex(game.rules.humanPlayer);
  const euclidSide: PlayerColor = humanSide === 1 ? 2 : 1;
  const winnerSide = game.outcome.winner;
  const forfeit = game.status === "abandoned" && countsAsForfeit(game);

  let result: SoloResultKind;
  if (game.status === "active") result = "running";
  else if (forfeit) result = "loss";
  else if (game.status === "abandoned") result = "abandoned";
  else if (winnerSide === humanSide) result = "win";
  else if (winnerSide === euclidSide) result = "loss";
  else result = "tie";

  const headline =
    result === "win"
      ? "You win!"
      : result === "loss"
        ? forfeit
          ? "Ranked game forfeited"
          : "Euclid wins"
        : result === "tie"
          ? "Tie game"
          : result === "abandoned"
            ? game.rules.mode === "ranked"
              ? "Ranked game canceled"
              : "Practice ended"
            : isHumanTurn(game)
              ? "Your move"
              : "Euclid is thinking…";

  return {
    result,
    headline,
    terminal: result !== "running",
    humanSide,
    euclidSide,
    winnerSide,
    isLocalVictory: result === "win",
  };
}

export function soloExitAction(game: SoloGame): SoloExitAction {
  if (game.status !== "active") return { label: "Close", countsAsLoss: false };
  if (game.rules.mode === "practice") {
    return { label: "End Practice", countsAsLoss: false };
  }
  return countsAsForfeit(game)
    ? { label: "Abandon Ranked", countsAsLoss: true }
    : { label: "Cancel Ranked", countsAsLoss: false };
}
