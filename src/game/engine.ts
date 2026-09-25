import { scoreSquareCorners } from "./scoring";
import type {
  SerializableBoard,
  BoardPlayer,
  BoardPoint,
  BoardSquare,
} from "./types";
import {
  GAME_STATES,
  PLAY_STYLES,
  playerColorForIndex,
  playerIndexForColor,
  type GameOutcome,
  type PlayerColor,
  type PlayerIndex,
} from "./rules";

export type RandomSource = () => number;

export interface BoardOptions {
  W?: number;
  H?: number;
  scoring?: SerializableBoard["scoring"];
  winScore?: number;
  skipInit?: boolean;
  rng?: RandomSource;
  /**
   * Fading pieces: a stone lasts this many of its owner's turns unless it
   * becomes a corner of a completed square. 0 turns the rule off.
   */
  fadeTurns?: number;
}

export class Point {
  constructor(
    public x: number,
    public y: number,
    public index: number,
  ) {}

  static fromJSON(point: BoardPoint): Point {
    return new Point(point.x, point.y, point.index);
  }

  valid(width: number, height: number): boolean {
    return this.x >= 0 && this.x < width && this.y >= 0 && this.y < height;
  }
}

export class Square {
  constructor(
    public p1: Point,
    public p2: Point,
    public p3: Point,
    public p4: Point,
    public clr: number,
    public points: number,
    public remain: number,
  ) {
    this.normalize();
  }

  static fromJSON(square: BoardSquare): Square {
    return new Square(
      Point.fromJSON(square.p1),
      Point.fromJSON(square.p2),
      Point.fromJSON(square.p3),
      Point.fromJSON(square.p4),
      square.clr,
      square.points,
      square.remain,
    );
  }

  private normalize(): void {
    const points: [Point, Point, Point, Point] = [
      this.p1,
      this.p2,
      this.p3,
      this.p4,
    ];
    points.sort((left, right) => left.y - right.y);

    if (points[0].y !== points[1].y) {
      if (points[1].x > points[2].x) {
        [points[1], points[2]] = [points[2], points[1]];
      }
    } else {
      if (points[0].x < points[1].x) {
        [points[0], points[1]] = [points[1], points[0]];
      }
      if (points[2].x < points[3].x) {
        [points[2], points[3]] = [points[3], points[2]];
      }
    }

    [this.p1, this.p2, this.p3, this.p4] = points;
  }
}

export class Player {
  m_squares: Square[] = [];
  m_score = 0;
  m_lastNumSquares = 0;
  m_goofs = false;

  constructor(
    public m_playStyle: number = PLAY_STYLES.OFFENSIVE,
    public m_computer = false,
    public userId = "",
  ) {}

  static fromJSON(source: BoardPlayer): Player {
    const player = new Player(
      source.m_playStyle,
      source.m_computer,
      source.userId,
    );
    player.m_squares = source.m_squares.map(Square.fromJSON);
    player.m_score = source.m_score;
    player.m_lastNumSquares = source.m_lastNumSquares;
    player.m_goofs = source.m_goofs;
    return player;
  }

  initGame(): void {
    this.m_squares = [];
    this.m_lastNumSquares = 0;
    this.m_score = 0;
  }
}

type ImmediateMoveCandidate = {
  point: Point;
  ownGain: number;
  opponentGain: number;
};

export class Board {
  static readonly PS_BRUTAL = PLAY_STYLES.BRUTAL;
  static readonly PS_OFFENSIVE = PLAY_STYLES.OFFENSIVE;
  static readonly PS_DEFENSIVE = PLAY_STYLES.DEFENSIVE;
  static readonly PS_CASUAL = PLAY_STYLES.CASUAL;
  static readonly PS_BEGINNER = PLAY_STYLES.BEGINNER;
  static readonly PS_TENDERFOOT = PLAY_STYLES.TENDERFOOT;
  static readonly PS_DOOFUS = PLAY_STYLES.DOOFUS;
  static readonly PS_GOLDFISH = PLAY_STYLES.GOLDFISH;
  static readonly PS_COFFEE = PLAY_STYLES.COFFEE;

  W: number;
  H: number;
  scoring: SerializableBoard["scoring"];
  winScore: number;

