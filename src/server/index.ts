import express from 'express';
import { InitResponse } from '../shared/types/api';
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

// ELO & players (bucketed: hvh = human vs human, hva = human vs AI)
const PLAYERS_KEY = (bucket: 'hvh'|'hva') => `euclid:players:${bucket}`;
const OLD_ELOKEY = (uid: string) => `euclid:elo:${uid}`;                       // legacy (pre-bucket)
const ELOKEY = (uid: string, bucket: 'hvh'|'hva') => `euclid:elo:${bucket}:${uid}`;

const MAX_IDLE_MS = 10 * 60 * 1000; // 10m
const ELO_START = 1200;
const ELO_K = 32;

// AI baselines per difficulty
const AI_BASE: Record<'casual'|'offensive'|'defensive'|'brutal', number> = {
  casual: 1000,
  offensive: 1200,
  defensive: 1350,
  brutal: 1600,
};

/* ===== Metrics helpers ===== */
const MSET = (name:string) => `euclid:metric:set:${name}`;
const MCOUNT = (name:string) => `euclid:metric:count:${name}`;

async function addUserToSet(name:string, uid: string | undefined | null) {
  if (!uid) return;
  const key = MSET(name);
  const s = await redis.get(key);
  let arr: string[] = [];
  if (s) { try { arr = JSON.parse(s) as string[]; } catch { arr = []; } }
  if (!arr.includes(uid)) {
    arr.push(uid);
    await redis.set(key, JSON.stringify(arr));
  }
}
async function scard(name:string): Promise<number> {
  const s = await redis.get(MSET(name));
  if (!s) return 0;
  try { return (JSON.parse(s) as any[]).length; } catch { return 0; }
}
async function sget(name:string): Promise<Set<string>> {
  const s = await redis.get(MSET(name));
  if (!s) return new Set<string>();
  try { return new Set(JSON.parse(s) as string[]); } catch { return new Set<string>(); }
}
async function incrCount(name:string, n=1): Promise<number> {
  const key = MCOUNT(name);
  const v = parseInt((await redis.get(key)) || '0', 10) + n;
  await redis.set(key, String(v));
  return v;
}
async function getCount(name:string): Promise<number> {
  return parseInt((await redis.get(MCOUNT(name))) || '0', 10);
}

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
  createdAt?: number;
  ended?: boolean;
  endedReason?: string;   // 'game_over' | 'player_left' | 'opponent_left' | 'tie'
  endedBy?: string;
};

/* =========================
   HELPERS
   ========================= */
