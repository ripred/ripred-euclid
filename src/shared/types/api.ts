import type {
  GameOutcome,
  PlayerColor,
  PlayerIndex,
  PracticeRules,
  PracticeRulesInput,
  RankedSoloRules,
  SoloRulesVersion,
} from "../game/rules";

export type ShareBucket = "hvh" | "hva";

export type SharePoint = {
  x: number;
  y: number;
  index: number;
};

export type ShareSquare = {
  p1: SharePoint;
  p2: SharePoint;
  p3: SharePoint;
  p4: SharePoint;
  points: number;
  remain: number;
  clr: number;
};

export type SharePlayer = {
  m_squares: ShareSquare[];
  m_score: number;
  m_lastNumSquares: number;
  m_playStyle: number;
  m_goofs: boolean;
  m_computer: boolean;
  userId: string;
};

export type ShareChatItem = {
  id: number;
  ts: number;
  sender: string;
  text: string;
};

export type RankedSoloSessionMetadata = {
  mode: "ranked";
  ranked: true;
  rulesVersion: SoloRulesVersion;
  rules: RankedSoloRules;
};

export type PracticeSoloSessionMetadata = {
  mode: "practice";
  ranked: false;
  rulesVersion: SoloRulesVersion;
  rules: PracticeRules;
};

export type SoloSessionMetadata =
  | RankedSoloSessionMetadata
  | PracticeSoloSessionMetadata;

export type SerializableBoard = {
  W: number;
  H: number;
  scoring: "bbox" | "true";
  winScore: number;
  m_board: number[];
  m_players: SharePlayer[];
  m_turn: number;
  m_history: SharePoint[];
  m_displayed_game_over: boolean;
  m_onlyShowLastSquares: boolean;
  m_createRandomizedRangeOrder: boolean;
  m_stopAt150: boolean;
  m_last: SharePoint;
  m_lastPoints: number;
  playerNames?: Record<string, string>;
  playerAvatars?: Record<string, string>;
  m_targets?: Array<string | null>;
  chat?: { seq: number; items: ShareChatItem[] };
  lastSaved?: number;
  createdAt?: number;
  ended?: boolean;
  endedReason?: string;
  endedBy?: string;
  revision?: number;
  rulesVersion?: number;
  solo?: SoloSessionMetadata;
};

export type CanonicalBoardSnapshot = Omit<
  SerializableBoard,
  "m_players" | "m_turn" | "revision" | "rulesVersion"
> & {
  m_players: [SharePlayer, SharePlayer];
  m_turn: PlayerIndex;
  revision: number;
  rulesVersion: number;
};

/** Canonical solo board exposed to clients and shares, without private AI state. */
export type SoloPublicBoardSnapshot = Omit<
  CanonicalBoardSnapshot,
  "chat" | "m_targets"
> & {
  rulesVersion: SoloRulesVersion;
};

export type H2HEndReason =
  | "game_over"
  | "tie"
  | "player_left"
  | "opponent_left";

export type H2HCanonicalState = {
  gameId: string;
  board: CanonicalBoardSnapshot;
  revision: number;
  rulesVersion: number;
  ended: boolean;
  endedReason: H2HEndReason | null;
  endedBy: string | null;
  victorSide: PlayerColor | null;
};

/** Player and score positions always follow the canonical board's player order. */
export type H2HLiveGameSummary = {
  gameId: string;
  playerIds: [string, string];
  names: Record<string, string>;
  scores: [number, number];
  lastSaved: number;
  revision: number;
  width: number;
  height: number;
  scoring: SerializableBoard["scoring"];
  winScore: number;
};

export type H2HLiveGamesResponse = { games: H2HLiveGameSummary[] };

export type H2HMoveRequest = {
  gameId: string;
  x: number;
  y: number;
  expectedRevision: number;
};

export type H2HLeaveRequest = {
  gameId: string;
  expectedRevision: number;
  intent?: "leave" | "close_result";
};

export type H2HShareRequest = {
  gameId: string;
  terminalRevision: number;
};