  m_board: number[] = [];
  m_players: [Player, Player];
  m_turn: PlayerIndex = 0;
  m_history: Point[] = [];
  m_displayed_game_over = false;
  m_onlyShowLastSquares = false;
  m_createRandomizedRangeOrder = true;
  m_stopAt150 = true;
  m_last: Point;
  m_lastPoints = 0;
  m_targets: [string | null, string | null] = [null, null];
  /** Fading pieces: turns a stone lasts, or 0 when stones are permanent. */
  fadeTurns: number;
  /** History index of the move that placed each cell's stone, or -1. */
  m_placedAt: number[] = [];
  /** Cells whose stone completed a square and can no longer fade. */
  m_anchored: boolean[] = [];

  private readonly rng: RandomSource;

  constructor(p1: Player, p2: Player, opts: BoardOptions = {}) {
    const rawW = Math.max(4, Math.min(16, opts.W ?? 8));
    const rawH = Math.max(4, Math.min(16, opts.H ?? rawW));
    this.W = rawW - (rawW % 2);
    this.H = rawH - (rawH % 2);
    this.scoring = opts.scoring ?? "bbox";
    this.winScore = Math.max(1, Math.floor(opts.winScore ?? 150));
    this.fadeTurns = Math.max(0, Math.floor(opts.fadeTurns ?? 0));
    this.m_players = [p1, p2];
    this.m_last = new Point(-1, -1, -1);
    this.rng = opts.rng ?? Math.random;
    if (!opts.skipInit) this.initGame();
  }

  initGame(): void {
    this.m_board = new Array<number>(this.W * this.H).fill(0);
    this.m_placedAt = new Array<number>(this.W * this.H).fill(-1);
    this.m_anchored = new Array<boolean>(this.W * this.H).fill(false);
    this.m_history = [];
    this.m_turn = 0;
    this.m_displayed_game_over = false;
    this.m_last = new Point(-1, -1, -1);
    this.m_players[0].initGame();
    this.m_players[1].initGame();
    this.m_targets = [null, null];
  }

  pointAt(x: number, y: number): Point {
    return new Point(x, y, y * this.W + x);
  }

  private cellAt(index: number): number {
    return this.m_board[index] ?? 0;
  }

  createRandomizedRange(size: number): number[] {
    const values = [...Array(size).keys()];
    for (let pass = 0; pass < size * size; pass++) {
      const leftIndex = Math.floor(this.rng() * size);
      const rightIndex = Math.floor(this.rng() * size);
      if (leftIndex === rightIndex) continue;

      const left = values[leftIndex];
      const right = values[rightIndex];
      if (left === undefined || right === undefined) continue;
      values[leftIndex] = right;
      values[rightIndex] = left;
    }
    return values;
  }

  private scoreSquare(p1: Point, p2: Point, p3: Point, p4: Point): number {
    return scoreSquareCorners([p1, p2, p3, p4], this.scoring);
  }

