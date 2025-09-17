import express from 'express';
import { InitResponse, IncrementResponse, DecrementResponse } from '../shared/types/api';
import { redis, reddit, createServer, context, getServerPort } from '@devvit/web/server';

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.text());

const router = express.Router();

/* =========================
   UTIL / CONSTANTS
   ========================= */
const nowISO = () => new Date().toISOString();
const slog = (...a: any[]) => console.log('[EUCLID ' + nowISO() + ']', ...a);

const BOARD_W = 8;
const BOARD_H = 8;

// Redis keys
const QKEY = 'euclid:queue_json';
const NAMEKEY = (uid: string) => `euclid:name:${uid}`;
const AVAKEY  = (uid: string) => `euclid:avatar:${uid}`;
const GAMEKEY = (gid: string) => `euclid:game:${gid}`;
const USERMAP = (uid: string) => `euclid:user:${uid}:game`;
const ACTIVE_GAMES = 'euclid:active_games';
// NOTE: We are not creating or updating Reddit posts for now.
// const GAMEPOST = (gid: string) => `euclid:gamepost:${gid}`;
const ELOKEY = (uid: string) => `euclid:elo:${uid}`;

const MAX_IDLE_MS = 10 * 60 * 1000; // 10m

// ELO
const ELO_START = 1200;
const ELO_K = 32;

/* =========================
   TYPES
   ========================= */
type SquarePoint = { x: number; y: number; index: number };
type SquareJSON = {
  p1: SquarePoint; p2: SquarePoint; p3: SquarePoint; p4: SquarePoint;
  points: number; remain: number; clr: number;
};
type PlayerJSON = {
  m_squares: SquareJSON[];
  m_score: number;
  m_lastNumSquares: number;
  m_playStyle: number;
  m_goofs: boolean;
  m_computer: boolean;
  userId: string;
};
type BoardJSON = {
  m_board: number[];
  m_players: PlayerJSON[];
  m_turn: number;
  m_history: Array<{ x: number; y: number; index: number }>;
  m_displayed_game_over: boolean;
  m_onlyShowLastSquares: boolean;
  m_createRandomizedRangeOrder: boolean;
  m_stopAt150: boolean;
  m_last: { x: number; y: number; index: number };
  m_lastPoints: number;
  playerNames?: Record<string, string>;
  playerAvatars?: Record<string, string>;
  lastSaved?: number;
  ended?: boolean;
  endedReason?: string;   // 'game_over' | 'player_left' | 'opponent_left'
  endedBy?: string;       // userId who left (if any)
  postId?: string;        // UNUSED for now
};

/* =========================
   HELPERS
   ========================= */
function makeInitialBoardJson(
  user1: string,
  user2: string,
  opts: { names?: Record<string, string>, avatars?: Record<string,string>, postId?: string } = {}
): BoardJSON {
  return {
    m_board: Array(BOARD_W * BOARD_H).fill(0),
    m_players: [
      { m_squares: [], m_score: 0, m_lastNumSquares: 0, m_playStyle: 1, m_goofs: false, m_computer: false, userId: user1 },
      { m_squares: [], m_score: 0, m_lastNumSquares: 0, m_playStyle: 1, m_goofs: false, m_computer: false, userId: user2 }
    ],
    m_turn: 0,
    m_history: [],
    m_displayed_game_over: false,
    m_onlyShowLastSquares: false,
    m_createRandomizedRangeOrder: true,
    m_stopAt150: true,
    m_last: { x: -1, y: -1, index: -1 },
    m_lastPoints: 0,
    playerNames: opts.names ?? {},
    playerAvatars: opts.avatars ?? {},
    lastSaved: Date.now(),
    ended: false,
    endedReason: '',
    endedBy: '',
    postId: undefined // explicit: not using posts for now
  };
}

async function loadBoard(gid: string): Promise<BoardJSON | null> {
  const s = await redis.get(GAMEKEY(gid));
  if (!s) return null;
  try { return JSON.parse(s) as BoardJSON; } catch { return null; }
}
async function saveBoard(gid: string, board: BoardJSON): Promise<void> {
  board.lastSaved = Date.now();
  await redis.set(GAMEKEY(gid), JSON.stringify(board));
}

