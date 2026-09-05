import type { SoloMode } from "../shared/game/rules";
import type {
  H2HMappingResponse,
  RatingRecord,
  SoloSessionSnapshot,
  UserStatsResponse,
} from "../shared/types/api";

export type HomeRecordLabel = "Euclid Ranked" | "Redditor Matches";

/** Keeps every Home exit surface aligned with queue and request locking. */
export function shouldLockHomeNavigation(
  actionPending: boolean,
  h2hState: H2HMappingResponse["state"],
  presenceReconciliationPending = false,
): boolean {
  return (
    actionPending || h2hState === "queued" || presenceReconciliationPending
  );
}

export interface CompetitiveRecordPresentation {
  label: HomeRecordLabel;
  rating: string;
  record: string;
  games: string;
  available: boolean;
}

export interface SoloContinuationPresentation {
  title: string;
  detail: string;
  score: string;
  rules: string;
  actionLabel: "Continue" | "Review result";
}

export type H2HHomePresentation =
  | {
      state: "idle";
      title: "Play a Redditor";
      detail: string;
      actionLabel: "Find a match";
    }
  | {
      state: "queued";
      title: "Searching for a redditor…";
      detail: string;
      actionLabel: "Cancel search";
    }
  | {
      state: "active";
      ended: boolean;
      title: "Continue Redditor match" | "Review Redditor match";
      detail: string;
      score: string;
      opponentName: string;
      actionLabel: "Continue" | "Review result";
    };

const RATING_FORMAT = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 0,
});

const INTEGER_FORMAT = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 0,
  useGrouping: true,
});

/**
 * Formats a server-owned rating record without estimating missing results.
 * Missing stats remain visibly unavailable instead of looking like a new account.
 */
export function formatCompetitiveRecord(
  label: HomeRecordLabel,
  record: RatingRecord | null,
): CompetitiveRecordPresentation {
  if (!record) {
    return {
      label,
      rating: "—",
      record: "Stats unavailable",
      games: "Try again shortly",
      available: false,
    };
  }

  return {
    label,
    rating: RATING_FORMAT.format(record.rating),
    record:
      record.games === 0
        ? "No rated games yet"
        : `${INTEGER_FORMAT.format(record.wins)}W · ${INTEGER_FORMAT.format(record.losses)}L · ${INTEGER_FORMAT.format(record.draws)}D`,
    games: `${INTEGER_FORMAT.format(record.games)} rated ${record.games === 1 ? "game" : "games"}`,
    available: true,
  };
}

/** Maps the two independent rating pools to their player-facing card labels. */
export function getHomeRecordPresentations(
  stats: UserStatsResponse | null,
): [CompetitiveRecordPresentation, CompetitiveRecordPresentation] {
  return [
    formatCompetitiveRecord("Euclid Ranked", stats?.hva ?? null),
    formatCompetitiveRecord("Redditor Matches", stats?.hvh ?? null),
  ];
}

/** Summarizes the currently selected path without implying that Practice is rated. */
export function getPlayEuclidSubtitle(mode: SoloMode): string {
  return mode === "ranked"
    ? "Ranked · 8 × 8 Grid Footprint · rating on the line"
    : "Practice · custom rules · no rating changes";
}

function scoringLabel(
  scoring: SoloSessionSnapshot["board"]["scoring"],
): string {
  return scoring === "true" ? "True Area" : "Grid Footprint";
}