  analyze(move: Point, potential: Square[] | null): number {
    let total = 0;
    const x = move.x;
    const y = move.y;
    const clr = this.m_turn + 1;
    if (potential) potential.length = 0;
    const other = clr === 1 ? 2 : 1;
    const rows = this.createRandomizedRange(this.H);
    const columns = this.createRandomizedRange(this.W);
    for (let index = 0; index < this.W * this.H; index++) {
      const row = rows[Math.floor(index / this.W)];
      const col = columns[index % this.W];
      if (row === undefined || col === undefined) continue;
      // Treat move-to-candidate as one side; a 90-degree rotation gives the
      // other two corners for both axis-aligned and rotated squares.
      const dx = col - x;
      const dy = row - y;
      const x1 = x - dy;
      const y1 = y + dx;
      const x2 = col - dy;
      const y2 = row + dx;
      if (
        x1 < 0 ||
        x1 >= this.W ||
        y1 < 0 ||
        y1 >= this.H ||
        x2 < 0 ||
        x2 >= this.W ||
        y2 < 0 ||
        y2 >= this.H ||
        (col === x && row === y)
      ) {
        continue;
      }
      const v1 = this.cellAt(y * this.W + x);
      const v2 = this.cellAt(row * this.W + col);
      const v3 = this.cellAt(y1 * this.W + x1);
      const v4 = this.cellAt(y2 * this.W + x2);
      if (v1 === other || v2 === other || v3 === other || v4 === other) {
        continue;
      }
      const remain =
        (v1 === 0 ? 1 : 0) +
        (v2 === 0 ? 1 : 0) +
        (v3 === 0 ? 1 : 0) +
        (v4 === 0 ? 1 : 0);

      const square = new Square(
        this.pointAt(x, y),
        this.pointAt(col, row),
        this.pointAt(x1, y1),
        this.pointAt(x2, y2),
        clr,
        0,
        remain,
      );
      if (remain === 0) {
        const score = this.scoreSquare(
          square.p1,
          square.p2,
          square.p3,
          square.p4,
        );
        square.points = score;
        total += score;
        const currentPlayer = this.m_players[this.m_turn];
        if (!currentPlayer.m_squares.some((item) => sameSquare(item, square))) {
          currentPlayer.m_squares.push(square);
          currentPlayer.m_lastNumSquares++;
        }
      } else if (potential) {
        square.points = this.scoreSquare(
          square.p1,
          square.p2,
          square.p3,
          square.p4,
        );
        if (!potential.some((item) => sameSquare(item, square))) {
          potential.push(square);
        }
      }
    }
    return total;
  }

  private scoreIfPlacedForColor(pt: Point, color: PlayerColor): number {
    // Project one candidate move onto the live position so every scoring rule
    // sees the requested color, then restore both mutated fields below.
    const saved = this.m_board[pt.index];
    if (saved === undefined) return 0;
    const savedTurn = this.m_turn;
    this.m_board[pt.index] = color;
    this.m_turn = playerIndexForColor(color);
    let total = 0;
    const x = pt.x;
    const y = pt.y;
    const other = color === 1 ? 2 : 1;
    for (let row = 0; row < this.H; row++) {
      for (let col = 0; col < this.W; col++) {
        const dx = col - x;
        const dy = row - y;
        const x1 = x - dy;
        const y1 = y + dx;
        const x2 = col - dy;
        const y2 = row + dx;
        if (
          x1 < 0 ||
          x1 >= this.W ||
          y1 < 0 ||
          y1 >= this.H ||
          x2 < 0 ||
          x2 >= this.W ||
          y2 < 0 ||
          y2 >= this.H ||
          (col === x && row === y)
        ) {
          continue;
        }
        const v1 = this.cellAt(y * this.W + x);
        const v2 = this.cellAt(row * this.W + col);
        const v3 = this.cellAt(y1 * this.W + x1);
        const v4 = this.cellAt(y2 * this.W + x2);
        if (v1 === other || v2 === other || v3 === other || v4 === other) {
          continue;
        }
        const remain =
          (v1 === 0 ? 1 : 0) +
          (v2 === 0 ? 1 : 0) +
          (v3 === 0 ? 1 : 0) +
          (v4 === 0 ? 1 : 0);
        if (remain === 0) {
          total += this.scoreSquare(
            this.pointAt(x, y),
            this.pointAt(col, row),
            this.pointAt(x1, y1),
            this.pointAt(x2, y2),
          );
        }
      }
    }
    // Candidate comparisons must not leak this speculative move into the next
    // evaluation or alter whose turn the real game is waiting on.
    this.m_board[pt.index] = saved;
    this.m_turn = savedTurn;
    return total;
  }

  private static squareKeyByIndices(...indices: number[]): string {
    return indices
      .slice()
      .sort((left, right) => left - right)
      .join(",");
  }

  private collectSquaresForColor(color: PlayerColor): Square[] {
    const savedTurn = this.m_turn;
    this.m_turn = playerIndexForColor(color);
    const all: Square[] = [];
    for (let y = 0; y < this.H; y++) {
      for (let x = 0; x < this.W; x++) {
        const current: Square[] = [];
        this.analyze(this.pointAt(x, y), current);
        for (const square of current) {
          if (!all.some((item) => sameSquare(item, square))) {
            all.push(square);
          }
        }
      }
    }
    this.m_turn = savedTurn;
    return all;
  }