export type H2HMoveRejectionReason =
  | "stale_revision"
  | "not_your_turn"
  | "out_of_range"
  | "cell_occupied"
  | "game_ended";

export type H2HMoveResponse = H2HCanonicalState &
  (
    | {
        ok: true;
        accepted: true;
        pointsScored: number;
        completedSquares: ShareSquare[];
      }
    | {
        ok: false;
        accepted: false;
        reason: H2HMoveRejectionReason;
        message: string;
        pointsScored: 0;
        completedSquares: ShareSquare[];
      }
  );

export type H2HQueueResponse =
  | { ok: true; state: "queued" }
  | (H2HCanonicalState & {
      ok: true;
      state: "paired" | "resumed";
      isPlayer1: boolean;
      canRematch: boolean;
    });

export type H2HCancelQueueResponse = {
  ok: true;
  removed: boolean;
};

export type H2HMappingResponse =
  | { ok: true; state: "idle"; gameId: null }
  | { ok: true; state: "queued"; gameId: null }
  | (H2HCanonicalState & {
      ok: true;
      state: "active";
      isPlayer1: boolean;
      canRematch: boolean;
    });

export type H2HStateResponse = H2HCanonicalState & {
  ok: true;
  canRematch: boolean;
};

export type H2HLeaveResponse =
  | {
      ok: true;
      left: boolean;
      gameId: null;
      canceledPristineRematch?: boolean;
    }
  | (H2HCanonicalState & {
      ok: true;
      left: true;
      forfeit: boolean;
    });

export type H2HRematchRequest = {
  gameId: string;
  expectedRevision: number;
};
export type H2HRematchResponse = H2HCanonicalState & { ok: true };

export type H2HChatRequest = { gameId: string; text: string };
export type H2HChatResponse = H2HCanonicalState & {
  ok: true;
  chatItem: ShareChatItem;
};

export type RankedSoloStartRequest = {
  mode: "ranked";
  commandId: string;
};

export type PracticeSoloStartRequest = {
  mode: "practice";
  commandId: string;
  rules: PracticeRulesInput;
};

export type SoloStartRequest =
  | RankedSoloStartRequest
  | PracticeSoloStartRequest;

export type SoloStateRequest = {
  gameId: string;
};

export type SoloMoveRequest = {
  gameId: string;
  x: number;
  y: number;
  expectedRevision: number;
  commandId: string;
};

export type SoloAbandonRequest = {
  gameId: string;
  expectedRevision: number;
  commandId: string;
};

export type SoloShareRequest = {
  gameId: string;
  commandId: string;
};

export type SoloResultRequest = {
  gameId: string;
};

export type SoloSessionStatus = "active" | "completed" | "abandoned";

export type SoloEndReason = "score_target" | "board_full" | "abandoned";

export type RankedRatingChange = {
  before: number;
  after: number;
};

export type RatingRecord = {
  rating: number;
  games: number;
  wins: number;
  losses: number;
  draws: number;
};

export type UserStatsResponse = {
  hvh: RatingRecord;
  hva: RatingRecord;
};

export type SoloMoveEvent = {
  type: "move";
  revision: number;
  actor: "human" | "ai";
  player: PlayerIndex;
  point: SharePoint;
  pointsScored: number;
  completedSquares: ShareSquare[];
};

export type SoloGameEndedEvent = {
  type: "game_ended";
  revision: number;
  reason: SoloEndReason;
  outcome: GameOutcome;
  rating?: RankedRatingChange;
};

export type SoloEvent = SoloMoveEvent | SoloGameEndedEvent;

export type SoloSessionSnapshot = SoloSessionMetadata & {
  gameId: string;
  revision: number;
  board: SoloPublicBoardSnapshot;
  status: SoloSessionStatus;
  outcome: GameOutcome;
  endedReason: SoloEndReason | null;
  canShare: boolean;
  humanMoveCount: number;
  aiMoveCount: number;
  rankedAbandonCountsAsLoss: boolean;
  createdAt: string;
  updatedAt: string;
  rating?: RankedRatingChange;
};

export type SoloStartResponse = {
  ok: true;
  resumed: boolean;
  commandId: string;
  replayed: boolean;
  events: SoloEvent[];
  snapshot: SoloSessionSnapshot;
};