/** Builds resume copy from a canonical solo snapshot, including player orientation. */
export function getSoloContinuationPresentation(
  snapshot: SoloSessionSnapshot,
): SoloContinuationPresentation {
  const humanIndex = snapshot.rules.humanPlayer;
  const euclidIndex = humanIndex === 0 ? 1 : 0;
  const humanScore = snapshot.board.m_players[humanIndex].m_score;
  const euclidScore = snapshot.board.m_players[euclidIndex].m_score;
  const isActive =
    snapshot.status === "active" && snapshot.outcome.status === "running";
  const isHumanTurn = isActive && snapshot.board.m_turn === humanIndex;

  let detail: string;
  if (isActive) {
    detail = isHumanTurn ? "Your turn against Euclid" : "Euclid's turn";
  } else if (snapshot.outcome.status === "tie") {
    detail = "The game ended in a tie";
  } else if (snapshot.outcome.winner === humanIndex + 1) {
    detail = "You won against Euclid";
  } else if (snapshot.outcome.winner === euclidIndex + 1) {
    detail = "Euclid won this game";
  } else {
    detail =
      snapshot.mode === "ranked" ? "Ranked game ended" : "Practice ended";
  }

  return {
    title: `${isActive ? "Continue" : "Review"} ${snapshot.mode === "ranked" ? "Ranked" : "Practice"} game`,
    detail,
    score: `You ${humanScore} · Euclid ${euclidScore}`,
    rules: `${snapshot.board.W} × ${snapshot.board.H} · ${scoringLabel(snapshot.board.scoring)} · first to ${snapshot.board.winScore}`,
    actionLabel: isActive ? "Continue" : "Review result",
  };
}

type ActiveH2HMapping = Extract<H2HMappingResponse, { state: "active" }>;

function getH2HOpponentName(mapping: ActiveH2HMapping): string {
  const opponentIndex = mapping.isPlayer1 ? 1 : 0;
  const opponentId = mapping.board.m_players[opponentIndex].userId;
  return mapping.board.playerNames?.[opponentId]?.trim() || "Redditor";
}

function getEndedH2HDetail(
  mapping: ActiveH2HMapping,
  opponentName: string,
): string {
  const localIndex = mapping.isPlayer1 ? 0 : 1;
  const opponentIndex = localIndex === 0 ? 1 : 0;
  const localSide = localIndex + 1;
  const localId = mapping.board.m_players[localIndex].userId;
  const opponentId = mapping.board.m_players[opponentIndex].userId;

  if (mapping.endedReason === "tie" || mapping.victorSide === null) {
    return "The match ended in a tie";
  }
  if (mapping.endedReason === "player_left") {
    if (mapping.endedBy === localId) return `You left · ${opponentName} won`;
    if (mapping.endedBy === opponentId) return `${opponentName} left · you won`;
  }
  return mapping.victorSide === localSide
    ? `You won against ${opponentName}`
    : `${opponentName} won this match`;
}

/**
 * Converts authoritative queue/mapping state into the dashboard's multiplayer
 * action or continuation card. Scores and turn/result state are never inferred
 * from local play history.
 */
export function getH2HHomePresentation(
  mapping: H2HMappingResponse,
): H2HHomePresentation {
  if (mapping.state === "idle") {
    return {
      state: "idle",
      title: "Play a Redditor",
      detail: "Start a live match with another redditor.",
      actionLabel: "Find a match",
    };
  }
  if (mapping.state === "queued") {
    return {
      state: "queued",
      title: "Searching for a redditor…",
      detail: "You can stay here while Euclid finds your opponent.",
      actionLabel: "Cancel search",
    };
  }

  const localIndex = mapping.isPlayer1 ? 0 : 1;
  const opponentIndex = localIndex === 0 ? 1 : 0;
  const opponentName = getH2HOpponentName(mapping);
  const localScore = mapping.board.m_players[localIndex].m_score;
  const opponentScore = mapping.board.m_players[opponentIndex].m_score;
  const ended = mapping.ended;

  return {
    state: "active",
    ended,
    title: ended ? "Review Redditor match" : "Continue Redditor match",
    detail: ended
      ? getEndedH2HDetail(mapping, opponentName)
      : mapping.board.m_turn === localIndex
        ? `Your turn against ${opponentName}`
        : `Waiting for ${opponentName}`,
    score: `You ${localScore} · ${opponentName} ${opponentScore}`,
    opponentName,
    actionLabel: ended ? "Review result" : "Continue",
  };
}