async function getActiveGames(): Promise<string[]> {
  const s = await redis.get(ACTIVE_GAMES);
  if (!s) return [];
  try { return JSON.parse(s) as string[]; } catch { return []; }
}
async function addActiveGame(gid: string) {
  const list = await getActiveGames();
  if (!list.includes(gid)) {
    list.unshift(gid);
    await redis.set(ACTIVE_GAMES, JSON.stringify(list.slice(0, 50)));
  }
}
async function removeActiveGame(gid: string) {
  const list = await getActiveGames();
  const idx = list.indexOf(gid);
  if (idx >= 0) {
    list.splice(idx, 1);
    await redis.set(ACTIVE_GAMES, JSON.stringify(list));
  }
}

async function cleanupIfStale(gid: string): Promise<boolean> {
  const board = await loadBoard(gid);
  if (!board) return true;
  const idleMs = Date.now() - (board.lastSaved ?? 0);
  if (idleMs > MAX_IDLE_MS) {
    const u1 = board.m_players?.[0]?.userId;
    const u2 = board.m_players?.[1]?.userId;
    if (u1) await redis.del(USERMAP(u1));
    if (u2) await redis.del(USERMAP(u2));
    await redis.del(GAMEKEY(gid));
    await removeActiveGame(gid);
    slog('[H2H] cleanup stale game', { gid, idleMs });
    return true;
  }
  return false;
}

// ELO storage
type EloRecord = { rating: number; games: number; wins: number; losses: number; draws: number };
async function getElo(uid: string): Promise<EloRecord> {
  const s = await redis.get(ELOKEY(uid));
  if (!s) return { rating: ELO_START, games: 0, wins: 0, losses: 0, draws: 0 };
  try { return JSON.parse(s) as EloRecord; } catch { return { rating: ELO_START, games: 0, wins: 0, losses: 0, draws: 0 }; }
}
async function setElo(uid: string, rec: EloRecord) { await redis.set(ELOKEY(uid), JSON.stringify(rec)); }
function updateEloPair(a: EloRecord, b: EloRecord, resultForA: 1 | 0 | 0.5): [EloRecord, EloRecord] {
  const Ra = a.rating, Rb = b.rating;
  const Ea = 1 / (1 + Math.pow(10, (Rb - Ra) / 400));
  const Eb = 1 / (1 + Math.pow(10, (Ra - Rb) / 400));
  const Sa = resultForA, Sb = resultForA === 1 ? 0 : resultForA === 0 ? 1 : 0.5;
  const newA = { ...a, rating: Math.round(Ra + ELO_K * (Sa - Ea)), games: a.games + 1, wins: a.wins + (Sa === 1 ? 1 : 0), losses: a.losses + (Sa === 0 ? 1 : 0), draws: a.draws + (Sa === 0.5 ? 1 : 0) };
  const newB = { ...b, rating: Math.round(Rb + ELO_K * (Sb - Eb)), games: b.games + 1, wins: b.wins + (Sb === 1 ? 1 : 0), losses: b.losses + (Sb === 0 ? 1 : 0), draws: b.draws + (Sb === 0.5 ? 1 : 0) };
  return [newA, newB];
}

/* ===== Reddit post helpers (DISABLED) ===== */
// For now, we do not create or update game posts.
// These stubs intentionally no-op to avoid side effects and errors.
async function createGamePostWithTitle(_title: string, _body?: string): Promise<string> {
  return '';
}
async function updateGamePostStatus(_postFullname?: string, _opts: { flairText?: string; body?: string; title?: string } = {}) {
  return;
}
function formatResultBody(board: BoardJSON, reason: string, extra?: { winnerUid?: string; loserUid?: string; afterWinner?: number; afterLoser?: number }) {
  const u1 = board.m_players[0].userId, u2 = board.m_players[1].userId;
  const names = board.playerNames || {};
  const n1 = names[u1] || 'Player 1';
  const n2 = names[u2] || 'Player 2';
  const s1 = board.m_players[0].m_score ?? 0;
  const s2 = board.m_players[1].m_score ?? 0;

  const winnerName = s1 > s2 ? n1 : (s2 > s1 ? n2 : 'Tie');
  const lines = [
    `**Result:** ${winnerName} (${s1}–${s2})`,
    `**Reason:** ${reason === 'game_over' ? 'Score reached 150' : reason === 'player_left' ? 'Player left' : reason === 'opponent_left' ? 'Opponent left' : reason}`,
    `**Players:** ${n1} vs ${n2}`,
    `**Final Score:** ${n1} ${s1} — ${s2} ${n2}`
  ];

  if (extra?.afterWinner != null && extra?.afterLoser != null && extra?.winnerUid && extra?.loserUid) {
    const wn = names[extra.winnerUid] || 'Winner';
    const ln = names[extra.loserUid] || 'Loser';
    lines.push(`**ELO:** ${wn} ${extra.afterWinner}, ${ln} ${extra.afterLoser}`);
  }
  return lines.join('\n\n');
}