function makeInitialBoardJson(
  user1: string,
  user2: string,
  opts: { names?: Record<string, string>, avatars?: Record<string,string> } = {}
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
    createdAt: Date.now(),
    ended: false,
    endedReason: '',
    endedBy: ''
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
async function getPlayers(bucket: 'hvh'|'hva'): Promise<string[]> {
  const s = await redis.get(PLAYERS_KEY(bucket));
  if (!s) return [];
  try { return JSON.parse(s) as string[]; } catch { return [];
  }
}
async function addPlayer(bucket: 'hvh'|'hva', uid: string): Promise<void> {
  const list = await getPlayers(bucket);
  if (!list.includes(uid)) {
    list.push(uid);
    await redis.set(PLAYERS_KEY(bucket), JSON.stringify(list));
  }
}
async function getElo(uid: string, bucket: 'hvh'|'hva'): Promise<EloRecord> {
  if (bucket === 'hvh') {
    const legacy = await redis.get(OLD_ELOKEY(uid));
    if (legacy) {
      try {
        const parsed = JSON.parse(legacy) as EloRecord;
        await redis.set(ELOKEY(uid, 'hvh'), legacy);
        await redis.del(OLD_ELOKEY(uid));
        await addPlayer('hvh', uid);
      } catch {}
    }
  }
  const s = await redis.get(ELOKEY(uid, bucket));
  if (!s) return { rating: ELO_START, games: 0, wins: 0, losses: 0, draws: 0 };
  try { return JSON.parse(s) as EloRecord; } catch { return { rating: ELO_START, games: 0, wins: 0, losses: 0, draws: 0 }; }
}
async function setElo(uid: string, bucket: 'hvh'|'hva', rec: EloRecord) {
  await redis.set(ELOKEY(uid, bucket), JSON.stringify(rec));
  await addPlayer(bucket, uid);
}
function updateEloPair(a: EloRecord, b: EloRecord, resultForA: 1 | 0 | 0.5): [EloRecord, EloRecord] {
  const Ra = a.rating, Rb = b.rating;
  const Ea = 1 / (1 + Math.pow(10, (Rb - Ra) / 400));
  const Eb = 1 / (1 + Math.pow(10, (Ra - Rb) / 400));
  const Sa = resultForA, Sb = resultForA === 1 ? 0 : resultForA === 0 ? 1 : 0.5;
  const newA = { ...a, rating: Math.round(Ra + ELO_K * (Sa - Ea)), games: a.games + 1, wins: a.wins + (Sa === 1 ? 1 : 0), losses: a.losses + (Sa === 0 ? 1 : 0), draws: a.draws + (Sa === 0.5 ? 1 : 0) };
  const newB = { ...b, rating: Math.round(Rb + ELO_K * (Sb - Eb)), games: b.games + 1, wins: b.wins + (Sb === 1 ? 1 : 0), losses: b.losses + (Sb === 0 ? 1 : 0), draws: b.draws + (Sb === 0.5 ? 1 : 0) };
  return [newA, newB];
}

/* =========================
   SERVER-SIDE MOVE/POINTS
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
      // metrics: app start
      const uid = context.userId || '';
      await addUserToSet('app_start_users', uid);
      await incrCount('app_start_count', 1);

      res.json({ type: 'init', postId, count: count ? parseInt(count) : 0, username: username ?? 'anonymous' });
    } catch (error: any) { res.status(400).json({ status: 'error', message: error?.message || 'Unknown init error' }); }
  }
);

/* =========================
   H2H: queue / pair / mapping / state / save / rematch / leave / list / stats
   ========================= */

router.post('/api/h2h/queue', async (_req, res) => {
  try {
    const uid = context.userId;
    if (!uid) return res.status(400).json({ status: 'error', message: 'userId missing' });

    // remember caller's name + avatar
    try {
      const nm = await reddit.getCurrentUsername();
      if (nm) await redis.set(NAMEKEY(uid), nm);
      let icon = '';
      try { icon = (await (reddit as any)?.getCurrentUserIcon?.()) ?? ''; } catch {}
      if (!icon) try { icon = (await (reddit as any)?.getCurrentUserAvatar?.()) ?? ''; } catch {}
      if (icon) await redis.set(AVAKEY(uid), icon);
    } catch {}

    // metrics: H2H click
    await addUserToSet('h2h_click_users', uid);
    await incrCount('h2h_click_count', 1);

    // Clear stale mapping
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

      const gid = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
      const board = makeInitialBoardJson(user1, user2, { names, avatars });

      await Promise.all([
        redis.set(GAMEKEY(gid), JSON.stringify(board)),
        redis.set(USERMAP(user1), gid),
        redis.set(USERMAP(user2), gid),
        addActiveGame(gid)
      ]);

      // metrics: H2H started
      await addUserToSet('h2h_started_users', user1);
      await addUserToSet('h2h_started_users', user2);
      await incrCount('h2h_started_count', 1);

      return res.json({ queued: true, paired: true, gameId: gid, board, me: uid, isPlayer1: uid === user1 });
    }

    return res.json({ queued: true, paired: false, me: uid });
  } catch (e: any) {
    console.error('[H2H] queue error', e);
    res.status(500).json({ status: 'error', message: e?.message || String(e) });
  }
});

