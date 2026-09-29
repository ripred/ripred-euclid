import {
  h2hJourneyCompletedForPlayer,
  journeyBoardProgress,
  type JourneyActivityRef,
  type JourneyRequestContext,
} from "../shared/journeys";
import type { AiDifficulty, GameVariant } from "../shared/game/rules";
import type { CompetitionGameplay } from "./competition-gameplay";
import type { H2HCanonicalStateSnapshot } from "./h2h";
import type { H2HStore } from "./h2h-store";
import type { SoloStore } from "./solo-store";

export type JourneyCanonicalStatus =
  | "active"
  | "queued"
  | "completed"
  | "abandoned"
  | "canceled"
  | "expired"
  | "replaced";

/** Only bounded game facts cross from canonical state into telemetry. */
export interface JourneyCanonicalActivity {
  activity: JourneyActivityRef;
  mode: "practice" | "ranked" | "h2h" | "daily" | "weekly";
  variant?: GameVariant;
  difficulty?: AiDifficulty;
  status: JourneyCanonicalStatus;
  progress: number;
  hasMove: boolean;
  hasSquare: boolean;
  game?: { win: boolean; score: number };
}

export interface JourneyCanonicalStores {
  solo: Pick<SoloStore, "getJourneyState">;
  h2h: Pick<H2HStore, "getJourneyState" | "getJourneyPresence">;
  competition: Pick<CompetitionGameplay, "getJourneyAttempt">;
}

function h2hActivity(
  state: H2HCanonicalStateSnapshot,
  userId: string,
): JourneyCanonicalActivity {
  const playerIndex = state.board.m_players.findIndex(
    (player) => player.userId === userId,
  );
  if (playerIndex !== 0 && playerIndex !== 1)
    throw new Error("Journey participant is unavailable.");
  const player = state.board.m_players[playerIndex]!;
  const complete = h2hJourneyCompletedForPlayer(state, playerIndex);
  return {
    activity: {
      kind: "h2h",
      gameId: state.gameId,
      roundStartRevision: state.roundStartRevision ?? null,
      ...(state.ended ? { terminalRevision: state.revision } : {}),
    },
    mode: "h2h",
    variant: state.board.variant ?? "standard",
    status: complete ? "completed" : state.ended ? "abandoned" : "active",
    progress: complete ? 1 : journeyBoardProgress(state.board),
    hasMove: state.board.m_history.length > playerIndex,
    hasSquare: player.m_squares.length > 0,
    ...(state.ended
      ? {
          game: {
            win: state.victorSide === playerIndex + 1,
            score: player.m_score,
          },
        }
      : {}),
  };
}

/** Reads existing gameplay authority without reconciliation, ratings or writes. */
export function createJourneyCanonicalReader(stores: JourneyCanonicalStores) {
  return async (
    userId: string,
    request: JourneyRequestContext,
  ): Promise<JourneyCanonicalActivity | null> => {
    const activity = request.activity;
    if (!activity) return null;
    switch (activity.kind) {
      case "solo": {
        const state = await stores.solo.getJourneyState(
          userId,
          activity.gameId,
        );
        const playerIndex = state.rules.humanPlayer;
        const player = state.board.m_players[playerIndex];
        return {
          activity,
          mode: state.mode,
          variant: state.board.variant ?? "standard",
          difficulty: state.rules.difficulty,
          status:
            state.status === "completed"
              ? "completed"
              : state.status === "abandoned"
                ? "abandoned"
                : "active",
          progress:
            state.status === "completed"
              ? 1
              : journeyBoardProgress(state.board),
          hasMove: state.humanMoveCount > 0,
          hasSquare: player.m_squares.length > 0,
          ...(state.status !== "active"
            ? {
                game: {
                  win: state.outcome.winner === playerIndex + 1,
                  score: player.m_score,
                },
              }
            : {}),
        };
      }
      case "h2h-queue": {
        const presence = await stores.h2h.getJourneyPresence(userId);
        if (presence.state === "active")
          return h2hActivity(presence.snapshot, userId);
        return {
          activity,
          mode: "h2h",
          status: presence.state === "queued" ? "queued" : "canceled",
          progress: 0,
          hasMove: false,
          hasSquare: false,
        };
      }
      case "h2h": {
        const state = await stores.h2h.getJourneyState(
          userId,
          activity.gameId,
          activity.roundStartRevision,
          activity.terminalRevision,
        );
        return state ? h2hActivity(state, userId) : null;
      }
      case "competition": {
        const attempt = await stores.competition.getJourneyAttempt(
          activity.period,
          userId,
          {
            instanceId: activity.instanceId,
            attemptId: activity.attemptId,
            ...(request.commandId !== undefined
              ? {
                  abandonCommandId: request.commandId,
                  abandonExpectedRevision: request.expectedRevision,
                }
              : {}),
          },
        );
        if (!attempt) return null;
        const snapshot = attempt.snapshot;
        return {
          activity,
          mode: activity.period,
          status: attempt.status,
          progress:
            attempt.status === "completed"
              ? 1
              : snapshot
                ? Math.min(
                    1,
                    snapshot.completedSquares.length /
                      snapshot.puzzle.targetSquares,
                  )
                : 0,
          hasMove: (snapshot?.placements.length ?? 0) > 0,
          hasSquare: (snapshot?.completedSquares.length ?? 0) > 0,
          ...(snapshot?.complete
            ? { game: { win: true, score: snapshot.completedSquares.length } }
            : {}),
        };
      }
    }
  };
}