/* =========================
   SERVER-SIDE MOVE/POINTS (no geometry changes)
   ========================= */
function squareKey(p1: SquarePoint, p2: SquarePoint, p3: SquarePoint, p4: SquarePoint): string {
  const arr = [p1.index, p2.index, p3.index, p4.index].slice().sort((a, b) => a - b);
  return arr.join(',');
}

function computeSquaresAndPoints(boardArr: number[], x: number, y: number, clr: number): { points: number; squares: SquareJSON[] } {
  const other = clr === 1 ? 2 : 1;
  let total = 0;
  const squares: SquareJSON[] = [];

  for (let row = 0; row < BOARD_H; row++) {
    for (let col = 0; col < BOARD_W; col++) {
      const dx = col - x;
      const dy = row - y;
      const x1 = x - dy, y1 = y + dx;
      const x2 = col - dy, y2 = row + dx;
      if (x1 < 0 || x1 >= BOARD_W || y1 < 0 || y1 >= BOARD_H || x2 < 0 || x2 >= BOARD_W || y2 < 0 || y2 >= BOARD_H) continue;
      if (col === x && row === y) continue;

      const v1 = clr; // placed here
      const v2 = boardArr[row * BOARD_W + col];
      const v3 = boardArr[y1 * BOARD_W + x1];
      const v4 = boardArr[y2 * BOARD_W + x2];
      if (v1 === other || v2 === other || v3 === other || v4 === other) continue;

      const remain = (v1 === 0 ? 1 : 0) + (v2 === 0 ? 1 : 0) + (v3 === 0 ? 1 : 0) + (v4 === 0 ? 1 : 0);
      if (remain === 0) {
        const left = Math.min(x, col, x1, x2);
        const top = Math.min(y, row, y1, y2);
        const right = Math.max(x, col, x1, x2);
        const bottom = Math.max(y, row, y1, y2);
        const score = (right - left + 1) * (bottom - top + 1);
        total += score;

        const p1 = { x, y, index: y * BOARD_W + x };
        const p2 = { x: col, y: row, index: row * BOARD_W + col };
        const p3 = { x: x1, y: y1, index: y1 * BOARD_W + x1 };
        const p4 = { x: x2, y: y2, index: y2 * BOARD_W + x2 };
        squares.push({ p1, p2, p3, p4, points: score, remain: 0, clr });
      }
    }
  }
  // Dedup any duplicates due to symmetric iterations
  const seen = new Set<string>();
  const deduped: SquareJSON[] = [];
  for (const s of squares) {
    const k = squareKey(s.p1, s.p2, s.p3, s.p4);
    if (!seen.has(k)) { seen.add(k); deduped.push(s); }
  }
  return { points: total, squares: deduped };
}

/* =========================
   BASIC ROUTES
   ========================= */
router.get<{ postId: string }, InitResponse | { status: string; message: string }>(
  '/api/init',
  async (_req, res): Promise<void> => {
    const { postId } = context;
    if (!postId) return res.status(400).json({ status: 'error', message: 'postId is required but missing from context' });
    try {
      const [count, username] = await Promise.all([redis.get('count'), reddit.getCurrentUsername()]);
      res.json({ type: 'init', postId, count: count ? parseInt(count) : 0, username: username ?? 'anonymous' });
    } catch (error: any) { res.status(400).json({ status: 'error', message: error?.message || 'Unknown init error' }); }
  }
);

/* =========================
   H2H: queue / pair / mapping / state / save / rematch / leave / list / stats
   ========================= */