  /**
   * Fading pieces: a square is only worth pursuing if every stone of `color`
   * already on it lasts the `remain` placements needed to finish it.
   */
  private outlastsSquare(
    indices: readonly number[],
    remain: number,
    color: PlayerColor,
  ): boolean {
    return indices.every(
      (index) =>
        this.m_board[index] !== color ||
        (this.turnsLeft(index) ?? Infinity) >= remain,
    );
  }

  private shouldMistake(probability: number): boolean {
    if (probability <= 0) return false;
    if (probability >= 1) return true;
    return this.rng() < probability;
  }

  private randomEmptyPoint(): Point {
    const empties: number[] = [];
    for (let index = 0; index < this.m_board.length; index++) {
      if (this.m_board[index] === 0) empties.push(index);
    }
    const selected = empties[Math.floor(this.rng() * empties.length)];
    return selected === undefined
      ? this.pointAt(0, 0)
      : this.pointAt(selected % this.W, Math.floor(selected / this.W));
  }

  private immediateMoveCandidates(): ImmediateMoveCandidate[] {
    const ownColor = playerColorForIndex(this.m_turn);
    const opponentColor: PlayerColor = ownColor === 1 ? 2 : 1;
    const candidates: ImmediateMoveCandidate[] = [];
    for (let index = 0; index < this.m_board.length; index++) {
      if (this.m_board[index] !== 0) continue;
      const point = this.pointAt(index % this.W, Math.floor(index / this.W));
      candidates.push({
        point,
        ownGain: this.scoreIfPlacedForColor(point, ownColor),
        opponentGain: this.scoreIfPlacedForColor(point, opponentColor),
      });
    }
    return candidates;
  }

  private chooseBrutalMove(): Point {
    const candidates = this.immediateMoveCandidates();
    if (candidates.length === 0) return this.pointAt(0, 0);

    const own = this.m_players[this.m_turn];
    const opponent = this.m_players[this.m_turn === 0 ? 1 : 0];
    const bestOffense = candidates.slice().sort(compareOffense)[0];
    const bestDefense = candidates.slice().sort(compareDefense)[0];
    if (!bestOffense || !bestDefense) return this.randomEmptyPoint();

    if (
      bestOffense.ownGain > 0 &&
      own.m_score + bestOffense.ownGain >= this.winScore
    ) {
      return bestOffense.point;
    }

    if (
      bestDefense.opponentGain > 0 &&
      opponent.m_score + bestDefense.opponentGain >= this.winScore
    ) {
      return bestDefense.point;
    }

    if (bestOffense.ownGain > 0 || bestDefense.opponentGain > 0) {
      // Equal gains favor taking points; each comparator then uses the other
      // gain and finally the stable board index as deterministic tie-breakers.
      return bestOffense.ownGain >= bestDefense.opponentGain
        ? bestOffense.point
        : bestDefense.point;
    }

    return this.chooseUnifiedMove(0, 0);
  }

