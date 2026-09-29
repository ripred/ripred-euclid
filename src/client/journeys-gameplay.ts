import {
  journeyBoardProgress,
  h2hJourneyCompletedForPlayer,
} from "../shared/journeys";
import type {
  SoloSessionSnapshot,
  H2HCanonicalState,
} from "../shared/types/api";
import type { CompetitionStateResponse } from "../shared/competitions";
import type { JourneyObservation } from "./journeys";

export function soloJourneyObservation(
  snapshot: SoloSessionSnapshot,
): JourneyObservation {
  const human = snapshot.board.m_players[snapshot.rules.humanPlayer];
  return {
    activity: { kind: "solo", gameId: snapshot.gameId },
    moves: snapshot.humanMoveCount,
    squares: human?.m_squares.length ?? 0,
    progress: journeyBoardProgress(snapshot.board),
    terminal: snapshot.status !== "active",
    complete: snapshot.status === "completed",
  };
}

export function h2hJourneyObservation(
  state: H2HCanonicalState,
  isPlayer1: boolean,
): JourneyObservation {
  const side = isPlayer1 ? 0 : 1;
  return {
    activity: {
      kind: "h2h",
      gameId: state.gameId,
      roundStartRevision: state.roundStartRevision ?? null,
      ...(state.ended ? { terminalRevision: state.revision } : {}),
    },
    moves: Math.max(0, Math.ceil((state.board.m_history.length - side) / 2)),
    squares: state.board.m_players[side]?.m_squares.length ?? 0,
    progress: journeyBoardProgress(state.board),
    terminal: state.ended,
    complete: h2hJourneyCompletedForPlayer(state, side),
  };
}

/** A delayed accepted move from the previous round cannot start its rematch. */
export function isCurrentH2HJourneyMove(
  submittedEpoch: number,
  currentEpoch: number,
  response: H2HCanonicalState,
  current: H2HCanonicalState | null,
): boolean {
  return (
    submittedEpoch === currentEpoch &&
    (!current ||
      (response.gameId === current.gameId &&
        response.roundStartRevision === current.roundStartRevision))
  );
}

export function competitionJourneyObservation(
  state: CompetitionStateResponse,
): JourneyObservation | null {
  const { snapshot, competition } = state;
  if (!snapshot || !competition.instanceId) return null;
  return {
    activity: {
      kind: "competition",
      period: competition.period,
      instanceId: competition.instanceId,
      attemptId: snapshot.attemptId,
    },
    moves: snapshot.placements.length,
    squares: snapshot.completedSquares.length,
    progress: Math.min(
      1,
      snapshot.completedSquares.length / snapshot.puzzle.targetSquares,
    ),
    terminal: snapshot.complete,
  };
}