// Enqueue & pair (NO automatic post creation)
router.post('/api/h2h/queue', async (_req, res) => {
  try {
    const uid = context.userId;
    if (!uid) return res.status(400).json({ status: 'error', message: 'userId missing' });

    // remember caller's name + avatar (for pairing)
    try {
      const nm = await reddit.getCurrentUsername();
      if (nm) await redis.set(NAMEKEY(uid), nm);
      let icon = '';
      try { icon = (await (reddit as any)?.getCurrentUserIcon?.()) ?? ''; } catch {}
      if (!icon) try { icon = (await (reddit as any)?.getCurrentUserAvatar?.()) ?? ''; } catch {}
      if (icon) await redis.set(AVAKEY(uid), icon);
    } catch {}

    // Clear stale mapping if any
    const stale = await redis.get(USERMAP(uid));
    if (stale) await redis.del(USERMAP(uid));

    // Push into queue
    const s = await redis.get(QKEY);
    const q = s ? JSON.parse(s) as string[] : [];
    if (!q.includes(uid)) q.push(uid);
    await redis.set(QKEY, JSON.stringify(q));

    slog('[H2H] queue', { uid, len: q.length });

    if (q.length >= 2) {
      const user1 = q.shift() as string;
      const user2 = q.shift() as string;
      await redis.set(QKEY, JSON.stringify(q));

      const [n1, n2, a1, a2] = await Promise.all([
        redis.get(NAMEKEY(user1)), redis.get(NAMEKEY(user2)),
        redis.get(AVAKEY(user1)), redis.get(AVAKEY(user2))
      ]);

      const names: Record<string,string> = {};
      if (n1) names[user1] = n1!;
      if (n2) names[user2] = n2!;
      const avatars: Record<string,string> = {};
      if (a1) avatars[user1] = a1!;
      if (a2) avatars[user2] = a2!;

      // No post creation
      const gid = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
      const board = makeInitialBoardJson(user1, user2, { names, avatars });

      await Promise.all([
        redis.set(GAMEKEY(gid), JSON.stringify(board)),
        redis.set(USERMAP(user1), gid),
        redis.set(USERMAP(user2), gid),
        addActiveGame(gid)
      ]);

      return res.json({ queued: true, paired: true, gameId: gid, board, me: uid, isPlayer1: uid === user1 });
    }

    return res.json({ queued: true, paired: false, me: uid });
  } catch (e: any) {
    console.error('[H2H] queue error', e);
    res.status(500).json({ status: 'error', message: e?.message || String(e) });
  }
});

// mapping (refresh caller's name/avatar)
router.get('/api/h2h/mapping', async (_req, res) => {
  try {
    const uid = context.userId;
    if (!uid) return res.status(400).json({ status: 'error', message: 'userId missing' });

    const gid = await redis.get(USERMAP(uid));
    if (!gid) return res.json({ gameId: null, me: uid });

    if (await cleanupIfStale(gid)) return res.json({ gameId: null, me: uid });

    const board = await loadBoard(gid);
    if (!board) return res.json({ gameId: gid, board: null, me: uid });

    board.playerNames = board.playerNames || {};
    board.playerAvatars = board.playerAvatars || {};
    try {
      const myName = await reddit.getCurrentUsername();
      if (myName) board.playerNames[uid] = board.playerNames[uid] || myName;
      let icon = await redis.get(AVAKEY(uid));
      if (!icon) {
        try { icon = (await (reddit as any)?.getCurrentUserIcon?.()) ?? ''; } catch {}
        if (!icon) try { icon = (await (reddit as any)?.getCurrentUserAvatar?.()) ?? ''; } catch {}
        if (icon) await redis.set(AVAKEY(uid), icon);
      }
      if (icon) board.playerAvatars[uid] = icon!;
      await saveBoard(gid, board);
    } catch {}

    const isP1 = board?.m_players?.[0]?.userId === uid;
    slog('[H2H] mapping', { uid, gameId: gid, isPlayer1: isP1, hasBoard: !!board });
    return res.json({ gameId: gid, board, me: uid, isPlayer1: isP1 });
  } catch (e: any) {
    console.error('[H2H] mapping error', e);
    res.status(500).json({ status: 'error', message: e?.message || String(e) });
  }
});

