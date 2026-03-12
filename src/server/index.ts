import express from 'express';
import { randomUUID } from 'node:crypto';
import {
  InitResponse,
  RankingsSharePayload,
  SerializableBoard,
  ShareBucket,
  SharePostDescriptor,
  SharedPostPayload,
  ResultSharePayload,
} from '../shared/types/api';
import { redis, reddit, createServer, context, getServerPort } from '@devvit/web/server';
import type { UiResponse } from '@devvit/web/shared';
import { createPost } from './core/post';

const app = express();
app.use(express.json({ limit: '15mb' }));
app.use(express.urlencoded({ extended: true, limit: '15mb' }));
app.use(express.text({ limit: '15mb' }));

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

// Chat helpers
const CHAT_LAST = (uid: string) => `euclid:chat:last:${uid}`;
const CHAT_RATE_MS = 1000;
const CHAT_MAX_LEN = 140;

// ELO & players (bucketed: hvh = human vs human, hva = human vs AI)
const PLAYERS_KEY = (bucket: 'hvh'|'hva') => `euclid:players:${bucket}`;
const OLD_ELOKEY = (uid: string) => `euclid:elo:${uid}`;                       // legacy (pre-bucket)
const ELOKEY = (uid: string, bucket: 'hvh'|'hva') => `euclid:elo:${bucket}:${uid}`;

const MAX_IDLE_MS = 10 * 60 * 1000; // 10m
const ELO_START = 1200;
const ELO_K = 32;
const SHARE_POST = (id: string) => `euclid:share:post:${id}`;
const SHARE_RATE = (uid: string, kind: string) => `euclid:share:last:${kind}:${uid}`;
const SOLO_LAST = (uid: string) => `euclid:solo:last:${uid}`;
const SHARE_RATE_MS = 10 * 1000;
const SIDEBAR_PLAY_WIDGET_NAME = 'Euclid';
const SIDEBAR_PLAY_WIDGET_DESC = 'Start a fresh Euclid match from the live game post.';