  /**
   * Non-Brutal styles share three phases: block an immediate score, pursue a
   * valuable square, then choose a random empty point. Difficulty changes only
   * the probabilities of deliberately skipping the first two phases.
   */
  private chooseUnifiedMove(
    defensiveMistakeProbability: number,
    offensiveMistakeProbability: number,
  ): Point {
    const playerIndex = this.m_turn;
    const ownColor = playerColorForIndex(playerIndex);
    const opponentColor: PlayerColor = ownColor === 1 ? 2 : 1;

    let bestBlockPoints = -1;
    let bestBlock = this.pointAt(0, 0);
    let foundThreat = false;
    for (let index = 0; index < this.m_board.length; index++) {
      if (this.m_board[index] !== 0) continue;
      const point = this.pointAt(index % this.W, Math.floor(index / this.W));
      const opponentGain = this.scoreIfPlacedForColor(point, opponentColor);
      if (opponentGain > bestBlockPoints) {
        bestBlockPoints = opponentGain;
        bestBlock = point;
      }
      if (opponentGain > 0) foundThreat = true;
    }
    if (foundThreat && !this.shouldMistake(defensiveMistakeProbability)) {
      return bestBlock;
    }

    const getEmptyBestCorner = (indices: number[]): Point | null => {
      let best: Point | null = null;
      let bestImmediateGain = -1;
      for (const index of indices) {
        if (this.m_board[index] !== 0) continue;
        const point = this.pointAt(index % this.W, Math.floor(index / this.W));
        const immediateGain = this.scoreIfPlacedForColor(point, ownColor);
        if (immediateGain > bestImmediateGain) {
          bestImmediateGain = immediateGain;
          best = point;
        }
      }
      return best;
    };

    const currentKey = this.m_targets[playerIndex];
    let targetKey: string | null = currentKey;
    const keyToPlayableCorner = (key: string | null): Point | null => {
      if (!key) return null;
      const parts = key.split(",").map((value) => parseInt(value, 10));
      for (const index of parts) {
        if (this.m_board[index] === opponentColor) return null;
      }
      let ours = 0;
      for (const index of parts) {
        if (this.m_board[index] === ownColor) ours++;
      }
      if (ours === 4) return null;
      if (!this.outlastsSquare(parts, 4 - ours, ownColor)) return null;
      return getEmptyBestCorner(parts);
    };

    let playPoint: Point | null = keyToPlayableCorner(targetKey);

    if (!playPoint) {
      const candidates = this.collectSquaresForColor(ownColor).filter(
        (square) => {
          const indices = [
            square.p1.index,
            square.p2.index,
            square.p3.index,
            square.p4.index,
          ];
          return (
            !indices.some((index) => this.m_board[index] === opponentColor) &&
            this.outlastsSquare(indices, square.remain, ownColor)
          );
        },
      );
      if (candidates.length > 0) {
        let maximumPoints = 0;
        for (const square of candidates) {
          if (square.points > maximumPoints) maximumPoints = square.points;
        }
        const highestValue = candidates.filter(
          (square) => square.points === maximumPoints,
        );
        const minimumRemaining = Math.min(
          ...highestValue.map((square) => square.remain),
        );
        const preferred = highestValue
          .filter((square) => square.remain === minimumRemaining)
          .sort((left, right) => {
            const leftKey = Board.squareKeyByIndices(
              left.p1.index,
              left.p2.index,
              left.p3.index,
              left.p4.index,
            );
            const rightKey = Board.squareKeyByIndices(
              right.p1.index,
              right.p2.index,
              right.p3.index,
              right.p4.index,
            );
            return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
          });
        const chosen = preferred[0];
        if (!chosen) return this.randomEmptyPoint();
        targetKey = Board.squareKeyByIndices(
          chosen.p1.index,
          chosen.p2.index,
          chosen.p3.index,
          chosen.p4.index,
        );
        this.m_targets[playerIndex] = targetKey;
        playPoint = keyToPlayableCorner(targetKey);
      }
    }

    if (playPoint) {
      if (this.shouldMistake(offensiveMistakeProbability)) {
        return this.randomEmptyPoint();
      }
      return playPoint;
    }
    return this.randomEmptyPoint();
  }

  findBestMove(): Point {
    const style = this.m_players[this.m_turn].m_playStyle;
    switch (style) {
      case Board.PS_BRUTAL:
        return this.chooseBrutalMove();
      case Board.PS_OFFENSIVE:
        return this.chooseUnifiedMove(1 / 3, 0);
      case Board.PS_DEFENSIVE:
        return this.chooseUnifiedMove(0, 1 / 3);
      case Board.PS_CASUAL:
        return this.chooseUnifiedMove(3 / 5, 1 / 2);
      case Board.PS_TENDERFOOT:
        return this.chooseUnifiedMove(2 / 3, 5 / 8);
      case Board.PS_COFFEE:
        return this.chooseUnifiedMove(2 / 3, 3 / 5);
      case Board.PS_BEGINNER:
        return this.chooseUnifiedMove(3 / 4, 2 / 3);
      case Board.PS_GOLDFISH:
        return this.chooseUnifiedMove(4 / 5, 2 / 3);
      case Board.PS_DOOFUS:
        return this.chooseUnifiedMove(9 / 10, 4 / 5);
      default:
        return this.chooseUnifiedMove(1 / 2, 1 / 2);
    }
  }