// state (detect opponent-left; prune)
router.get('/api/h2h/state', async (req, res) => {
  try {
    const gid = String(req.query.gameId || '');
    if (!gid) return res.status(400).json({ status: 'error', message: 'gameId required' });

    const stale = await cleanupIfStale(gid);
    if (stale) { await removeActiveGame(gid); return res.status(410).json({ status: 'gone', message: 'game stale/cleared' }); }

    const board = await loadBoard(gid);
    if (!board) return res.status(404).json({ status: 'error', message: 'game not found' });

    const uid = context.userId || '';
    const u1 = board.m_players?.[0]?.userId;
    const u2 = board.m_players?.[1]?.userId;
    const meIsP1 = uid && u1 === uid;
    const oppId = meIsP1 ? u2 : u1;

    let ended = !!board.ended;
    let endedReason = board.endedReason || '';
    let endedBy = board.endedBy || '';
    let victorSide: 1|2|undefined;

    if (!ended && oppId) {
      const [oppMapped, meMapped] = await Promise.all([redis.get(USERMAP(oppId)), uid ? redis.get(USERMAP(uid)) : Promise.resolve(null)]);
      if ((!uid || meMapped) && !oppMapped) {
        ended = true;
        endedReason = 'opponent_left';
        endedBy = oppId!;
        board.ended = true;
        board.endedReason = endedReason;
        board.endedBy = endedBy;
        await saveBoard(gid, board);
        await removeActiveGame(gid);

        // Post updates disabled
        // const names = board.playerNames || {};
        // const n1 = names[u1||''] || 'Player 1';
        // const n2 = names[u2||''] || 'Player 2';
        // const body = formatResultBody(board, endedReason);
        // await updateGamePostStatus(board.postId, { flairText: 'Game Over', title: `${n1} vs ${n2} — Game Over`, body });
      }
    } else if (ended) {
      const s1 = board.m_players[0].m_score ?? 0;
      const s2 = board.m_players[1].m_score ?? 0;
      if (endedReason === 'game_over') victorSide = s1 >= s2 ? 1 : 2;
      else if (endedReason === 'player_left') victorSide = endedBy === u1 ? 2 : 1;
      else if (endedReason === 'opponent_left') victorSide = meIsP1 ? 1 : 2;
    }

    return res.json({ gameId: gid, board, ended, endedReason, endedBy, victorSide });
  } catch (e: any) {
    console.error('[H2H] state error', e);
    res.status(500).json({ status: 'error', message: e?.message || String(e) });
  }
});