router.post('/api/h2h/cancelQueue', async (_req, res) => {
  try {
    const uid = context.userId;
    if (!uid) return res.status(401).json({ status: 'error', message: 'userId missing' });

    const s = await redis.get(QKEY);
    let removed = false;
    if (s) {
      try {
        const q = JSON.parse(s) as string[];
        const idx = q.indexOf(uid);
        if (idx >= 0) {
          q.splice(idx, 1);
          removed = true;
          await redis.set(QKEY, JSON.stringify(q));
        }
      } catch {}
    }

    const mapped = await redis.get(USERMAP(uid));
    if (mapped) await redis.del(USERMAP(uid));

    await incrCount('h2h_cancel_queue_count', 1);
    slog('[H2H] cancelQueue', { uid, removed, wasMapped: !!mapped });
    res.json({ ok: true, removed });
  } catch (e: any) {
    console.error('[H2H] cancelQueue error', e);
    res.status(500).json({ status: 'error', message: e?.message || String(e) });
  }
});

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
        await incrCount('h2h_opponent_left_count', 1);
      }
    } else if (ended) {
      const s1 = board.m_players[0].m_score ?? 0;
      const s2 = board.m_players[1].m_score ?? 0;
      if (endedReason === 'game_over') victorSide = s1 > s2 ? 1 : s2 > s1 ? 2 : undefined;
      else if (endedReason === 'player_left') victorSide = endedBy === u1 ? 2 : 1;
      else if (endedReason === 'opponent_left') victorSide = meIsP1 ? 1 : 2;
      // tie -> no victorSide
    }

    return res.json({ gameId: gid, board, ended, endedReason, endedBy, victorSide });
  } catch (e: any) {
    console.error('[H2H] state error', e);
    res.status(500).json({ status: 'error', message: e?.message || String(e) });
  }
});

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

    const { points, squares } = computeSquaresAndPoints(a, x, y, expectedClr);

    serverBoard.m_board[idx] = expectedClr;
    serverBoard.m_last = { x, y, index: idx };
    serverBoard.m_lastPoints = points;
    serverBoard.m_history = serverBoard.m_history || [];
    serverBoard.m_history.push({ x, y, index: idx });

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

    serverBoard.m_turn = (serverBoard.m_turn + 1) % 2;

    // Determine end state
    let gameEnded = false;
    let winnerUid = '';
    let loserUid = '';
    const s1 = serverBoard.m_players?.[0]?.m_score ?? 0;
    const s2 = serverBoard.m_players?.[1]?.m_score ?? 0;
    if (s1 >= 150 || s2 >= 150) {
      gameEnded = true;
      serverBoard.ended = true;
      serverBoard.endedReason = 'game_over';
      winnerUid = s1 > s2 ? serverBoard.m_players[0].userId : s2 > s1 ? serverBoard.m_players[1].userId : '';
      loserUid  = s1 > s2 ? serverBoard.m_players[1].userId : s2 > s1 ? serverBoard.m_players[0].userId : '';
    }

    // Tie if the board is now full and no one reached 150 (no winner)
    if (!gameEnded) {
      const anyEmpty = serverBoard.m_board.some(v=>v===0);
      if (!anyEmpty) {
        gameEnded = true;
        serverBoard.ended = true;
        serverBoard.endedReason = 'tie';
      }
    }

    await saveBoard(gameId, serverBoard);

    if (gameEnded) {
      if (serverBoard.endedReason === 'game_over' && winnerUid && loserUid) {
        const [aRec, bRec] = await Promise.all([getElo(winnerUid, 'hvh'), getElo(loserUid, 'hvh')]);
        const [na, nb] = updateEloPair(aRec, bRec, 1);
        await Promise.all([setElo(winnerUid, 'hvh', na), setElo(loserUid, 'hvh', nb)]);
      }
      if (serverBoard.endedReason === 'game_over') {
        await incrCount('h2h_game_over_count', 1);
        await addUserToSet('h2h_completed_users', serverBoard.m_players[0].userId);
        await addUserToSet('h2h_completed_users', serverBoard.m_players[1].userId);
      }
      await removeActiveGame(gameId);
    }

    slog('[H2H] save', { gameId, by: uid, x, y, points, gameEnded, reason: serverBoard.endedReason });
    return res.json({ ok: true, ended: gameEnded });
  } catch (e: any) {
    console.error('[H2H] save error', e);
    res.status(500).json({ status: 'error', message: e?.message || String(e) });
  }
});

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

    slog('[H2H] rematch', { gameId, by: uid });
    return res.json({ ok: true, board });
  } catch (e: any) {
    console.error('[H2H] rematch error', e);
    res.status(500).json({ status: 'error', message: e?.message || String(e) });
  }
});