export type SoloStateResponse = {
  ok: true;
  snapshot: SoloSessionSnapshot;
};

export type SoloMoveRejectionReason =
  | "stale_revision"
  | "command_conflict"
  | "not_your_turn"
  | "out_of_range"
  | "cell_occupied"
  | "game_ended";

export type SoloMoveResponse =
  | {
      ok: true;
      accepted: true;
      commandId: string;
      replayed: boolean;
      events: SoloEvent[];
      snapshot: SoloSessionSnapshot;
    }
  | {
      ok: false;
      accepted: false;
      commandId: string;
      replayed: boolean;
      reason: SoloMoveRejectionReason;
      message: string;
      events: SoloEvent[];
      snapshot: SoloSessionSnapshot;
    };

export type SoloAbandonRejectionReason =
  | "stale_revision"
  | "command_conflict"
  | "game_ended";

export type SoloAbandonResponse =
  | {
      ok: true;
      abandoned: true;
      commandId: string;
      replayed: boolean;
      events: SoloEvent[];
      snapshot: SoloSessionSnapshot;
    }
  | {
      ok: false;
      abandoned: false;
      commandId: string;
      replayed: boolean;
      reason: SoloAbandonRejectionReason;
      message: string;
      events: SoloEvent[];
      snapshot: SoloSessionSnapshot;
    };

export type SoloTerminalResult = SoloSessionMetadata & {
  gameId: string;
  board: SoloPublicBoardSnapshot;
  outcome: GameOutcome;
  endedReason: SoloEndReason;
  humanPlayer: PlayerIndex;
  humanScore: number;
  aiScore: number;
  resultForHuman: 0 | 0.5 | 1 | null;
  humanMoveCount: number;
  aiMoveCount: number;
  completedAt: string;
  rating?: RankedRatingChange;
};

export type SoloResultResponse = {
  ok: true;
  result: SoloTerminalResult;
};

export type SoloShareReceipt = {
  gameId: string;
  commandId: string;
  shareId: string;
  postId: string;
  permalink: string;
  createdAt: string;
};

export type SoloShareResponse =
  | {
      ok: true;
      status: "pending";
      replayed: true;
      shareId: string;
      message: string;
    }
  | {
      ok: true;
      status: "posted";
      replayed: boolean;
      message: string;
      receipt: SoloShareReceipt;
    };

export type RankingsShareRow = {
  userId: string;
  name: string;
  avatar?: string;
  rating: number;
  games: number;
  wins: number;
  losses: number;
  draws: number;
};

export type RankingsSharePayload = {
  kind: "rankings";
  shareId: string;
  subredditName: string;
  sharedAt: string;
  bucket: ShareBucket;
  title: string;
  subtitle: string;
  rows: RankingsShareRow[];
  solo?: RankedSoloSessionMetadata;
};

export type ResultSharePayload = {
  kind: "result";
  shareId: string;
  subredditName: string;
  sharedAt: string;
  mode: "h2h" | "ai";
  title: string;
  subtitle: string;
  headline: string;
  details: string;
  footer: string;
  board: SerializableBoard;
  p1Name: string;
  p2Name: string;
  p1Avatar?: string;
  p2Avatar?: string;
  winnerSide: 1 | 2;
  solo?: SoloSessionMetadata;
};

export type RankingsResponse = {
  preview?: boolean;
  hvh?: RankingsShareRow[];
  hva?: RankingsShareRow[];
  hvaRules?: RankedSoloSessionMetadata;
};

export type SharedPostPayload = RankingsSharePayload | ResultSharePayload;

export type SharePostDescriptor = {
  shareType: SharedPostPayload["kind"];
  shareId: string;
};

export type GameInitResponse = {
  canManageChallenges?: boolean;
  type: "init";
  postId: string;
  username: string;
  appVersion: string;
};

export type ShareInitResponse = {
  type: "share";
  postId: string;
  username: string;
  appVersion: string;
  share: SharedPostPayload;
};

export type InitResponse = GameInitResponse | ShareInitResponse;
