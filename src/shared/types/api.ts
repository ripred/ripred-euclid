export type ShareBucket = 'hvh' | 'hva';

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

export type SerializableBoard = {
  W: number;
  H: number;
  scoring: 'bbox' | 'true';
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
  kind: 'rankings';
  shareId: string;
  subredditName: string;
  sharedAt: string;
  bucket: ShareBucket;
  title: string;
  subtitle: string;
  rows: RankingsShareRow[];
};

export type ResultSharePayload = {
  kind: 'result';
  shareId: string;
  subredditName: string;
  sharedAt: string;
  mode: 'h2h' | 'ai';
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
};

export type SharedPostPayload = RankingsSharePayload | ResultSharePayload;

export type SharePostDescriptor = {
  shareType: SharedPostPayload['kind'];
  shareId: string;
};

export type GameInitResponse = {
  type: 'init';
  postId: string;
  count: number;
  username: string;
  appVersion: string;
};

export type ShareInitResponse = {
  type: 'share';
  postId: string;
  username: string;
  appVersion: string;
  share: SharedPostPayload;
};

export type InitResponse = GameInitResponse | ShareInitResponse;

export type IncrementResponse = {
  type: 'increment';
  postId: string;
  count: number;
};

export type DecrementResponse = {
  type: 'decrement';
  postId: string;
  count: number;
};
