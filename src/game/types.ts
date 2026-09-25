/**
 * Plain-data board shapes. The engine serializes to these so games can be
 * saved, resumed and replayed without carrying class instances around.
 */

export type BoardPoint = {
  x: number;
  y: number;
  index: number;
};

export type BoardSquare = {
  p1: BoardPoint;
  p2: BoardPoint;
  p3: BoardPoint;
  p4: BoardPoint;
  points: number;
  remain: number;
  clr: number;
};

export type BoardPlayer = {
  m_squares: BoardSquare[];
  m_score: number;
  m_lastNumSquares: number;
  m_playStyle: number;
  m_goofs: boolean;
  m_computer: boolean;
  userId: string;
};

export type SerializableBoard = {
  W: number;
  H: number;
  scoring: "bbox" | "true";
  winScore: number;
  m_board: number[];
  m_players: BoardPlayer[];
  m_turn: number;
  m_history: BoardPoint[];
  m_displayed_game_over: boolean;
  m_onlyShowLastSquares: boolean;
  m_createRandomizedRangeOrder: boolean;
  m_stopAt150: boolean;
  m_last: BoardPoint;
  m_lastPoints: number;
  /** Euclid's remembered target square for each side, as sorted indices. */
  m_targets?: Array<string | null>;
  /** Fading pieces: turns a stone lasts; absent when stones are permanent. */
  fadeTurns?: number;
  /** Fading pieces: history index that placed each cell's stone, or -1. */
  m_placedAt?: number[];
  /** Fading pieces: cells anchored by a completed square. */
  m_anchored?: boolean[];
};