// save — server-authoritative validation; on game over update ELO (no post updates)
router.post('/api/h2h/save', async (req, res) => {
  try {
    const uid = context.userId;
    if (!uid) return res.status(401).json({ status: 'error', message: 'userId missing' });

    const { gameId, board: clientBoard } = (req.body || {}) as { gameId: string; board: BoardJSON };
    if (!gameId || !clientBoard) return res.status(400).json({ status: 'error', message: 'gameId + board required' });

    const mapped = await redis.get(USERMAP(uid));
    if (mapped !== gameId) return res.status(403).json({ status: 'error', message: 'not mapped to this game' });

    const serverBoard = await loadBoard(gameId);
    if (!serverBoard) return res.status(404).json({ status: 'error', message: 'game not found' });
    if (serverBoard.ended) return res.status(409).json({ status: 'error', message: 'game already ended' });

    const u1 = serverBoard.m_players?.[0]?.userId;
    const u2 = serverBoard.m_players?.[1]?.userId;
    const callerSide = uid === u1 ? 0 : (uid === u2 ? 1 : -1);
    if (callerSide < 0) return res.status(403).json({ status: 'error', message: 'not a participant' });

    if (serverBoard.m_turn !== callerSide) return res.status(409).json({ status: 'error', message: 'not your turn' });

    // Validate single-cell diff: exactly one 0->(current_player) change
    const expectedClr = serverBoard.m_turn + 1;
    const diffs: number[] = [];
    const a = serverBoard.m_board;
    const b = (clientBoard.m_board || []);
    if (b.length !== a.length) return res.status(400).json({ status: 'error', message: 'invalid board size' });
    for (let i = 0; i < a.length; i++) {
      if (a[i] !== b[i]) diffs.push(i);
      if (diffs.length > 1) break;
    }
    if (diffs.length !== 1) return res.status(400).json({ status: 'error', message: 'exactly one cell must change' });

    const idx = diffs[0];
    if (a[idx] !== 0) return res.status(400).json({ status: 'error', message: 'cell already occupied' });
    if (b[idx] !== expectedClr) return res.status(400).json({ status: 'error', message: 'illegal mark value' });

    const x = idx % BOARD_W, y = Math.floor(idx / BOARD_W);

    // Compute points & completed squares for THIS move (no geometry changes)
    const { points, squares } = computeSquaresAndPoints(a, x, y, expectedClr);

    // Apply move server-side authoritatively
    serverBoard.m_board[idx] = expectedClr;
    serverBoard.m_last = { x, y, index: idx };
    serverBoard.m_lastPoints = points;
    serverBoard.m_history = serverBoard.m_history || [];
    serverBoard.m_history.push({ x, y, index: idx });

    // Merge completed squares (dedup) for overlay fidelity across clients
    const playerSquares = serverBoard.m_players[callerSide].m_squares || [];
    const existing = new Set<string>(playerSquares.map(s => squareKey(s.p1, s.p2, s.p3, s.p4)));
    let added = 0;
    for (const s of squares) {
      const k = squareKey(s.p1, s.p2, s.p3, s.p4);
      if (!existing.has(k)) { existing.add(k); playerSquares.push(s); added++; }
    }
    serverBoard.m_players[callerSide].m_squares = playerSquares;
    serverBoard.m_players[callerSide].m_lastNumSquares = added;
    serverBoard.m_players[callerSide].m_score = (serverBoard.m_players[callerSide].m_score || 0) + points;

    // Advance turn
    serverBoard.m_turn = (serverBoard.m_turn + 1) % 2;

    // Detect winner
    let gameEnded = false;
    let winnerUid = '';
    let loserUid = '';
    const s1 = serverBoard.m_players?.[0]?.m_score ?? 0;
    const s2 = serverBoard.m_players?.[1]?.m_score ?? 0;
    if (s1 >= 150 || s2 >= 150) {
      gameEnded = true;
      serverBoard.ended = true;
      serverBoard.endedReason = 'game_over';
      winnerUid = s1 >= s2 ? serverBoard.m_players[0].userId : serverBoard.m_players[1].userId;
      loserUid  = s1 >= s2 ? serverBoard.m_players[1].userId : serverBoard.m_players[0].userId;
    }

    await saveBoard(gameId, serverBoard);

    if (gameEnded) {
      let afterW: number | undefined, afterL: number | undefined;
      if (winnerUid && loserUid) {
        const [aRec, bRec] = await Promise.all([getElo(winnerUid), getElo(loserUid)]);
        const [na, nb] = updateEloPair(aRec, bRec, 1);
        await Promise.all([setElo(winnerUid, na), setElo(loserUid, nb)]);
        afterW = na.rating; afterL = nb.rating;
      }
      await removeActiveGame(gameId);

      // Post updates disabled:
      // const names = serverBoard.playerNames || {};
      // const n1 = names[u1||''] || 'Player 1';
      // const n2 = names[u2||''] || 'Player 2';
      // const body = formatResultBody(serverBoard, 'game_over', { winnerUid, loserUid, afterWinner: afterW!, afterLoser: afterL! });
      // await updateGamePostStatus(serverBoard.postId, { flairText: 'Game Over', title: `${n1} vs ${n2} — Game Over`, body });
    } else {
      // keep in active list (already there from pairing/rematch)
    }

    slog('[H2H] save', { gameId, by: uid, x, y, points, gameEnded });
    return res.json({ ok: true, ended: gameEnded });
  } catch (e: any) {
    console.error('[H2H] save error', e);
    res.status(500).json({ status: 'error', message: e?.message || String(e) });
  }
});

