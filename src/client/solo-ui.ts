import {
  playerColorForIndex,
  type PlayerColor,
  type PracticeRulesInput,
  type SoloMode,
} from "../shared/game/rules";
import type {
  PracticeSoloStartRequest,
  RankedSoloStartRequest,
  SoloAbandonRequest,
  SoloMoveRequest,
  SoloSessionSnapshot,
  SoloShareResponse,
} from "../shared/types/api";

export type SoloResultKind = "running" | "win" | "loss" | "tie" | "abandoned";

export interface SoloResultPresentation {
  result: SoloResultKind;
  headline: string;
  terminal: boolean;
  humanSide: PlayerColor;
  euclidSide: PlayerColor;
  winnerSide: PlayerColor | null;
  isLocalVictory: boolean;
  shouldCelebrate: boolean;
}

export interface SoloAssistancePolicy {
  allowAssistHighlights: boolean;
  allowAutoMove: boolean;
  allowSecretAutoMove: boolean;
}

export type SoloStartConfiguration =
  | { mode: "ranked" }
  | { mode: "practice"; rules: PracticeRulesInput };

export interface RetainedSoloStartCommand {
  intentKey: string;
  commandId: string;
}

export interface SoloSharePresentation {
  completed: boolean;
  notice: string;
}

export interface SoloShareStatusResponse {
  status?: SoloShareResponse["status"];
  message?: string;
}

export type SoloExitAction =
  | {
      label: "Close";
      notifyServer: false;
      countsAsLoss: false;
    }
  | {
      label: "End Practice" | "Cancel Ranked" | "Abandon Ranked";
      notifyServer: true;
      countsAsLoss: boolean;
    };

const RANKED_ASSISTANCE_POLICY: Readonly<SoloAssistancePolicy> = Object.freeze({
  allowAssistHighlights: false,
  allowAutoMove: false,
  allowSecretAutoMove: false,
});

const RANKED_TEST_ASSISTANCE_POLICY: Readonly<SoloAssistancePolicy> =
  Object.freeze({
    ...RANKED_ASSISTANCE_POLICY,
    allowSecretAutoMove: true,
  });

const PRACTICE_ASSISTANCE_POLICY: Readonly<SoloAssistancePolicy> =
  Object.freeze({
    allowAssistHighlights: true,
    allowAutoMove: true,
    allowSecretAutoMove: true,
  });

function requireCommandId(commandId: string): string {
  if (!commandId.trim()) {
    throw new TypeError("commandId must be a non-empty string.");
  }
  return commandId;
}

export function createSoloStartIntentKey(
  configuration: SoloStartConfiguration,
): string {
  if (configuration.mode === "ranked") return "ranked";

  const { rules } = configuration;
  return JSON.stringify({
    mode: "practice",
    W: rules.W,
    H: rules.H,
    scoring: rules.scoring,
    winScore: rules.winScore,
    difficulty: rules.difficulty,
    humanPlayer: rules.humanPlayer ?? null,
    firstPlayer: rules.firstPlayer ?? null,
  });
}

export function getOrCreateSoloStartCommand(
  current: RetainedSoloStartCommand | null,
  intentKey: string,
  createCommandId: () => string,
): RetainedSoloStartCommand {
  if (!intentKey.trim()) {
    throw new TypeError("intentKey must be a non-empty string.");
  }
  if (current?.intentKey === intentKey) return current;
  return {
    intentKey,
    commandId: requireCommandId(createCommandId()),
  };
}

export function getSoloSharePresentation(
  response: SoloShareStatusResponse,
): SoloSharePresentation {
  const message = response.message?.trim();
  if (response.status === "posted") {
    return {
      completed: true,
      notice: message || "Shared to Reddit.",
    };
  }
  if (response.status === "pending") {
    return {
      completed: false,
      notice: message
        ? `${message} Posting has not been confirmed yet.`
        : "Your win is prepared, but posting has not been confirmed yet.",
    };
  }
  return {
    completed: false,
    notice: "Reddit did not return a confirmed share status. Please try again.",
  };
}

function requireCoordinate(value: number, field: string): number {
  if (!Number.isSafeInteger(value)) {
    throw new RangeError(`${field} must be a safe integer.`);
  }
  return value;
}

function requireRevision(revision: number): number {
  if (!Number.isSafeInteger(revision) || revision < 0) {
    throw new RangeError("revision must be a non-negative safe integer.");
  }
  return revision;
}

export function shouldAdoptSoloSnapshot(
  activeGameId: string | null,
  currentRevision: number,
  incoming: Pick<SoloSessionSnapshot, "gameId" | "revision">,
): boolean {
  if (!activeGameId || incoming.gameId !== activeGameId) return false;
  if (!Number.isSafeInteger(currentRevision) || currentRevision < 0)
    return false;
  return (
    Number.isSafeInteger(incoming.revision) &&
    incoming.revision >= currentRevision
  );
}