  placePiece(point: Point): number {
    const cell = this.m_board[point.index];
    if (!point.valid(this.W, this.H) || cell === undefined || cell > 0) {
      return 0;
    }
    this.m_board[point.index] = playerColorForIndex(this.m_turn);
    this.m_placedAt[point.index] = this.m_history.length;
    this.m_history.push(point);
    this.m_last = this.pointAt(point.x, point.y);
    const mover = this.m_players[this.m_turn];
    const squaresBefore = mover.m_squares.length;
    const points = this.analyze(point, null);
    mover.m_score += points;
    // Completing a square anchors its corners before anything can fade.
    for (const square of mover.m_squares.slice(squaresBefore)) {
      for (const corner of [square.p1, square.p2, square.p3, square.p4]) {
        this.m_anchored[corner.index] = true;
      }
    }
    return points;
  }

  /**
   * Moves, by either player, until a stone washes away: 1 means it goes
   * after the next move. Null when it cannot fade (rule off, empty point or
   * anchored).
   */
  movesLeft(index: number): number | null {
    const placedAt = this.m_placedAt[index] ?? -1;
    if (!this.fadeTurns || placedAt < 0 || !this.m_board[index]) return null;
    if (this.m_anchored[index]) return null;
    // A stone placed on move i washes away once the history reaches
    // i + 2 × fadeTurns moves: just before its owner's turn after its last.
    return Math.max(0, placedAt + 2 * this.fadeTurns - this.m_history.length);
  }

  /**
   * How many more of its owner's turns a stone is still on the board for,
   * counting the owner's next turn, or null when it cannot fade. The count
   * only drops when its owner moves.
   */
  turnsLeft(index: number): number | null {
    const moves = this.movesLeft(index);
    if (moves === null) return null;
    const ownerToMove = this.m_board[index] === this.m_turn + 1 ? 1 : 0;
    return Math.floor((moves + ownerToMove) / 2);
  }

  /**
   * Fading pieces: after a move, unanchored stones that have lasted
   * `fadeTurns` of their owner's turns wash away. Nothing fades once the
   * game has been won. Returns the points that were cleared.
   */
  expireStones(): Array<{ point: Point; owner: PlayerColor }> {
    if (!this.fadeTurns || this.checkGameOver()) return [];
    const cleared: Array<{ point: Point; owner: PlayerColor }> = [];
    const moves = this.m_history.length;
    for (let index = 0; index < this.m_board.length; index++) {
      const placedAt = this.m_placedAt[index] ?? -1;
      if (
        this.m_board[index] !== 0 &&
        !this.m_anchored[index] &&
        placedAt >= 0 &&
        moves - placedAt >= 2 * this.fadeTurns
      ) {
        cleared.push({
          point: this.pointAt(index % this.W, Math.floor(index / this.W)),
          owner: this.m_board[index] === 1 ? 1 : 2,
        });
        this.m_board[index] = 0;
        this.m_placedAt[index] = -1;
      }
    }
    return cleared;
  }

  /** With fading pieces the board may never fill, so play is capped. */
  get moveLimit(): number {
    return this.fadeTurns ? 2 * this.W * this.H : Infinity;
  }

  advanceTurn(): void {
    this.m_turn = this.m_turn === 0 ? 1 : 0;
  }

  checkGameOver(): 0 | PlayerColor {
    const target = this.winScore || 150;
    if (this.m_players[0].m_score >= target) return 1;
    if (this.m_players[1].m_score >= target) return 2;
    return 0;
  }

  getOutcome(): GameOutcome {
    const winner = this.checkGameOver();
    if (winner === 1) {
      return { state: GAME_STATES.PLAYER_1_WIN, status: "player1_win", winner };
    }
    if (winner === 2) {
      return { state: GAME_STATES.PLAYER_2_WIN, status: "player2_win", winner };
    }
    if (
      this.m_board.some((cell) => cell === 0) &&
      this.m_history.length < this.moveLimit
    ) {
      return { state: GAME_STATES.RUNNING, status: "running", winner: null };
    }
    const firstScore = this.m_players[0].m_score;
    const secondScore = this.m_players[1].m_score;
    if (firstScore > secondScore) {
      return {
        state: GAME_STATES.PLAYER_1_WIN,
        status: "player1_win",
        winner: 1,
      };
    }
    if (secondScore > firstScore) {
      return {
        state: GAME_STATES.PLAYER_2_WIN,
        status: "player2_win",
        winner: 2,
      };
    }
    return { state: GAME_STATES.TIE, status: "tie", winner: null };
  }