router.post('/api/h2h/leave', async (_req, res) => {
  try {
    const uid = context.userId;
    if (!uid) return res.status(401).json({ status: 'error', message: 'userId missing' });

    const gid = await redis.get(USERMAP(uid));
    if (gid) {
      const board = await loadBoard(gid);
      if (board && !board.ended) {
        const u1 = board.m_players?.[0]?.userId, u2 = board.m_players?.[1]?.userId;
        if (uid === u1 || uid === u2) {
          board.ended = true;
          board.endedReason = 'player_left';
          board.endedBy = uid;
          await incrCount('h2h_player_left_count', 1);
          await saveBoard(gid, board);
          await removeActiveGame(gid);
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
    live.sort((a, b) => (b.lastSaved ?? 0) - (a.lastSaved ?? 0));
    res.json({ games: live });
  } catch (e: any) {
    res.status(500).json({ status: 'error', message: e?.message || String(e) });
  }
});

router.get('/api/user/stats', async (_req, res) => {
  try {
    const uid = context.userId;
    if (!uid) return res.status(400).json({ status: 'error', message: 'userId missing' });
    const [hvh, hva] = await Promise.all([getElo(uid, 'hvh'), getElo(uid, 'hva')]);
    res.json({ hvh, hva });
  } catch (e: any) {
    res.status(500).json({ status: 'error', message: e?.message || String(e) });
  }
});

/* =========================
   Solo (Human vs AI) — record result into HVA bucket + metrics
   ========================= */
router.post('/api/solo/record', async (req, res) => {
  try {
    const uid = context.userId;
    if (!uid) return res.status(401).json({ status: 'error', message: 'userId missing' });

    const { difficulty, youScore, botScore } = (req.body || {}) as { difficulty: 'casual'|'offensive'|'defensive'|'brutal'; youScore:number; botScore:number };
    if (!difficulty || !(difficulty in AI_BASE)) return res.status(400).json({ status: 'error', message: 'invalid difficulty' });
    const ys = Number(youScore) || 0;
    const bs = Number(botScore) || 0;

    const result: 1|0|0.5 = ys>bs ? 1 : ys<bs ? 0 : 0.5;
    const me = await getElo(uid, 'hva');
    const bot: EloRecord = { rating: AI_BASE[difficulty], games: 0, wins: 0, losses: 0, draws: 0 };
    const [meAfter] = updateEloPair(me, bot, result);
    await setElo(uid, 'hva', meAfter);

    // metrics
    await addUserToSet('ai_completed_users', uid);
    await incrCount('ai_completed_count', 1);
    await incrCount(`ai_diff_${difficulty}_count`, 1);

    slog('[SOLO] record', { uid, difficulty, ys, bs, rating: meAfter.rating });
    res.json({ ok: true, rating: meAfter.rating });
  } catch (e:any) {
    console.error('[SOLO] record error', e);
    res.status(500).json({ status: 'error', message: e?.message || String(e) });
  }
});

/* =========================
   Simple metrics endpoints for clicks/first move
   ========================= */
router.post('/api/metrics/ai-click', async (_req, res) => {
  try {
    const uid = context.userId || '';
    await addUserToSet('ai_click_users', uid);
    await incrCount('ai_click_count', 1);
    res.json({ ok: true });
  } catch (e:any) { res.status(500).json({ status:'error', message:e?.message||String(e) }); }
});
router.post('/api/metrics/ai-first', async (_req, res) => {
  try {
    const uid = context.userId || '';
    await addUserToSet('ai_first_users', uid);
    await incrCount('ai_first_count', 1);
    res.json({ ok: true });
  } catch (e:any) { res.status(500).json({ status:'error', message:e?.message||String(e) }); }
});

/* =========================
   Rankings (both buckets)
   ========================= */
router.get('/api/rankings', async (_req, res) => {
  try {
    const toRows = async (bucket: 'hvh'|'hva') => {
      const ids = await getPlayers(bucket);
      const rows = await Promise.all(ids.map(async uid => {
        const rec = await getElo(uid, bucket);
        const [name, avatar] = await Promise.all([redis.get(NAMEKEY(uid)), redis.get(AVAKEY(uid))]);
        return {
          userId: uid,
          name: name || 'anonymous',
          avatar: avatar || '',
          rating: rec.rating,
          games: rec.games,
          wins: rec.wins,
          losses: rec.losses,
          draws: rec.draws
        };
      }));
      rows.sort((a,b)=> b.rating - a.rating || b.games - a.games || (a.name||'').localeCompare(b.name||''));
      return rows;
    };
    const [hvh, hva] = await Promise.all([toRows('hvh'), toRows('hva')]);
    res.json({ hvh, hva });
  } catch (e:any) {
    console.error('[RANKINGS] error', e);
    res.status(500).json({ status: 'error', message: e?.message || String(e) });
  }
});

/* =========================
   Admin metrics summary
   ========================= */
router.get('/api/admin/metrics', async (_req, res) => {
  try {
    const uniques = {
      app_start_users: await scard('app_start_users'),
      h2h_click_users: await scard('h2h_click_users'),
      h2h_started_users: await scard('h2h_started_users'),
      h2h_completed_users: await scard('h2h_completed_users'),
      ai_click_users: await scard('ai_click_users'),
      ai_first_users: await scard('ai_first_users'),
      ai_completed_users: await scard('ai_completed_users'),
    };

    const [h2h_click_set, h2h_started_set, h2h_completed_set, ai_click_set, ai_first_set, ai_completed_set] = await Promise.all([
      sget('h2h_click_users'),
      sget('h2h_started_users'),
      sget('h2h_completed_users'),
      sget('ai_click_users'),
      sget('ai_first_users'),
      sget('ai_completed_users'),
    ]);

    const diffCount = (a: Set<string>, b: Set<string>) => {
      let n = 0; for (const v of a) if (!b.has(v)) n++; return n;
    };

    const computed = {
      h2h_clicked_never_started: diffCount(h2h_click_set, h2h_started_set),
      h2h_started_never_finished: diffCount(h2h_started_set, h2h_completed_set),
      ai_clicked_never_started: diffCount(ai_click_set, ai_first_set),
      ai_started_never_finished: diffCount(ai_first_set, ai_completed_set),
    };

    const counts = {
      app_start_count: await getCount('app_start_count'),
      h2h_click_count: await getCount('h2h_click_count'),
      h2h_started_count: await getCount('h2h_started_count'),
      h2h_game_over_count: await getCount('h2h_game_over_count'),
      h2h_cancel_queue_count: await getCount('h2h_cancel_queue_count'),
      h2h_opponent_left_count: await getCount('h2h_opponent_left_count'),
      h2h_player_left_count: await getCount('h2h_player_left_count'),
      ai_click_count: await getCount('ai_click_count'),
      ai_first_count: await getCount('ai_first_count'),
      ai_completed_count: await getCount('ai_completed_count'),
    };

    const aiDiffs = {
      casual: await getCount('ai_diff_casual_count'),
      offensive: await getCount('ai_diff_offensive_count'),
      defensive: await getCount('ai_diff_defensive_count'),
      brutal: await getCount('ai_diff_brutal_count'),
    };

    const activeGames = (await getActiveGames()).length;
    const rankedPlayers = { hvh: (await getPlayers('hvh')).length, hva: (await getPlayers('hva')).length };

    res.json({ uniques, counts, computed, aiDiffs, activeGames, rankedPlayers });
  } catch (e:any) {
    console.error('[ADMIN] metrics error', e);
    res.status(500).json({ status:'error', message:e?.message||String(e) });
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