export function getSoloAssistancePolicy(
  mode: SoloMode,
  username = "",
): Readonly<SoloAssistancePolicy> {
  if (mode !== "ranked") return PRACTICE_ASSISTANCE_POLICY;
  // Keep the testing shortcut account-specific without enabling visible helpers.
  return username.toLowerCase() === "ripred3"
    ? RANKED_TEST_ASSISTANCE_POLICY
    : RANKED_ASSISTANCE_POLICY;
}

export function isSoloHumanTurn(snapshot: SoloSessionSnapshot): boolean {
  return (
    snapshot.status === "active" &&
    snapshot.outcome.status === "running" &&
    snapshot.board.m_turn === snapshot.rules.humanPlayer
  );
}

export function getSoloResultPresentation(
  snapshot: SoloSessionSnapshot,
): SoloResultPresentation {
  const humanSide = playerColorForIndex(snapshot.rules.humanPlayer);
  const euclidSide: PlayerColor = humanSide === 1 ? 2 : 1;
  const winnerSide = snapshot.outcome.winner;
  const isRankedForfeit =
    snapshot.status === "abandoned" && snapshot.rankedAbandonCountsAsLoss;

  let result: SoloResultKind;
  if (snapshot.status === "active") result = "running";
  else if (isRankedForfeit) result = "loss";
  else if (snapshot.status === "abandoned") result = "abandoned";
  else if (winnerSide === humanSide) result = "win";
  else if (winnerSide === euclidSide) result = "loss";
  else if (snapshot.outcome.status === "tie") result = "tie";
  else result = "abandoned";

  const headline =
    result === "win"
      ? "You Win!"
      : result === "loss"
        ? isRankedForfeit
          ? "Ranked game forfeited"
          : "Euclid Wins!"
        : result === "tie"
          ? "Tie game!"
          : result === "abandoned"
            ? snapshot.mode === "ranked"
              ? "Ranked game canceled"
              : "Practice ended"
            : isSoloHumanTurn(snapshot)
              ? "Your move"
              : "Euclid is thinking…";
  const isLocalVictory = result === "win";

  return {
    result,
    headline,
    terminal: result !== "running",
    humanSide,
    euclidSide,
    winnerSide,
    isLocalVictory,
    shouldCelebrate: isLocalVictory,
  };
}

export function getSoloExitAction(
  snapshot: SoloSessionSnapshot,
): SoloExitAction {
  if (snapshot.status !== "active") {
    return { label: "Close", notifyServer: false, countsAsLoss: false };
  }
  if (snapshot.mode === "practice") {
    return {
      label: "End Practice",
      notifyServer: true,
      countsAsLoss: false,
    };
  }
  return !snapshot.rankedAbandonCountsAsLoss
    ? {
        label: "Cancel Ranked",
        notifyServer: true,
        countsAsLoss: false,
      }
    : {
        label: "Abandon Ranked",
        notifyServer: true,
        countsAsLoss: true,
      };
}

export function createRankedSoloStartIntent(
  commandId: string,
): RankedSoloStartRequest {
  return { mode: "ranked", commandId: requireCommandId(commandId) };
}

export function createPracticeSoloStartIntent(
  rules: PracticeRulesInput,
  commandId: string,
): PracticeSoloStartRequest {
  return {
    mode: "practice",
    commandId: requireCommandId(commandId),
    rules: {
      W: rules.W,
      H: rules.H,
      scoring: rules.scoring,
      winScore: rules.winScore,
      difficulty: rules.difficulty,
      ...(rules.humanPlayer === undefined
        ? {}
        : { humanPlayer: rules.humanPlayer }),
      ...(rules.firstPlayer === undefined
        ? {}
        : { firstPlayer: rules.firstPlayer }),
    },
  };
}

export function createSoloMoveIntent(
  snapshot: SoloSessionSnapshot,
  x: number,
  y: number,
  commandId: string,
): SoloMoveRequest {
  return {
    gameId: snapshot.gameId,
    x: requireCoordinate(x, "x"),
    y: requireCoordinate(y, "y"),
    expectedRevision: requireRevision(snapshot.revision),
    commandId: requireCommandId(commandId),
  };
}

export function createSoloAbandonIntent(
  snapshot: SoloSessionSnapshot,
  commandId: string,
): SoloAbandonRequest {
  return {
    gameId: snapshot.gameId,
    expectedRevision: requireRevision(snapshot.revision),
    commandId: requireCommandId(commandId),
  };
}