// rematch — restrict to participants and only after end (no post updates)
router.post('/api/h2h/rematch', async (req, res) => {
  try {
    const uid = context.userId;
    if (!uid) return res.status(401).json({ status: 'error', message: 'userId missing' });

    const { gameId } = (req.body || {}) as { gameId: string };
    if (!gameId) return res.status(400).json({ status: 'error', message: 'gameId required' });

    const old = await loadBoard(gameId);
    if (!old) return res.status(404).json({ status: 'error', message: 'game not found' });

    const u1 = old.m_players?.[0]?.userId;
    const u2 = old.m_players?.[1]?.userId;
    if (!u1 || !u2) return res.status(400).json({ status: 'error', message: 'player ids missing' });
    if (uid !== u1 && uid !== u2) return res.status(403).json({ status: 'error', message: 'not a participant' });

    if (!old.ended) return res.status(409).json({ status: 'error', message: 'cannot rematch while game is live' });

    const board = makeInitialBoardJson(u1, u2, { names: old.playerNames || {}, avatars: old.playerAvatars || {} });
    await saveBoard(gameId, board);
    await addActiveGame(gameId);

    // Post updates disabled
    // const names = board.playerNames || {};
    // const n1 = names[u1||''] || 'Player 1';
    // const n2 = names[u2||''] || 'Player 2';
    // await updateGamePostStatus(board.postId, { flairText: 'Playing Now', title: `${n1} vs ${n2} — Playing Now` });

    slog('[H2H] rematch', { gameId, by: uid });
    return res.json({ ok: true, board });
  } catch (e: any) {
    console.error('[H2H] rematch error', e);
    res.status(500).json({ status: 'error', message: e?.message || String(e) });
  }
});

// leave — participant only; spectators are no-ops (no post updates)
router.post('/api/h2h/leave', async (_req, res) => {
  try {
    const uid = context.userId;
    if (!uid) return res.status(401).json({ status: 'error', message: 'userId missing' });

    const gid = await redis.get(USERMAP(uid));
    if (gid) {
      const board = await loadBoard(gid);
      if (board && !board.ended) {
        // ensure caller is a participant
        const u1 = board.m_players?.[0]?.userId, u2 = board.m_players?.[1]?.userId;
        if (uid === u1 || uid === u2) {
          board.ended = true;
          board.endedReason = 'player_left';
          board.endedBy = uid;
          await saveBoard(gid, board);
          await removeActiveGame(gid);

          // Post updates disabled
          // const names = board.playerNames || {};
          // const n1 = names[u1||''] || 'Player 1';
          // const n2 = names[u2||''] || 'Player 2';
          // const body = formatResultBody(board, 'player_left');
          // await updateGamePostStatus(board.postId, { flairText: 'Game Over', title: `${n1} vs ${n2} — Game Over`, body });
        }
      }
      await redis.del(USERMAP(uid));
    }

    slog('[H2H] leave', { uid, gameId: gid ?? null });
    res.json({ ok: true, gameId: gid ?? null });
  } catch (e: any) {
    console.error('[H2H] leave error', e);
    res.status(500).json({ status: 'error', message: e?.message || String(e) });
  }
});

// live-only spectator list
router.get('/api/games/list', async (_req, res) => {
  try {
    const ids = await getActiveGames();
    const live: any[] = [];
    for (const gid of ids) {
      const stale = await cleanupIfStale(gid);
      if (stale) continue;
      const b = await loadBoard(gid);
      if (!b || b.ended) continue;
      const u1 = b.m_players?.[0]?.userId, u2 = b.m_players?.[1]?.userId;
      if (!u1 || !u2) continue;
      const [m1, m2] = await Promise.all([redis.get(USERMAP(u1)), redis.get(USERMAP(u2))]);
      if (!m1 || !m2) continue;
      live.push({
        gameId: gid,
        names: b.playerNames || {},
        scores: [b.m_players?.[0]?.m_score ?? 0, b.m_players?.[1]?.m_score ?? 0],
        lastSaved: b.lastSaved ?? 0
      });
    }
    res.json({ games: live });
  } catch (e: any) {
    res.status(500).json({ status: 'error', message: e?.message || String(e) });
  }
});

// user stats (ELO + record)
router.get('/api/user/stats', async (_req, res) => {
  try {
    const uid = context.userId;
    if (!uid) return res.status(400).json({ status: 'error', message: 'userId missing' });
    const rec = await getElo(uid);
    res.json(rec);
  } catch (e: any) {
    res.status(500).json({ status: 'error', message: e?.message || String(e) });
  }
});

/* =========================
   Attach router + start
   ========================= */
app.use(router);
const port = getServerPort();
const server = createServer(app);
server.on('error', (err) => console.error(`server error; ${err.stack}`));
server.listen(port);