// AI baselines per difficulty
const AI_BASE: Record<'doofus'|'goldfish'|'beginner'|'coffee'|'tenderfoot'|'casual'|'offensive'|'defensive'|'brutal', number> = {
  doofus: 800,
  goldfish: 875,
  beginner: 900,
  coffee: 925,       // Coffee-Deprived
  tenderfoot: 950,
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

/* ===== Daily play counts ===== */
const DAILY_HVH = (date:string) => `euclid:daily:hvh:${date}`;
const DAILY_AI = (diff:string, date:string) => `euclid:daily:ai_${diff}:${date}`;
const diffs = ['doofus','goldfish','beginner','coffee','tenderfoot','casual','offensive','defensive','brutal'] as const;

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
type ChatItem = { id:number; ts:number; sender:string; text:string };
type AiDifficulty = keyof typeof AI_BASE;
type SoloShareRecord = {
  difficulty: AiDifficulty;
  youScore: number;
  botScore: number;
  result: 'win' | 'loss' | 'tie';
  recordedAt: string;
  board: SerializableBoard;
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

  // Chat log
  chat?: { seq:number; items: ChatItem[] };
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
    endedBy: '',
    chat: { seq: 0, items: [] }
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
  try { return JSON.parse(s) as string[]; } catch { return [];
  }
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
async function getRankingRows(bucket: ShareBucket) {
  const ids = await getPlayers(bucket);
  const rowsRaw = await Promise.all(ids.map(async uid => {
    const rec = await getElo(uid, bucket);
    const [name, avatar] = await Promise.all([redis.get(NAMEKEY(uid)), redis.get(AVAKEY(uid))]);
    return {
      userId: uid,
      name: name || '',
      avatar: avatar || '',
      rating: rec.rating,
      games: rec.games,
      wins: rec.wins,
      losses: rec.losses,
      draws: rec.draws
    };
  }));
  const rows = rowsRaw.filter(r => r.name && r.name.toLowerCase() !== 'anonymous');
  rows.sort((a, b) => b.rating - a.rating || b.games - a.games || (a.name || '').localeCompare(b.name || ''));
  return rows;
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
   SERVER-SIDE MOVE/POINTS (still 8x8 for H2H)
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

function formatShareDate(input: string | number | Date = Date.now()) {
  return new Date(input).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}

function difficultyLabel(difficulty: AiDifficulty): string {
  switch (difficulty) {
    case 'brutal': return 'Bot (Brutal)';
    case 'offensive': return 'Bot (Offensive)';
    case 'defensive': return 'Bot (Defensive)';
    case 'doofus': return 'Bot (doofus)';
    case 'goldfish': return 'Bot (Goldfish)';
    case 'beginner': return 'Bot (Beginner)';
    case 'coffee': return 'Bot (Coffee-Deprived)';
    case 'tenderfoot': return 'Bot (Tenderfoot)';
    default: return 'Bot (Casual)';
  }
}

function shareScoringLabel(scoring: SerializableBoard['scoring']) {
  return scoring === 'true' ? 'True Area' : 'Bounding Rectangle';
}

function serializeH2HBoard(board: BoardJSON): SerializableBoard {
  return {
    W: BOARD_W,
    H: BOARD_H,
    scoring: 'bbox',
    winScore: 150,
    m_board: board.m_board,
    m_players: board.m_players,
    m_turn: board.m_turn,
    m_history: board.m_history,
    m_displayed_game_over: board.m_displayed_game_over,
    m_onlyShowLastSquares: board.m_onlyShowLastSquares,
    m_createRandomizedRangeOrder: board.m_createRandomizedRangeOrder,
    m_stopAt150: board.m_stopAt150,
    m_last: board.m_last,
    m_lastPoints: board.m_lastPoints,
    playerNames: board.playerNames || {},
    playerAvatars: board.playerAvatars || {},
    chat: board.chat,
    lastSaved: board.lastSaved,
    createdAt: board.createdAt,
    ended: board.ended,
    endedReason: board.endedReason,
    endedBy: board.endedBy,
  };
}

function parseSharePostDescriptor(input: unknown): SharePostDescriptor | null {
  if (!input || typeof input !== 'object') return null;
  const maybe = input as Partial<SharePostDescriptor>;
  if ((maybe.shareType !== 'rankings' && maybe.shareType !== 'result') || typeof maybe.shareId !== 'string' || !maybe.shareId) {
    return null;
  }
  return { shareType: maybe.shareType, shareId: maybe.shareId };
}

function isSerializableBoard(input: unknown): input is SerializableBoard {
  if (!input || typeof input !== 'object') return false;
  const board = input as Partial<SerializableBoard>;
  return typeof board.W === 'number'
    && typeof board.H === 'number'
    && Array.isArray(board.m_board)
    && Array.isArray(board.m_players)
    && !!board.m_last
    && typeof board.scoring === 'string';
}

async function saveSharePayload(payload: Omit<RankingsSharePayload, 'shareId'> | Omit<ResultSharePayload, 'shareId'>): Promise<SharedPostPayload> {
  const shareId = randomUUID();
  const stored = { ...payload, shareId } as SharedPostPayload;
  await redis.set(SHARE_POST(shareId), JSON.stringify(stored));
  return stored;
}

async function loadSharePayload(shareId: string): Promise<SharedPostPayload | null> {
  const raw = await redis.get(SHARE_POST(shareId));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as SharedPostPayload;
    return parsed?.shareId === shareId ? parsed : null;
  } catch {
    return null;
  }
}

function buildShareFallbackText(payload: SharedPostPayload) {
  if (payload.kind === 'rankings') {
    const rows = payload.rows.slice(0, 5).map((row, index) =>
      `${index + 1}. ${row.name || row.userId} — ${row.rating} (${row.wins}-${row.losses})`
    );
    return [payload.title, payload.subtitle, ...rows].join('\n');
  }

  const board = payload.board;
  return [
    payload.title,
    payload.subtitle,
    payload.headline,
    payload.details,
    `${payload.p1Name} ${board.m_players[0]?.m_score ?? 0} — ${board.m_players[1]?.m_score ?? 0} ${payload.p2Name}`,
    payload.footer,
  ].join('\n');
}

function buildShareSplash(payload: SharedPostPayload) {
  return {
    appDisplayName: 'Euclid',
    backgroundUri: 'snoo.png',
    buttonLabel: 'Open Post',
    heading: payload.title,
    description: payload.kind === 'rankings' ? payload.subtitle : payload.headline,
  };
}

function buildSidebarPlayButton(targetUrl: string) {
  return {
    kind: '',
    text: 'Play New Game!',
    url: targetUrl,
    fillColor: '#16a34a',
    textColor: '#ffffff',
    color: '#14532d',
  };
}

function fullRedditUrl(permalink: string) {
  return new URL(permalink, 'https://www.reddit.com').toString();
}

async function ensureSidebarPlayWidget(postId: string) {
  const metadata = context.metadata;
  if (!metadata) return;

  const subredditName = context.subredditName || await reddit.getCurrentSubredditName();
  if (!subredditName) return;

  const post = await reddit.getPostById(postId);
  if (!post?.permalink) return;

  const targetUrl = fullRedditUrl(post.permalink);
  const widgetsClient = Devvit.redditAPIPlugins.Widgets;
  const widgets = await widgetsClient.GetWidgets({ subreddit: subredditName }, metadata);
  const sidebarOrder = widgets.layout?.sidebar?.order ?? [];
  const sidebarItems = sidebarOrder
    .map((id) => widgets.items[id])
    .filter((item): item is NonNullable<typeof widgets.items[string]> => !!item);
  const existing = sidebarItems.find((item) => item.kind === 'button' && item.shortName === SIDEBAR_PLAY_WIDGET_NAME);
  const desiredButton = buildSidebarPlayButton(targetUrl);
  const desiredStyles = { backgroundColor: '#0b1220', headerColor: '#16a34a' };
  const currentButton = existing?.buttons?.[0];
  const currentUrl = currentButton?.url || currentButton?.linkUrl || '';
  const needsUpdate = !existing
    || existing.description !== SIDEBAR_PLAY_WIDGET_DESC
    || currentButton?.text !== desiredButton.text
    || currentButton?.fillColor !== desiredButton.fillColor
    || currentButton?.textColor !== desiredButton.textColor
    || currentUrl !== targetUrl;

  let widgetId = existing?.id;
  if (!existing) {
    const created = await widgetsClient.AddButtonWidget({
      subreddit: subredditName,
      shortName: SIDEBAR_PLAY_WIDGET_NAME,
      description: SIDEBAR_PLAY_WIDGET_DESC,
      buttons: [desiredButton],
      styles: desiredStyles,
    }, metadata);
    widgetId = created.id;
    slog('[SIDEBAR] created play widget', { subredditName, postId, widgetId, targetUrl });
  } else if (needsUpdate) {
    const updated = await widgetsClient.UpdateButtonWidget({
      subreddit: subredditName,
      id: existing.id,
      shortName: SIDEBAR_PLAY_WIDGET_NAME,
      description: SIDEBAR_PLAY_WIDGET_DESC,
      buttons: [desiredButton],
      styles: desiredStyles,
    }, metadata);
    widgetId = updated.id;
    slog('[SIDEBAR] updated play widget', { subredditName, postId, widgetId, targetUrl });
  }

  if (widgetId && sidebarOrder[0] !== widgetId) {
    const reordered = [widgetId, ...sidebarOrder.filter((id) => id !== widgetId)];
    await widgetsClient.OrderWidgets({ subreddit: subredditName, order: reordered }, metadata);
    slog('[SIDEBAR] moved play widget to top', { subredditName, widgetId });
  }
}

async function createCustomSharePost(title: string, payload: SharedPostPayload) {
  const subredditName = context.subredditName || await reddit.getCurrentSubredditName();
  const descriptor: SharePostDescriptor = { shareType: payload.kind, shareId: payload.shareId };
  const fallbackText = buildShareFallbackText(payload);
  const baseOptions = {
    subredditName,
    title,
    entry: 'game' as const,
    postData: descriptor,
    textFallback: { text: fallbackText },
    splash: buildShareSplash(payload),
  };

  try {
    const post = await reddit.submitCustomPost({
      ...baseOptions,
      runAs: 'USER',
      userGeneratedContent: { text: fallbackText },
    });
    return { post, subredditName, sharedAs: 'USER' as const };
  } catch (userError: any) {
    slog('[SHARE] user-auth custom post failed, falling back to app account', { title, error: userError?.message || String(userError) });
    const post = await reddit.submitCustomPost({
      ...baseOptions,
      runAs: 'APP',
    });
    return { post, subredditName, sharedAs: 'APP' as const };
  }
}

async function enforceShareRateLimit(uid: string, kind: string) {
  const key = SHARE_RATE(uid, kind);
  const now = Date.now();
  const last = parseInt((await redis.get(key)) || '0', 10);
  if (last && now - last < SHARE_RATE_MS) {
    const retryAfterMs = SHARE_RATE_MS - (now - last);
    const error = new Error('Please wait a few seconds before sharing again.');
    (error as Error & { retryAfterMs?: number }).retryAfterMs = retryAfterMs;
    throw error;
  }
  await redis.set(key, String(now));
  await redis.expire(key, 60);
}

function getBoardWinner(board: BoardJSON) {
  const u1 = board.m_players?.[0]?.userId || '';
  const u2 = board.m_players?.[1]?.userId || '';
  const s1 = board.m_players?.[0]?.m_score ?? 0;
  const s2 = board.m_players?.[1]?.m_score ?? 0;
  if ((board.endedReason === 'player_left' || board.endedReason === 'opponent_left') && board.endedBy) {
    const winnerUid = board.endedBy === u1 ? u2 : board.endedBy === u2 ? u1 : '';
    const loserUid = board.endedBy === u1 ? u1 : board.endedBy === u2 ? u2 : '';
    return { winnerUid, loserUid, tie: !winnerUid, byForfeit: !!winnerUid };
  }
  if (s1 === s2) return { winnerUid: '', loserUid: '', tie: true, byForfeit: false };
  return {
    winnerUid: s1 > s2 ? u1 : u2,
    loserUid: s1 > s2 ? u2 : u1,
    tie: false,
    byForfeit: false
  };
}

function normalizeShareError(error: any) {
  const message = error?.message || String(error);
  if (/RATELIMIT/i.test(message)) {
    const normalized = new Error('Rate limited by Reddit. Please wait a few seconds before sharing again.');
    (normalized as Error & { statusCode?: number }).statusCode = 429;
    return normalized;
  }
  return error instanceof Error ? error : new Error(message);
}

/* =========================
   BASIC ROUTES
   ========================= */
router.get<{ postId: string }, InitResponse | { status: string; message: string }>(
  '/api/init',
  async (_req, res): Promise<void> => {
    const { postId, postData } = context;
    if (!postId) return res.status(400).json({ status: 'error', message: 'postId is required but missing from context' });
    try {
      const username = (await reddit.getCurrentUsername()) ?? '';
      const appVersion = context.appVersion || 'unknown';
      // metrics: app start
      const uid = context.userId || '';
      await addUserToSet('app_start_users', uid);
      await incrCount('app_start_count', 1);

      const descriptor = parseSharePostDescriptor(postData);
      if (descriptor) {
        const share = await loadSharePayload(descriptor.shareId);
        if (!share || share.kind !== descriptor.shareType) {
          return res.status(410).json({ status: 'error', message: 'This shared Euclid post is no longer available.' });
        }
        return res.json({ type: 'share', postId, username, appVersion, share });
      }

      void ensureSidebarPlayWidget(postId).catch((error) => {
        console.error('[SIDEBAR] failed to ensure play widget', error);
      });

      const count = await redis.get('count');
      res.json({ type: 'init', postId, count: count ? parseInt(count) : 0, username, appVersion });
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

    // remember caller's name + avatar (skip anonymous names)
    try {
      const nm = await reddit.getCurrentUsername();
      if (nm && nm.toLowerCase() !== 'anonymous') await redis.set(NAMEKEY(uid), nm);
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
      if (n1 && n1.toLowerCase()!=='anonymous') names[user1] = n1;
      if (n2 && n2.toLowerCase()!=='anonymous') names[user2] = n2;
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
      if (myName && myName.toLowerCase()!=='anonymous') board.playerNames[uid] = board.playerNames[uid] || myName;
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

        // NEW: Apply ELO penalty for leaver
        const winnerUid = uid || (meIsP1 ? u1 : u2);
        const leaverUid = oppId;
        const [winnerRec, leaverRec] = await Promise.all([getElo(winnerUid, 'hvh'), getElo(leaverUid, 'hvh')]);
        const [newWinner, newLeaver] = updateEloPair(winnerRec, leaverRec, 1);  // 1 for winner (leaver loses)
        await Promise.all([setElo(winnerUid, 'hvh', newWinner), setElo(leaverUid, 'hvh', newLeaver)]);
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

    // If board is now full and nobody hit 150:
    if (!gameEnded) {
      const anyEmpty = serverBoard.m_board.some(v=>v===0);
      if (!anyEmpty) {
        gameEnded = true;
        serverBoard.ended = true;
        // Not a tie if scores differ
        serverBoard.endedReason = (s1===s2) ? 'tie' : 'game_over';
        if (s1!==s2){
          winnerUid = s1 > s2 ? serverBoard.m_players[0].userId : serverBoard.m_players[1].userId;
          loserUid  = s1 > s2 ? serverBoard.m_players[1].userId : s2 > s1 ? serverBoard.m_players[0].userId : '';
        }
      }
    }

    await saveBoard(gameId, serverBoard);

    if (gameEnded) {
      if (serverBoard.endedReason === 'game_over' && winnerUid && loserUid) {
        const [aRec, bRec] = await Promise.all([getElo(winnerUid, 'hvh'), getElo(loserUid, 'hvh')]);
        const [na, nb] = updateEloPair(aRec, bRec, 1);
        await Promise.all([setElo(winnerUid, 'hvh', na), setElo(loserUid, 'hvh', nb)]);
        const date = new Date().toISOString().slice(0,10);
        await incrCount(DAILY_HVH(date), 1);
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

          // NEW: Apply ELO penalty for leaver
          const leaverUid = uid;
          const winnerUid = uid === u1 ? u2 : u1;
          const [winnerRec, leaverRec] = await Promise.all([getElo(winnerUid, 'hvh'), getElo(leaverUid, 'hvh')]);
          const [newWinner, newLeaver] = updateEloPair(winnerRec, leaverRec, 1);  // 1 for winner (leaver loses)
          await Promise.all([setElo(winnerUid, 'hvh', newWinner), setElo(leaverUid, 'hvh', newLeaver)]);
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

    const { difficulty, youScore, botScore, board } = (req.body || {}) as {
      difficulty: AiDifficulty;
      youScore: number;
      botScore: number;
      board?: SerializableBoard;
    };
    if (!difficulty || !(difficulty in AI_BASE)) return res.status(400).json({ status: 'error', message: 'invalid difficulty' });
    if (!isSerializableBoard(board)) return res.status(400).json({ status: 'error', message: 'final board is required' });
    const ys = Number(youScore) || 0;
    const bs = Number(botScore) || 0;

    const result: 1|0|0.5 = ys>bs ? 1 : ys<bs ? 0 : 0.5;
    const me = await getElo(uid, 'hva');
    const bot: EloRecord = { rating: AI_BASE[difficulty], games: 0, wins: 0, losses: 0, draws: 0 };
    const [meAfter] = updateEloPair(me, bot, result);
    await setElo(uid, 'hva', meAfter);
    await redis.set(SOLO_LAST(uid), JSON.stringify({
      difficulty,
      youScore: ys,
      botScore: bs,
      result: result === 1 ? 'win' : result === 0 ? 'loss' : 'tie',
      recordedAt: nowISO(),
      board,
    } satisfies SoloShareRecord));
    await redis.expire(SOLO_LAST(uid), 7 * 24 * 60 * 60);

    // metrics
    await addUserToSet('ai_completed_users', uid);
    await incrCount('ai_completed_count', 1);
    await incrCount(`ai_diff_${difficulty}_count`, 1);
    const date = new Date().toISOString().slice(0,10);
    await incrCount(DAILY_AI(difficulty, date), 1);

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
   Rankings (both buckets) — exclude anonymous entries
   ========================= */
router.get('/api/rankings', async (_req, res) => {
  try {
    const [hvh, hva] = await Promise.all([getRankingRows('hvh'), getRankingRows('hva')]);
    res.json({ hvh, hva });
  } catch (e:any) {
    console.error('[RANKINGS] error', e);
    res.status(500).json({ status: 'error', message: e?.message || String(e) });
  }
});

/* =========================
   Share custom posts to Reddit
   ========================= */

router.post('/api/share/rankings', async (req, res) => {
  try {
    const uid = context.userId;
    if (!uid) return res.status(401).json({ ok: false, message: 'userId missing' });

    const { bucket } = (req.body || {}) as { bucket?: ShareBucket };
    if (bucket !== 'hvh' && bucket !== 'hva') return res.status(400).json({ ok: false, message: 'invalid rankings bucket' });

    await enforceShareRateLimit(uid, `rankings:${bucket}`);
    const rows = await getRankingRows(bucket);
    if (rows.length === 0) return res.status(409).json({ ok: false, message: 'No rankings are available to share yet.' });

    const sharedAt = nowISO();
    const subredditName = context.subredditName || await reddit.getCurrentSubredditName();
    const title = bucket === 'hvh'
      ? `Euclid Rankings — Human vs Human — ${formatShareDate()}`
      : `Euclid Rankings — Human vs AI — ${formatShareDate()}`;
    const payload = await saveSharePayload({
      kind: 'rankings',
      subredditName,
      sharedAt,
      bucket,
      title: 'Euclid Rankings',
      subtitle: `${bucket === 'hvh' ? 'Human vs Human' : 'Human vs AI'} • ${formatShareDate(sharedAt)}`,
      rows: rows.slice(0, 10),
    });
    const { post, sharedAs } = await createCustomSharePost(title, payload);
    slog('[SHARE] rankings posted', { uid, bucket, postId: post.id, sharedAs });
    return res.json({
      ok: true,
      message: `Rankings shared to r/${subredditName}${sharedAs === 'APP' ? ' via the app account.' : '.'}`,
      postId: post.id,
      permalink: post.permalink,
      sharedAs
    });
  } catch (e:any) {
    const normalized = normalizeShareError(e);
    const retryAfterMs = (e as Error & { retryAfterMs?: number }).retryAfterMs;
    if (retryAfterMs) {
      return res.status(429).json({ ok: false, message: e.message, retryAfter: retryAfterMs });
    }
    if ((normalized as Error & { statusCode?: number }).statusCode === 429) {
      return res.status(429).json({ ok: false, message: normalized.message });
    }
    console.error('[SHARE] rankings error', normalized);
    res.status(500).json({ ok: false, message: normalized.message });
  }
});

router.post('/api/share/h2h-result', async (req, res) => {
  try {
    const uid = context.userId;
    if (!uid) return res.status(401).json({ ok: false, message: 'userId missing' });

    const gid = await redis.get(USERMAP(uid));
    if (!gid) return res.status(400).json({ ok: false, message: 'No finished game found to share.' });

    const board = await loadBoard(gid);
    if (!board) return res.status(404).json({ ok: false, message: 'Game not found' });
    if (!board.ended) return res.status(409).json({ ok: false, message: 'Game is still in progress.' });

    const { winnerUid, tie, byForfeit } = getBoardWinner(board);
    if (tie || !winnerUid) return res.status(409).json({ ok: false, message: 'Only a winning result can be shared.' });
    if (winnerUid !== uid) return res.status(403).json({ ok: false, message: 'Only the winner can share this result.' });

    await enforceShareRateLimit(uid, 'h2h');

    const u1 = board.m_players?.[0]?.userId || '';
    const u2 = board.m_players?.[1]?.userId || '';
    const names = board.playerNames || {};
    const p1Name = names[u1] || 'Player 1';
    const p2Name = names[u2] || 'Player 2';
    const winnerName = winnerUid === u1 ? p1Name : p2Name;
    const loserName = winnerUid === u1 ? p2Name : p1Name;
    const s1 = board.m_players?.[0]?.m_score ?? 0;
    const s2 = board.m_players?.[1]?.m_score ?? 0;
    const sharedAt = nowISO();
    const subredditName = context.subredditName || await reddit.getCurrentSubredditName();
    const title = byForfeit
      ? `Euclid Result — ${winnerName} defeated ${loserName} by forfeit — ${formatShareDate()}`
      : `Euclid Result — ${winnerName} defeated ${loserName} ${s1}-${s2} — ${formatShareDate()}`;
    const boardForShare = serializeH2HBoard(board);
    const payload = await saveSharePayload({
      kind: 'result',
      subredditName,
      sharedAt,
      mode: 'h2h',
      title: 'Euclid Result',
      subtitle: `Human vs Human • ${formatShareDate(sharedAt)}`,
      headline: byForfeit ? `${winnerName} wins by forfeit` : `${winnerName} defeats ${loserName}`,
      details: byForfeit
        ? `${winnerName} advanced after ${loserName} left the match.`
        : `${s1}-${s2} • ${shareScoringLabel(boardForShare.scoring)} scoring • ${boardForShare.W}x${boardForShare.H} board`,
      footer: `First to ${boardForShare.winScore} points • Shared from r/${subredditName}`,
      board: boardForShare,
      p1Name,
      p2Name,
      p1Avatar: board.playerAvatars?.[u1],
      p2Avatar: board.playerAvatars?.[u2],
      winnerSide: winnerUid === u1 ? 1 : 2,
    });
    const { post, sharedAs } = await createCustomSharePost(title, payload);
    slog('[SHARE] h2h result posted', { uid, gid, postId: post.id, sharedAs });
    return res.json({
      ok: true,
      message: `Winning result shared to r/${subredditName}${sharedAs === 'APP' ? ' via the app account.' : '.'}`,
      postId: post.id,
      permalink: post.permalink,
      sharedAs
    });
  } catch (e:any) {
    const normalized = normalizeShareError(e);
    const retryAfterMs = (e as Error & { retryAfterMs?: number }).retryAfterMs;
    if (retryAfterMs) {
      return res.status(429).json({ ok: false, message: e.message, retryAfter: retryAfterMs });
    }
    if ((normalized as Error & { statusCode?: number }).statusCode === 429) {
      return res.status(429).json({ ok: false, message: normalized.message });
    }
    console.error('[SHARE] h2h result error', normalized);
    res.status(500).json({ ok: false, message: normalized.message });
  }
});

router.post('/api/share/ai-result', async (req, res) => {
  try {
    const uid = context.userId;
    if (!uid) return res.status(401).json({ ok: false, message: 'userId missing' });

    const recordRaw = await redis.get(SOLO_LAST(uid));
    if (!recordRaw) return res.status(409).json({ ok: false, message: 'No recent AI result found to share.' });

    const record = JSON.parse(recordRaw) as SoloShareRecord;
    if (record.result !== 'win') return res.status(409).json({ ok: false, message: 'Only a winning AI result can be shared.' });

    await enforceShareRateLimit(uid, 'ai');

    const username = (await reddit.getCurrentUsername()) || 'Player';
    const avatar = await redis.get(AVAKEY(uid));
    const botName = difficultyLabel(record.difficulty);
    const subredditName = context.subredditName || await reddit.getCurrentSubredditName();
    const title = `Euclid Result — ${username} defeated ${botName} ${record.youScore}-${record.botScore} — ${formatShareDate(record.recordedAt)}`;
    const payload = await saveSharePayload({
      kind: 'result',
      subredditName,
      sharedAt: record.recordedAt,
      mode: 'ai',
      title: 'Euclid Result',
      subtitle: `AI victory • ${formatShareDate(record.recordedAt)}`,
      headline: `${username} defeats ${botName}`,
      details: `${record.youScore}-${record.botScore} • ${shareScoringLabel(record.board.scoring)} scoring • ${record.board.W}x${record.board.H} board`,
      footer: `First to ${record.board.winScore} points • Shared from r/${subredditName}`,
      board: record.board,
      p1Name: username,
      p2Name: botName,
      p1Avatar: avatar || undefined,
      winnerSide: 1,
    });
    const { post, sharedAs } = await createCustomSharePost(title, payload);
    slog('[SHARE] ai result posted', { uid, postId: post.id, sharedAs, difficulty: record.difficulty });
    return res.json({
      ok: true,
      message: `AI victory shared to r/${subredditName}${sharedAs === 'APP' ? ' via the app account.' : '.'}`,
      postId: post.id,
      permalink: post.permalink,
      sharedAs
    });
  } catch (e:any) {
    const normalized = normalizeShareError(e);
    const retryAfterMs = (e as Error & { retryAfterMs?: number }).retryAfterMs;
    if (retryAfterMs) {
      return res.status(429).json({ ok: false, message: e.message, retryAfter: retryAfterMs });
    }
    if ((normalized as Error & { statusCode?: number }).statusCode === 429) {
      return res.status(429).json({ ok: false, message: normalized.message });
    }
    console.error('[SHARE] ai result error', normalized);
    res.status(500).json({ ok: false, message: normalized.message });
  }
});

router.post('/api/rankings/share', async (req, res) => {
  req.url = '/api/share/rankings';
  router.handle(req, res);
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
      doofus: await getCount('ai_diff_doofus_count'),
      goldfish: await getCount('ai_diff_goldfish_count'),
      beginner: await getCount('ai_diff_beginner_count'),
      coffee: await getCount('ai_diff_coffee_count'),
      tenderfoot: await getCount('ai_diff_tenderfoot_count'),
      casual: await getCount('ai_diff_casual_count'),
      offensive: await getCount('ai_diff_offensive_count'),
      defensive: await getCount('ai_diff_defensive_count'),
      brutal: await getCount('ai_diff_brutal_count'),
    };

    // Daily for past 7 days
    const daily = { dates: [], hvh: [], ai: {} as Record<string, number[]> };
    diffs.forEach(d => daily.ai[d] = []);
    for (let i = 0; i < 7; i++) {
      const d = new Date(Date.now() - i * 86400000);
      const date = d.toISOString().slice(0,10);
      daily.dates.unshift(date);
      daily.hvh.unshift(await getCount(DAILY_HVH(date)));
      for (const diff of diffs) {
        daily.ai[diff].unshift(await getCount(DAILY_AI(diff, date)));
      }
    }

    const activeGames = (await getActiveGames()).length;
    const rankedPlayers = { hvh: (await getPlayers('hvh')).length, hva: (await getPlayers('hva')).length };

    res.json({ uniques, counts, computed, aiDiffs, activeGames, rankedPlayers, daily });
  } catch (e:any) {
    console.error('[ADMIN] metrics error', e);
    res.status(500).json({ status:'error', message:e?.message||String(e) });
  }
});

/* =========================
   H2H Chat
   ========================= */
router.post('/api/h2h/chat', async (req, res) => {
  try {
    const uid = context.userId;
    if (!uid) return res.status(401).json({ status:'error', message:'userId missing' });

    const { gameId, text } = (req.body||{}) as { gameId:string; text:string };
    if (!gameId || typeof text !== 'string') return res.status(400).json({ status:'error', message:'gameId and text required' });

    const gidMapped = await redis.get(USERMAP(uid));
    if (gidMapped !== gameId) return res.status(403).json({ status:'error', message:'not mapped to this game' });

    const board = await loadBoard(gameId);
    if (!board) return res.status(404).json({ status:'error', message:'game not found' });
    if (board.ended) return res.status(409).json({ status:'error', message:'game ended' });

    const trimmed = text.replace(/\r?\n/g, ' ').trim().slice(0, CHAT_MAX_LEN);
    if (!trimmed) return res.json({ ok:true, ignored:true });

    const lastStr = await redis.get(CHAT_LAST(uid));
    const now = Date.now();
    const last = lastStr ? parseInt(lastStr,10) : 0;
    if (now - last < CHAT_RATE_MS) {
      return res.status(429).json({ status:'error', message:'Too fast' });
    }

    board.chat = board.chat || { seq:0, items: [] };
    const id = (board.chat.seq||0) + 1;
    board.chat.seq = id;
    board.chat.items.push({ id, ts: now, sender: uid, text: trimmed });
    if (board.chat.items.length > 100) board.chat.items = board.chat.items.slice(-100);

    await Promise.all([
      saveBoard(gameId, board),
      redis.set(CHAT_LAST(uid), String(now))
    ]);

    return res.json({ ok:true, id });
  } catch (e:any) {
    console.error('[H2H] chat error', e);
    res.status(500).json({ status:'error', message:e?.message||String(e) });
  }
});

router.post('/internal/menu/create-post', async (_req, res) => {
  try {
    const post = await createPost();
    slog('[MENU] created game post', { postId: post.id, postUrl: post.url });

    const response: UiResponse = {
      navigateTo: post.url,
      showToast: {
        text: 'Euclid post created',
        appearance: 'success',
      },
    };
    return res.json(response);
  } catch (e: any) {
    console.error('[MENU] Error creating post', e);
    const response: UiResponse = {
      showToast: 'Failed to create game post',
    };
    return res.status(200).json(response);
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