  toJSON(): SerializableBoard {
    return {
      W: this.W,
      H: this.H,
      scoring: this.scoring,
      winScore: this.winScore,
      m_board: this.m_board,
      m_players: this.m_players,
      m_turn: this.m_turn,
      m_history: this.m_history,
      m_displayed_game_over: this.m_displayed_game_over,
      m_onlyShowLastSquares: this.m_onlyShowLastSquares,
      m_createRandomizedRangeOrder: this.m_createRandomizedRangeOrder,
      m_stopAt150: this.m_stopAt150,
      m_last: {
        x: this.m_last.x,
        y: this.m_last.y,
        index: this.m_last.index,
      },
      m_lastPoints: this.m_lastPoints,
      m_targets: [...this.m_targets],
      ...(this.fadeTurns
        ? {
            fadeTurns: this.fadeTurns,
            m_placedAt: [...this.m_placedAt],
            m_anchored: [...this.m_anchored],
          }
        : {}),
    };
  }

  static fromJSON(
    source: SerializableBoard,
    rng: RandomSource = Math.random,
  ): Board {
    const firstPlayer = source.m_players[0];
    const secondPlayer = source.m_players[1];
    if (!firstPlayer || !secondPlayer) {
      throw new Error("A Euclid board must contain exactly two players.");
    }

    const board = new Board(
      Player.fromJSON(firstPlayer),
      Player.fromJSON(secondPlayer),
      {
        W: source.W,
        H: source.H,
        scoring: source.scoring,
        winScore: source.winScore,
        skipInit: true,
        rng,
        fadeTurns: source.fadeTurns ?? 0,
      },
    );
    board.m_board = [...source.m_board];
    board.m_turn = source.m_turn === 1 ? 1 : 0;
    board.m_history = source.m_history.map(Point.fromJSON);
    board.m_displayed_game_over = source.m_displayed_game_over;
    board.m_onlyShowLastSquares = source.m_onlyShowLastSquares;
    board.m_createRandomizedRangeOrder = source.m_createRandomizedRangeOrder;
    board.m_stopAt150 = source.m_stopAt150;
    board.m_last = Point.fromJSON(source.m_last);
    board.m_lastPoints = source.m_lastPoints;
    board.m_targets = [
      source.m_targets?.[0] ?? null,
      source.m_targets?.[1] ?? null,
    ];
    const cells = board.W * board.H;
    board.m_placedAt =
      source.m_placedAt?.length === cells
        ? [...source.m_placedAt]
        : new Array<number>(cells).fill(-1);
    board.m_anchored =
      source.m_anchored?.length === cells
        ? [...source.m_anchored]
        : new Array<boolean>(cells).fill(false);
    return board;
  }

  clone(): Board {
    return Board.fromJSON(this.toJSON(), this.rng);
  }
}

export function isBoardValid(board: Board | null): board is Board {
  return (
    board instanceof Board &&
    board.m_board.length === board.W * board.H &&
    board.m_players.length === 2
  );
}

function sameSquare(left: Square, right: Square): boolean {
  return (
    left.p1.index === right.p1.index &&
    left.p2.index === right.p2.index &&
    left.p3.index === right.p3.index &&
    left.p4.index === right.p4.index &&
    left.points === right.points &&
    left.remain === right.remain &&
    left.clr === right.clr
  );
}

function compareOffense(
  left: ImmediateMoveCandidate,
  right: ImmediateMoveCandidate,
): number {
  return (
    right.ownGain - left.ownGain ||
    right.opponentGain - left.opponentGain ||
    left.point.index - right.point.index
  );
}

function compareDefense(
  left: ImmediateMoveCandidate,
  right: ImmediateMoveCandidate,
): number {
  return (
    right.opponentGain - left.opponentGain ||
    right.ownGain - left.ownGain ||
    left.point.index - right.point.index
  );
}
