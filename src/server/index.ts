import { UserAvatars } from "./user-avatars";
import { userAvatarRouter } from "./user-avatar-routes";
import { EMPTY_CHALLENGE_SPOTLIGHTS } from "../shared/challenge-spotlights";
import { challengeRouter } from "./challenge-routes";
import express, { type Response } from "express";
import { randomUUID } from "node:crypto";
import type {
  CanonicalBoardSnapshot,
  H2HLeaveRequest,
  H2HLiveGamesResponse,
  H2HMappingResponse,
  H2HMoveRejectionReason,
  H2HMoveRequest,
  H2HRematchRequest,
  H2HShareRequest,
  H2HStateResponse,
  InitResponse,
  RatingRecord,
  RankingsSharePayload,
  ResultSharePayload,
  SerializableBoard,
  ShareBucket,
  SharePostDescriptor,
  SharedPostPayload,
  SoloAbandonRequest,
  SoloMoveRequest,
  SoloShareRequest,
  UserStatsResponse,
} from "../shared/types/api";
import { type AiDifficulty } from "../shared/game/rules";
import {
  redis,
  reddit,
  createServer,
  context,
  getServerPort,
} from "@devvit/web/server";
import type { UiResponse } from "@devvit/web/shared";
import { createPost } from "./core/post";
import { H2HDomainError } from "./h2h";
import { resolveH2HPresence } from "./h2h-presence";
import { H2HStore, H2HStoreError, type H2HSettlementEvent } from "./h2h-store";
import { H2HSettlementService } from "./h2h-settlement";
import { RedisCasConflictExhaustedError } from "./redis-cas";
import { SoloDomainError, rankedSoloSessionMetadata } from "./solo";
import { SoloStore, SoloStoreError } from "./solo-store";
import { RequestLimitError, reserveShareCooldown } from "./request-limits";

const app = express();
app.use(express.json({ limit: "15mb" }));
app.use(express.urlencoded({ extended: true, limit: "15mb" }));
app.use(express.text({ limit: "15mb" }));

const router = express.Router();
const h2hStore = new H2HStore(redis);
const h2hSettlements = new H2HSettlementService(redis);
const soloStore = new SoloStore(redis);

async function challengeModerator(): Promise<string | null> {
  const userId = context.userId;
  const subredditName = context.subredditName;
  if (!userId || !subredditName) return null;
  const username = await reddit.getCurrentUsername();
  if (!username) return null;
  const moderators = await reddit
    .getModerators({ subredditName, username, limit: 1 })
    .all();
  return moderators.some(
    (m) => m.username.toLowerCase() === username.toLowerCase(),
  )
    ? userId
    : null;
}
router.use("/api/challenge-lab", challengeRouter(redis, challengeModerator));

/* =========================
   UTIL / CONSTANTS
   ========================= */
const nowISO = () => new Date().toISOString();
const slog = (...values: unknown[]) =>
  console.log(`[EUCLID ${nowISO()}]`, ...values);

function errorMessage(error: unknown, fallback = "Unknown error"): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string" && error) return error;
  return fallback;
}

async function settleH2HEventBestEffort(
  event: H2HSettlementEvent | null,
  source: string,
): Promise<void> {
  if (!event) return;
  try {
    const result = await h2hSettlements.settle(event);
    if (result.status === "not_pending") {
      slog("[H2H] settlement event was no longer pending", {
        source,
        eventId: event.eventId,
      });
    }
  } catch (error: unknown) {
    // The event was committed to the durable outbox with the game result and
    // will be retried by a later bounded drain.
    console.error("[H2H] settlement deferred", {
      source,
      eventId: event.eventId,
      error: errorMessage(error),
    });
  }
}

async function drainH2HSettlementsBestEffort(
  source: string,
  limit = 8,
): Promise<void> {
  try {
    const result = await h2hSettlements.drainPending(limit);
    if (result.failedEventIds.length > 0) {
      slog("[H2H] settlement drain deferred events", {
        source,
        eventIds: result.failedEventIds,
        remaining: result.remaining,
      });
    }
  } catch (error: unknown) {
    console.error("[H2H] settlement drain deferred", {
      source,
      error: errorMessage(error),
    });
  }
}

function parseStringArray(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) &&
      parsed.every((value) => typeof value === "string")
      ? parsed
      : [];
  } catch {
    return [];
  }
}

const NAMEKEY = (uid: string) => `euclid:name:${uid}`;
const AVAKEY = (uid: string) => `euclid:avatar:${uid}`;
const userAvatars = new UserAvatars(redis, (username) =>
  reddit.getSnoovatarUrl(username),
);

// Legacy/H2H Elo. Trustworthy solo Ranked data uses the versioned SoloStore.
const PLAYERS_KEY = () => "euclid:players:hvh";
const OLD_ELOKEY = (uid: string) => `euclid:elo:${uid}`; // legacy (pre-bucket)
const ELOKEY = (uid: string) => `euclid:elo:hvh:${uid}`;

const SHARE_POST = (id: string) => `euclid:share:post:${id}`;
const SHARE_RATE = (uid: string, kind: string) =>
  `euclid:share:last:${kind}:${uid}`;
const SHARE_RATE_MS = 10 * 1000;
const HUMAN_VS_EUCLID_LABEL = "Redditor vs Euclid";
const HUMAN_VS_HUMAN_LABEL = "Redditor vs Redditor";
const LEADERBOARD_LABEL = "Leaderboard";
const RANKED_SOLO_METADATA = rankedSoloSessionMetadata();

/* ===== Metrics helpers ===== */
const MSET = (name: string) => `euclid:metric:set:${name}`;
const MCOUNT = (name: string) => `euclid:metric:count:${name}`;

async function addUserToSet(name: string, uid: string | undefined | null) {
  if (!uid) return;
  const key = MSET(name);
  const arr = parseStringArray(await redis.get(key));
  if (!arr.includes(uid)) {
    arr.push(uid);
    await redis.set(key, JSON.stringify(arr));
  }
}
async function scard(name: string): Promise<number> {
  return parseStringArray(await redis.get(MSET(name))).length;
}
async function sget(name: string): Promise<Set<string>> {
  return new Set(parseStringArray(await redis.get(MSET(name))));
}
async function incrCount(name: string, n = 1): Promise<number> {
  const key = MCOUNT(name);
  const v = parseInt((await redis.get(key)) || "0", 10) + n;
  await redis.set(key, String(v));
  return v;
}
async function getCount(name: string): Promise<number> {
  return parseInt((await redis.get(MCOUNT(name))) || "0", 10);
}

/* ===== Daily play counts ===== */
const DAILY_HVH = (date: string) => `euclid:daily:hvh:${date}`;
const DAILY_AI = (diff: string, date: string) =>
  `euclid:daily:ai_${diff}:${date}`;
const diffs = [
  "doofus",
  "goldfish",
  "beginner",
  "coffee",
  "tenderfoot",
  "casual",
  "offensive",
  "defensive",
  "brutal",
] as const;

/* =========================
   TYPES
   ========================= */
type ShareError = Error & {
  retryAfterMs?: number;
  statusCode?: number;
};

/* =========================
   HELPERS
   ========================= */
async function refreshCurrentUserProfile(
  uid: string,
): Promise<{ name: string; avatar: string }> {
  const username = (await reddit.getCurrentUsername()) ?? "";
  const name = username.toLowerCase() === "anonymous" ? "" : username;
  if (name) await redis.set(NAMEKEY(uid), name);

  let avatar = (await redis.get(AVAKEY(uid))) ?? "";
  try {
    if (name) {
      avatar = (await userAvatars.get(name)) ?? "";
      await redis.set(AVAKEY(uid), avatar);
    }
  } catch (error: unknown) {
    slog("[PROFILE] unable to refresh avatar", {
      uid,
      error: errorMessage(error),
    });
  }

  return { name, avatar };
}

type H2HStateWithBoard = {
  board: CanonicalBoardSnapshot;
};

async function enrichH2HNames(
  playerIds: readonly string[],
  storedNames: Record<string, string> = {},
): Promise<Record<string, string>> {
  const cachedNames = await Promise.all(
    playerIds.map((playerId) => redis.get(NAMEKEY(playerId))),
  );
  const names = { ...storedNames };
  for (const [index, playerId] of playerIds.entries()) {
    const name = cachedNames[index];
    if (name && name.toLowerCase() !== "anonymous") names[playerId] = name;
  }
  return names;
}

async function enrichH2HProfiles<T extends H2HStateWithBoard>(
  state: T,
): Promise<T> {
  const [firstPlayer, secondPlayer] = state.board.m_players;
  const playerIds = [firstPlayer.userId, secondPlayer.userId] as const;
  const [names, firstAvatar, secondAvatar] = await Promise.all([
    enrichH2HNames(playerIds, state.board.playerNames),
    redis.get(AVAKEY(playerIds[0])),
    redis.get(AVAKEY(playerIds[1])),
  ]);
  const avatars = { ...(state.board.playerAvatars ?? {}) };
  const cachedAvatars = [firstAvatar, secondAvatar];

  for (let index = 0; index < playerIds.length; index++) {
    const playerId = playerIds[index];
    const avatar = cachedAvatars[index];
    if (playerId && avatar) avatars[playerId] = avatar;
  }

  return {
    ...state,
    board: {
      ...state.board,
      playerNames: names,
      playerAvatars: avatars,
    },
  };
}

function h2hErrorStatus(error: unknown): number {
  if (error instanceof RequestLimitError) return 429;
  if (error instanceof H2HDomainError) {
    switch (error.code) {
      case "invalid_request":
      case "out_of_range":
        return 400;
      case "not_participant":
        return 403;
      case "invalid_board":
        return 410;
      case "stale_revision":
      case "not_your_turn":
      case "cell_occupied":
      case "game_ended":
        return 409;
    }
  }
  if (error instanceof H2HStoreError) {
    switch (error.code) {
      case "invalid_identifier":
        return 400;
      case "not_mapped":
        return 403;
      case "game_not_found":
        return 404;
      case "mapping_conflict":
      case "result_conflict":
      case "game_live":
      case "rematch_unavailable":
        return 409;
      case "chat_rate_limited":
        return 429;
      case "dynamic_conflict":
        return 503;
    }
  }
  if (error instanceof RedisCasConflictExhaustedError) return 503;
  return 500;
}

function isMoveRejectionCode(
  code: H2HDomainError["code"],
): code is H2HMoveRejectionReason {
  return (
    code === "stale_revision" ||
    code === "not_your_turn" ||
    code === "out_of_range" ||
    code === "cell_occupied" ||
    code === "game_ended"
  );
}

async function sendH2HError(
  res: Response,
  operation: string,
  error: unknown,
  options: { move?: boolean } = {},
) {
  console.error(`[H2H] ${operation} error`, error);
  const status = h2hErrorStatus(error);
  const retryAfterMs =
    error instanceof H2HStoreError || error instanceof RequestLimitError
      ? error.retryAfterMs
      : undefined;
  if (retryAfterMs !== undefined) {
    res.setHeader("Retry-After", String(Math.ceil(retryAfterMs / 1_000)));
  }
  if (error instanceof H2HDomainError && error.state) {
    const state = await enrichH2HProfiles(error.state);
    const canonicalError = {
      ...state,
      ok: false,
      reason: error.code,
      message: error.message,
    };
    if (options.move && isMoveRejectionCode(error.code)) {
      return res.status(status).json({
        ...canonicalError,
        accepted: false,
        pointsScored: 0,
        completedSquares: [],
      });
    }
    return res.status(status).json(canonicalError);
  }
  const message =
    status === 500
      ? "The multiplayer request could not be completed."
      : errorMessage(error, "The multiplayer request could not be completed.");
  return res.status(status).json({
    ok: false,
    message,
    ...(retryAfterMs !== undefined ? { retryAfterMs } : {}),
  });
}

function soloErrorStatus(error: unknown): number {
  if (error instanceof RequestLimitError) return 429;
  if (error instanceof SoloDomainError) {
    return error.code === "invalid_request" ? 400 : 410;
  }
  if (error instanceof SoloStoreError) {
    switch (error.code) {
      case "invalid_identifier":
        return 400;
      case "not_owner":
        return 403;
      case "game_not_found":
      case "result_not_found":
        return 404;
      case "command_conflict":
      case "result_not_shareable":
      case "share_conflict":
        return 409;
      case "dynamic_conflict":
        return 503;
      case "mapping_corrupt":
      case "data_corrupt":
        return 500;
    }
  }
  if (error instanceof RedisCasConflictExhaustedError) return 503;
  return 500;
}

function sendSoloError(
  res: Response,
  operation: string,
  error: unknown,
): Response {
  console.error(`[SOLO] ${operation} error`, error);
  const status = soloErrorStatus(error);
  if (error instanceof RequestLimitError) {
    res.setHeader("Retry-After", Math.ceil(error.retryAfterMs / 1_000));
  }
  return res.status(status).json({
    ok: false,
    ...(error instanceof RequestLimitError
      ? { retryAfter: error.retryAfterMs }
      : {}),
    message:
      status === 500
        ? "The solo request could not be completed."
        : errorMessage(error, "The solo request could not be completed."),
  });
}

// Human-vs-human Elo records; Ranked solo ratings are owned by SoloStore.
const DEFAULT_ELO: RatingRecord = {
  rating: 1_200,
  games: 0,
  wins: 0,
  losses: 0,
  draws: 0,
};

function parseEloRecord(raw: string | null | undefined): RatingRecord | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    const record = parsed as Partial<RatingRecord>;
    return typeof record.rating === "number" &&
      typeof record.games === "number" &&
      typeof record.wins === "number" &&
      typeof record.losses === "number" &&
      typeof record.draws === "number"
      ? {
          rating: record.rating,
          games: record.games,
          wins: record.wins,
          losses: record.losses,
          draws: record.draws,
        }
      : null;
  } catch {
    return null;
  }
}

async function getPlayers(): Promise<string[]> {
  return parseStringArray(await redis.get(PLAYERS_KEY()));
}
async function getElo(uid: string): Promise<RatingRecord> {
  const current = parseEloRecord(await redis.get(ELOKEY(uid)));
  if (current) return current;

  const legacy = await redis.get(OLD_ELOKEY(uid));
  if (legacy) {
    const parsed = parseEloRecord(legacy);
    if (parsed) return parsed;
    slog("[ELO] ignored malformed legacy record", { uid });
  }

  return { ...DEFAULT_ELO };
}
async function getRankingRows(bucket: ShareBucket) {
  if (bucket === "hva") return soloStore.getRankedRows();

  const ids = await getPlayers();
  const rowsRaw = await Promise.all(
    ids.map(async (uid) => {
      const rec = await getElo(uid);
      const [name, avatar] = await Promise.all([
        redis.get(NAMEKEY(uid)),
        redis.get(AVAKEY(uid)),
      ]);
      return {
        userId: uid,
        name: name || "",
        avatar: avatar || "",
        rating: rec.rating,
        games: rec.games,
        wins: rec.wins,
        losses: rec.losses,
        draws: rec.draws,
      };
    }),
  );
  const rows = rowsRaw.filter(
    (r) => r.name && r.name.toLowerCase() !== "anonymous",
  );
  rows.sort(
    (a, b) =>
      b.rating - a.rating ||
      b.games - a.games ||
      (a.name || "").localeCompare(b.name || ""),
  );
  return rows;
}

function formatShareDate(input: string | number | Date = Date.now()) {
  return new Date(input).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

function shareScoringLabel(scoring: SerializableBoard["scoring"]) {
  return scoring === "true" ? "True Area" : "Grid Footprint";
}

function parseSharePostDescriptor(input: unknown): SharePostDescriptor | null {
  if (!input || typeof input !== "object") return null;
  const maybe = input as Partial<SharePostDescriptor>;
  if (
    (maybe.shareType !== "rankings" && maybe.shareType !== "result") ||
    typeof maybe.shareId !== "string" ||
    !maybe.shareId
  ) {
    return null;
  }
  return { shareType: maybe.shareType, shareId: maybe.shareId };
}

async function saveSharePayload(
  payload:
    | Omit<RankingsSharePayload, "shareId">
    | Omit<ResultSharePayload, "shareId">,
): Promise<SharedPostPayload> {
  const shareId = randomUUID();
  const stored = { ...payload, shareId } as SharedPostPayload;
  await redis.set(SHARE_POST(shareId), JSON.stringify(stored));
  return stored;
}

async function loadSharePayload(
  shareId: string,
): Promise<SharedPostPayload | null> {
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
  if (payload.kind === "rankings") {
    const rows = payload.rows
      .slice(0, 5)
      .map(
        (row, index) =>
          `${index + 1}. ${row.name || row.userId} — ${row.rating} (${row.wins}-${row.losses})`,
      );
    return [payload.title, payload.subtitle, ...rows].join("\n");
  }

  const board = payload.board;
  return [
    payload.title,
    payload.subtitle,
    payload.headline,
    payload.details,
    `${payload.p1Name} ${board.m_players[0]?.m_score ?? 0} — ${board.m_players[1]?.m_score ?? 0} ${payload.p2Name}`,
    payload.footer,
  ].join("\n");
}

function buildShareSplash(payload: SharedPostPayload) {
  return {
    appDisplayName: "Euclid",
    backgroundUri: "splash.jpg",
    buttonLabel: "Open Post",
    heading: payload.title,
    description:
      payload.kind === "rankings" ? payload.subtitle : payload.headline,
  };
}

async function getCurrentSubredditName() {
  return context.subredditName || (await reddit.getCurrentSubreddit()).name;
}

async function createCustomSharePost(
  title: string,
  payload: SharedPostPayload,
) {
  const subredditName = await getCurrentSubredditName();
  const descriptor: SharePostDescriptor = {
    shareType: payload.kind,
    shareId: payload.shareId,
  };
  const fallbackText = buildShareFallbackText(payload);
  const baseOptions = {
    subredditName,
    title,
    entry: "game" as const,
    postData: descriptor,
    textFallback: { text: fallbackText },
    splash: buildShareSplash(payload),
  };

  try {
    const post = await reddit.submitCustomPost({
      ...baseOptions,
      runAs: "USER",
      userGeneratedContent: { text: fallbackText },
    });
    return { post, subredditName, sharedAs: "USER" as const };
  } catch (userError: unknown) {
    slog("[SHARE] user-auth custom post failed, falling back to app account", {
      title,
      error: errorMessage(userError),
    });
    const post = await reddit.submitCustomPost({
      ...baseOptions,
      runAs: "APP",
    });
    return { post, subredditName, sharedAs: "APP" as const };
  }
}

async function enforceShareRateLimit(uid: string, kind: string) {
  await reserveShareCooldown(redis, SHARE_RATE(uid, kind), SHARE_RATE_MS);
}

function normalizeShareError(error: unknown): ShareError {
  const message = errorMessage(error);
  if (/RATELIMIT/i.test(message)) {
    const normalized: ShareError = new Error(
      "Rate limited by Reddit. Please wait a few seconds before sharing again.",
    );
    normalized.statusCode = 429;
    return normalized;
  }
  return error instanceof Error ? error : new Error(message);
}

function sendShareError(
  res: Response,
  label: string,
  error: unknown,
): Response {
  const normalized = normalizeShareError(error);
  if (normalized.retryAfterMs !== undefined) {
    return res.status(429).json({
      ok: false,
      message: normalized.message,
      retryAfter: normalized.retryAfterMs,
    });
  }
  if (normalized.statusCode === 429) {
    return res.status(429).json({ ok: false, message: normalized.message });
  }

  console.error(`[SHARE] ${label} error`, normalized);
  return res.status(500).json({ ok: false, message: normalized.message });
}

/* =========================
   BASIC ROUTES
   ========================= */
router.use("/api/users", userAvatarRouter(userAvatars));

router.get("/api/challenge-spotlights", (_req, res) => {
  res.json(EMPTY_CHALLENGE_SPOTLIGHTS);
});

router.get<
  { postId: string },
  InitResponse | { status: string; message: string }
>("/api/init", async (_req, res) => {
  const { postId, postData } = context;
  if (!postId)
    return res.status(400).json({
      status: "error",
      message: "postId is required but missing from context",
    });
  try {
    await drainH2HSettlementsBestEffort("init");
    const username = (await reddit.getCurrentUsername()) ?? "";
    const appVersion = context.appVersion || "unknown";
    // metrics: app start
    const uid = context.userId || "";
    await addUserToSet("app_start_users", uid);
    await incrCount("app_start_count", 1);

    const descriptor = parseSharePostDescriptor(postData);
    if (descriptor) {
      const share = await loadSharePayload(descriptor.shareId);
      if (!share || share.kind !== descriptor.shareType) {
        return res.status(410).json({
          status: "error",
          message: "This shared Euclid post is no longer available.",
        });
      }
      return res.json({ type: "share", postId, username, appVersion, share });
    }

    res.json({
      type: "init",
      canManageChallenges: await challengeModerator()
        .then(Boolean)
        .catch(() => false),
      postId,
      username,
      appVersion,
    });
  } catch (error: unknown) {
    res.status(400).json({
      status: "error",
      message: errorMessage(error, "Unknown init error"),
    });
  }
});

/* =========================
   H2H: queue / pair / mapping / state / save / rematch / leave / list / stats
   ========================= */

router.post("/api/h2h/queue", async (_req, res) => {
  try {
    const uid = context.userId;
    if (!uid)
      return res
        .status(400)
        .json({ status: "error", message: "userId missing" });

    // Remember the caller's name and avatar, while allowing matchmaking to
    // continue if Reddit's profile API is temporarily unavailable.
    try {
      await refreshCurrentUserProfile(uid);
    } catch (error: unknown) {
      slog("[PROFILE] unable to refresh queued player", {
        uid,
        error: errorMessage(error),
      });
    }

    // metrics: H2H click
    await addUserToSet("h2h_click_users", uid);
    await incrCount("h2h_click_count", 1);

    const result = await h2hStore.queueOrResume(uid);
    const createdPair =
      "createdPair" in result ? result.createdPair : undefined;
    if (createdPair) {
      const [firstId, secondId] = createdPair.playerIds;
      // Keep these sequential: both update the same JSON-backed set.
      await addUserToSet("h2h_started_users", firstId);
      await addUserToSet("h2h_started_users", secondId);
      await incrCount("h2h_started_count", 1);
    }

    slog("[H2H] queue", {
      uid,
      status: result.status,
      createdGameId: createdPair?.gameId,
    });
    if (result.status === "queued") {
      return res.json({ ok: true, state: "queued" });
    }

    const viewer = await h2hStore.getStateForViewer(result.gameId, uid);
    const state = await enrichH2HProfiles(viewer?.state ?? result.state);
    return res.json({
      ...state,
      ok: true,
      state: result.status,
      isPlayer1: result.isPlayer1,
      canRematch: viewer?.canRematch ?? false,
    });
  } catch (error: unknown) {
    return sendH2HError(res, "queue", error);
  }
});

router.post("/api/h2h/cancelQueue", async (_req, res) => {
  try {
    const uid = context.userId;
    if (!uid)
      return res
        .status(401)
        .json({ status: "error", message: "userId missing" });

    const result = await h2hStore.cancelQueue(uid);
    await incrCount("h2h_cancel_queue_count", 1);
    slog("[H2H] cancelQueue", { uid, removed: result.removed });
    return res.json({ ok: true, removed: result.removed });
  } catch (error: unknown) {
    return sendH2HError(res, "cancel queue", error);
  }
});

router.get("/api/h2h/mapping", async (_req, res) => {
  try {
    const uid = context.userId;
    if (!uid)
      return res
        .status(400)
        .json({ status: "error", message: "userId missing" });

    let presence = await resolveH2HPresence(h2hStore, uid);

    if (presence.state === "active") {
      try {
        await refreshCurrentUserProfile(uid);
      } catch (error: unknown) {
        slog("[PROFILE] unable to refresh mapped player", {
          uid,
          error: errorMessage(error),
        });
      }
    }

    // Cleanup may race a move or remap, so never return the discovery snapshot.
    for (
      let attempt = 0;
      attempt < 2 && presence.state === "active";
      attempt++
    ) {
      const discoveredGameId = presence.mapping.gameId;
      await h2hStore.cleanupStaleGame(discoveredGameId);
      presence = await resolveH2HPresence(h2hStore, uid);
      if (presence.state !== "active") break;

      const mapping = presence.mapping;
      if (!mapping.state || mapping.isPlayer1 === null) {
        await h2hStore.deleteMappingIfEqual(uid, mapping.gameId);
        presence = await resolveH2HPresence(h2hStore, uid);
      }
      if (
        presence.state !== "active" ||
        presence.mapping.gameId === discoveredGameId
      ) {
        break;
      }
    }

    if (presence.state !== "active") {
      const response: H2HMappingResponse = {
        ok: true,
        state: presence.state,
        gameId: null,
      };
      return res.json(response);
    }

    const mapping = presence.mapping;
    if (!mapping.state || mapping.isPlayer1 === null) {
      await h2hStore.deleteMappingIfEqual(uid, mapping.gameId);
      presence = await resolveH2HPresence(h2hStore, uid);
      if (presence.state !== "active") {
        const response: H2HMappingResponse = {
          ok: true,
          state: presence.state,
          gameId: null,
        };
        return res.json(response);
      }
    }

    const currentMapping = presence.mapping;
    if (!currentMapping.state || currentMapping.isPlayer1 === null) {
      throw new H2HStoreError(
        "dynamic_conflict",
        "The caller's game mapping changed too frequently to read safely.",
      );
    }

    const viewer = await h2hStore.getStateForViewer(currentMapping.gameId, uid);
    if (!viewer) {
      await h2hStore.deleteMappingIfEqual(uid, currentMapping.gameId);
      const nextPresence = await resolveH2HPresence(h2hStore, uid);
      if (nextPresence.state !== "active") {
        const response: H2HMappingResponse = {
          ok: true,
          state: nextPresence.state,
          gameId: null,
        };
        return res.json(response);
      }
      throw new H2HStoreError(
        "dynamic_conflict",
        "The caller's game mapping changed too frequently to read safely.",
      );
    }

    const state = await enrichH2HProfiles(viewer.state);
    slog("[H2H] mapping", {
      uid,
      gameId: currentMapping.gameId,
      isPlayer1: currentMapping.isPlayer1,
    });
    const response: H2HMappingResponse = {
      ...state,
      ok: true,
      state: "active",
      isPlayer1: currentMapping.isPlayer1,
      canRematch: viewer.canRematch,
    };
    return res.json(response);
  } catch (error: unknown) {
    return sendH2HError(res, "mapping", error);
  }
});

router.get("/api/h2h/state", async (req, res) => {
  try {
    const gid = String(req.query.gameId || "");
    if (!gid)
      return res
        .status(400)
        .json({ status: "error", message: "gameId required" });

    await h2hStore.cleanupStaleGame(gid);
    const viewer = await h2hStore.getStateForViewer(gid, context.userId);
    if (!viewer) {
      return res.status(404).json({ ok: false, message: "Game not found." });
    }

    const response: H2HStateResponse = {
      ...(await enrichH2HProfiles(viewer.state)),
      ok: true,
      canRematch: viewer.canRematch,
    };
    return res.json(response);
  } catch (error: unknown) {
    return sendH2HError(res, "state", error);
  }
});

router.post("/api/h2h/save", async (req, res) => {
  try {
    const uid = context.userId;
    if (!uid)
      return res
        .status(401)
        .json({ status: "error", message: "userId missing" });

    const request = (req.body ?? {}) as H2HMoveRequest;
    const commit = await h2hStore.applyMove(uid, request);
    await settleH2HEventBestEffort(commit.settlementEvent, "move");
    const response = await enrichH2HProfiles(commit.response);
    slog("[H2H] move", {
      gameId: response.gameId,
      by: uid,
      x: request.x,
      y: request.y,
      points: response.pointsScored,
      ended: response.ended,
      reason: response.endedReason,
    });
    return res.json(response);
  } catch (error: unknown) {
    return sendH2HError(res, "move", error, { move: true });
  }
});

router.post("/api/h2h/rematch", async (req, res) => {
  try {
    const uid = context.userId;
    if (!uid)
      return res
        .status(401)
        .json({ status: "error", message: "userId missing" });

    const request = (req.body ?? {}) as H2HRematchRequest;
    if (!request.gameId)
      return res
        .status(400)
        .json({ status: "error", message: "gameId required" });

    const state = await enrichH2HProfiles(await h2hStore.rematch(uid, request));
    slog("[H2H] rematch", { gameId: request.gameId, by: uid });
    return res.json({ ...state, ok: true });
  } catch (error: unknown) {
    return sendH2HError(res, "rematch", error);
  }
});

router.post("/api/h2h/leave", async (req, res) => {
  try {
    const uid = context.userId;
    if (!uid)
      return res
        .status(401)
        .json({ status: "error", message: "userId missing" });

    const request = (req.body ?? {}) as H2HLeaveRequest;
    if (!request.gameId) {
      return res
        .status(400)
        .json({ status: "error", message: "gameId required" });
    }

    const commit = await h2hStore.leave(uid, request);
    await settleH2HEventBestEffort(commit.settlementEvent, "leave");
    slog("[H2H] leave", {
      uid,
      gameId: commit.gameId,
      forfeit: commit.causedForfeitTransition,
    });
    if (!commit.state) {
      return res.json({
        ok: true,
        left: commit.gameId !== null,
        gameId: null,
        ...(commit.canceledPristineRematch
          ? { canceledPristineRematch: true }
          : {}),
      });
    }
    return res.json({
      ...(await enrichH2HProfiles(commit.state)),
      ok: true,
      left: true,
      forfeit: commit.causedForfeitTransition,
    });
  } catch (error: unknown) {
    return sendH2HError(res, "leave", error);
  }
});

router.get("/api/games/list", async (_req, res) => {
  try {
    const games = await h2hStore.listLiveGames();
    const enrichedGames = await Promise.all(
      games.map(async (game) => ({
        ...game,
        // Enrich this summary's participants without mixing in a later round.
        names: await enrichH2HNames(game.playerIds, game.names),
      })),
    );
    return res.json({ games: enrichedGames } satisfies H2HLiveGamesResponse);
  } catch (error: unknown) {
    return sendH2HError(res, "live games", error);
  }
});

router.get("/api/user/stats", async (_req, res) => {
  try {
    const uid = context.userId;
    if (!uid)
      return res
        .status(400)
        .json({ status: "error", message: "userId missing" });
    await drainH2HSettlementsBestEffort("user stats");
    const [hvh, soloRating] = await Promise.all([
      getElo(uid),
      soloStore.getRankedRating(uid),
    ]);
    const hva: RatingRecord = {
      rating: soloRating.rating,
      games: soloRating.games,
      wins: soloRating.wins,
      losses: soloRating.losses,
      draws: soloRating.draws,
    };
    const response: UserStatsResponse = { hvh, hva };
    res.json(response);
  } catch (error: unknown) {
    res.status(500).json({ status: "error", message: errorMessage(error) });
  }
});

/* =========================
   Solo (Human vs AI) — canonical server-owned sessions
   ========================= */
router.post("/api/solo/start", async (req, res) => {
  try {
    const uid = context.userId;
    if (!uid)
      return res.status(401).json({ ok: false, message: "userId missing" });
    try {
      await refreshCurrentUserProfile(uid);
    } catch (error: unknown) {
      slog("[SOLO] unable to refresh profile before start", {
        uid,
        error: errorMessage(error),
      });
    }
    return res.json(await soloStore.start(uid, req.body));
  } catch (error: unknown) {
    return sendSoloError(res, "start", error);
  }
});

router.get("/api/solo/active", async (_req, res) => {
  try {
    const uid = context.userId;
    if (!uid)
      return res.status(401).json({ ok: false, message: "userId missing" });
    const snapshot = await soloStore.getActiveRanked(uid);
    if (!snapshot)
      return res
        .status(404)
        .json({ ok: false, message: "No active Ranked solo game." });
    return res.json({ ok: true, snapshot });
  } catch (error: unknown) {
    return sendSoloError(res, "active game", error);
  }
});

router.get("/api/solo/state", async (req, res) => {
  try {
    const uid = context.userId;
    if (!uid)
      return res.status(401).json({ ok: false, message: "userId missing" });
    const gameId = typeof req.query.gameId === "string" ? req.query.gameId : "";
    const snapshot = await soloStore.getState(uid, gameId);
    return res.json({ ok: true, snapshot });
  } catch (error: unknown) {
    return sendSoloError(res, "state", error);
  }
});

router.post("/api/solo/move", async (req, res) => {
  try {
    const uid = context.userId;
    if (!uid)
      return res.status(401).json({ ok: false, message: "userId missing" });
    const result = await soloStore.move(uid, req.body as SoloMoveRequest);
    if (!result.accepted) {
      return res
        .status(result.reason === "out_of_range" ? 400 : 409)
        .json(result);
    }
    return res.json(result);
  } catch (error: unknown) {
    return sendSoloError(res, "move", error);
  }
});

router.post("/api/solo/abandon", async (req, res) => {
  try {
    const uid = context.userId;
    if (!uid)
      return res.status(401).json({ ok: false, message: "userId missing" });
    const result = await soloStore.abandon(uid, req.body as SoloAbandonRequest);
    return res.status(result.abandoned ? 200 : 409).json(result);
  } catch (error: unknown) {
    return sendSoloError(res, "abandon", error);
  }
});

router.get("/api/solo/result", async (req, res) => {
  try {
    const uid = context.userId;
    if (!uid)
      return res.status(401).json({ ok: false, message: "userId missing" });
    const gameId = typeof req.query.gameId === "string" ? req.query.gameId : "";
    return res.json({
      ok: true,
      result: await soloStore.getTerminalResult(uid, gameId),
    });
  } catch (error: unknown) {
    return sendSoloError(res, "result", error);
  }
});

router.post("/api/solo/record", (_req, res) =>
  res.status(410).json({
    ok: false,
    message: "Client-reported solo results are no longer accepted.",
  }),
);

/* =========================
   Solo entry-click metrics
   ========================= */
router.post("/api/metrics/ai-click", async (_req, res) => {
  try {
    const uid = context.userId || "";
    await addUserToSet("ai_click_users", uid);
    await incrCount("ai_click_count", 1);
    res.json({ ok: true });
  } catch (error: unknown) {
    res.status(500).json({ status: "error", message: errorMessage(error) });
  }
});
/* =========================
   Rankings (both buckets) — exclude anonymous entries
   ========================= */
router.get("/api/rankings", async (_req, res) => {
  try {
    await drainH2HSettlementsBestEffort("rankings");
    const [hvh, hva] = await Promise.all([
      getRankingRows("hvh"),
      getRankingRows("hva"),
    ]);
    res.json({ hvh, hva, hvaRules: RANKED_SOLO_METADATA });
  } catch (error: unknown) {
    console.error("[RANKINGS] error", error);
    res.status(500).json({ status: "error", message: errorMessage(error) });
  }
});

/* =========================
   Share custom posts to Reddit
   ========================= */

router.post("/api/share/rankings", async (req, res) => {
  try {
    const uid = context.userId;
    if (!uid)
      return res.status(401).json({ ok: false, message: "userId missing" });

    const { bucket } = (req.body || {}) as { bucket?: ShareBucket };
    if (bucket !== "hvh" && bucket !== "hva")
      return res
        .status(400)
        .json({ ok: false, message: "invalid rankings bucket" });

    await drainH2HSettlementsBestEffort("share rankings");
    await enforceShareRateLimit(uid, `rankings:${bucket}`);
    const rows = await getRankingRows(bucket);
    if (rows.length === 0)
      return res.status(409).json({
        ok: false,
        message: "No rankings are available to share yet.",
      });

    const sharedAt = nowISO();
    const subredditName = await getCurrentSubredditName();
    const title =
      bucket === "hvh"
        ? `Euclid ${LEADERBOARD_LABEL} — ${HUMAN_VS_HUMAN_LABEL} — ${formatShareDate()}`
        : `Euclid ${LEADERBOARD_LABEL} — ${HUMAN_VS_EUCLID_LABEL} — ${formatShareDate()}`;
    const payload = await saveSharePayload({
      kind: "rankings",
      subredditName,
      sharedAt,
      bucket,
      title: `Euclid ${LEADERBOARD_LABEL}`,
      subtitle: `${bucket === "hvh" ? HUMAN_VS_HUMAN_LABEL : `${HUMAN_VS_EUCLID_LABEL} • Ranked`} • ${formatShareDate(sharedAt)}`,
      rows: rows.slice(0, 10),
      ...(bucket === "hva" ? { solo: RANKED_SOLO_METADATA } : {}),
    });
    const { post, sharedAs } = await createCustomSharePost(title, payload);
    slog("[SHARE] rankings posted", { uid, bucket, postId: post.id, sharedAs });
    return res.json({
      ok: true,
      message: `${LEADERBOARD_LABEL} shared to r/${subredditName}${sharedAs === "APP" ? " via the app account." : "."}`,
      postId: post.id,
      permalink: post.permalink,
      sharedAs,
    });
  } catch (error: unknown) {
    return sendShareError(res, "rankings", error);
  }
});

router.post("/api/share/h2h-result", async (req, res) => {
  try {
    const uid = context.userId;
    if (!uid)
      return res.status(401).json({ ok: false, message: "userId missing" });

    const request = (req.body ?? {}) as Partial<H2HShareRequest>;
    if (typeof request.gameId !== "string" || request.gameId.trim() === "") {
      return res.status(400).json({ ok: false, message: "gameId missing" });
    }
    const terminalRevision = request.terminalRevision;
    if (
      typeof terminalRevision !== "number" ||
      !Number.isSafeInteger(terminalRevision) ||
      terminalRevision < 0
    ) {
      return res
        .status(400)
        .json({ ok: false, message: "terminalRevision is invalid" });
    }

    // Each terminal revision is immutable even when the same game ID is reused
    // for a rematch. Load that exact round, then authorize against its players.
    const storedState = await h2hStore.getTerminalState(
      request.gameId,
      terminalRevision,
    );
    if (!storedState)
      return res
        .status(400)
        .json({ ok: false, message: "No finished game found to share." });

    const participantIds = storedState.board.m_players.map(
      (player) => player.userId,
    );
    if (!participantIds.includes(uid)) {
      return res.status(403).json({
        ok: false,
        message: "Only a participant can share this result.",
      });
    }

    const state = await enrichH2HProfiles(storedState);
    if (!state.ended)
      return res
        .status(409)
        .json({ ok: false, message: "Game is still in progress." });

    const winnerUid =
      state.victorSide === 1
        ? state.board.m_players[0].userId
        : state.victorSide === 2
          ? state.board.m_players[1].userId
          : null;
    if (!winnerUid)
      return res
        .status(409)
        .json({ ok: false, message: "Only a winning result can be shared." });
    if (winnerUid !== uid)
      return res
        .status(403)
        .json({ ok: false, message: "Only the winner can share this result." });

    await enforceShareRateLimit(uid, "h2h");

    const gid = state.gameId;
    const board = state.board;
    const u1 = board.m_players[0].userId;
    const u2 = board.m_players[1].userId;
    const names = board.playerNames ?? {};
    const p1Name = names[u1] || "Redditor 1";
    const p2Name = names[u2] || "Redditor 2";
    const winnerName = winnerUid === u1 ? p1Name : p2Name;
    const loserName = winnerUid === u1 ? p2Name : p1Name;
    const s1 = board.m_players[0].m_score;
    const s2 = board.m_players[1].m_score;
    const byForfeit = state.endedReason === "player_left";
    const sharedAt = nowISO();
    const subredditName = await getCurrentSubredditName();
    const title = byForfeit
      ? `${winnerName} Wins! — by forfeit — ${formatShareDate()}`
      : `${winnerName} Wins! — ${s1}-${s2} — ${formatShareDate()}`;
    const boardForShare: SerializableBoard = board;
    const p1Avatar = board.playerAvatars?.[u1];
    const p2Avatar = board.playerAvatars?.[u2];
    const payload = await saveSharePayload({
      kind: "result",
      subredditName,
      sharedAt,
      mode: "h2h",
      title: `${winnerName} Wins!`,
      subtitle: `${HUMAN_VS_HUMAN_LABEL} • ${formatShareDate(sharedAt)}`,
      headline: `${winnerName} Wins!`,
      details: byForfeit
        ? `${winnerName} advanced after ${loserName} left the match.`
        : `${s1}-${s2} • ${shareScoringLabel(boardForShare.scoring)} scoring • ${boardForShare.W}x${boardForShare.H} board`,
      footer: `First to ${boardForShare.winScore} points • Shared from r/${subredditName}`,
      board: boardForShare,
      p1Name,
      p2Name,
      ...(p1Avatar ? { p1Avatar } : {}),
      ...(p2Avatar ? { p2Avatar } : {}),
      winnerSide: winnerUid === u1 ? 1 : 2,
    });
    const { post, sharedAs } = await createCustomSharePost(title, payload);
    slog("[SHARE] h2h result posted", { uid, gid, postId: post.id, sharedAs });
    return res.json({
      ok: true,
      message: `Win shared to r/${subredditName}${sharedAs === "APP" ? " via the app account." : "."}`,
      postId: post.id,
      permalink: post.permalink,
      sharedAs,
    });
  } catch (error: unknown) {
    return sendShareError(res, "h2h result", error);
  }
});

router.post("/api/share/ai-result", async (req, res) => {
  try {
    const uid = context.userId;
    if (!uid)
      return res.status(401).json({ ok: false, message: "userId missing" });

    const request = (req.body ?? {}) as SoloShareRequest;
    const profile = await refreshCurrentUserProfile(uid);
    const username = profile.name || "Redditor";
    const subredditName = await getCurrentSubredditName();
    const prepared = await soloStore.prepareShare(uid, {
      gameId: request.gameId,
      commandId: request.commandId,
      subredditName,
      humanName: username,
      ...(profile.avatar ? { humanAvatar: profile.avatar } : {}),
    });

    if (prepared.receipt.status === "posted") {
      const receipt = prepared.receipt;
      return res.json({
        ok: true,
        status: "posted",
        replayed: true,
        message: `Win shared to r/${subredditName}${receipt.runAs === "APP" ? " via the app account." : "."}`,
        receipt: {
          gameId: receipt.gameId,
          commandId: receipt.commandId,
          shareId: receipt.shareId,
          postId: receipt.postId,
          permalink: receipt.permalink,
          createdAt: receipt.postedAt,
        },
      });
    }

    if (!prepared.shouldSubmit) {
      return res.status(202).json({
        ok: true,
        status: "pending",
        replayed: true,
        shareId: prepared.receipt.shareId,
        message:
          "This win was already prepared for sharing; no duplicate post was created.",
      });
    }

    let submitted: Awaited<ReturnType<typeof createCustomSharePost>>;
    try {
      submitted = await createCustomSharePost(
        prepared.receipt.payload.title,
        prepared.receipt.payload,
      );
    } catch (submissionError: unknown) {
      try {
        await soloStore.failShare(uid, {
          gameId: request.gameId,
          shareId: prepared.receipt.shareId,
          failureMessage: errorMessage(
            submissionError,
            "Reddit did not accept the share post.",
          ),
        });
      } catch (receiptError: unknown) {
        console.error("[SHARE] could not persist ai share failure", {
          uid,
          gameId: request.gameId,
          shareId: prepared.receipt.shareId,
          error: errorMessage(receiptError),
        });
      }
      throw submissionError;
    }
    const { post, sharedAs } = submitted;
    const receipt = await soloStore.finalizeShare(uid, {
      gameId: request.gameId,
      shareId: prepared.receipt.shareId,
      postId: post.id,
      permalink: post.permalink,
      runAs: sharedAs,
    });
    slog("[SHARE] ai result posted", {
      uid,
      postId: post.id,
      sharedAs,
      gameId: request.gameId,
    });
    return res.json({
      ok: true,
      status: "posted",
      replayed: false,
      message: `Win shared to r/${subredditName}${sharedAs === "APP" ? " via the app account." : "."}`,
      receipt: {
        gameId: receipt.gameId,
        commandId: receipt.commandId,
        shareId: receipt.shareId,
        postId: receipt.postId,
        permalink: receipt.permalink,
        createdAt: receipt.postedAt,
      },
    });
  } catch (error: unknown) {
    if (
      error instanceof SoloDomainError ||
      error instanceof SoloStoreError ||
      error instanceof RedisCasConflictExhaustedError
    ) {
      return sendSoloError(res, "share", error);
    }
    return sendShareError(res, "ai result", error);
  }
});

/* =========================
   Admin metrics summary
   ========================= */
router.get("/api/admin/metrics", async (_req, res) => {
  try {
    await drainH2HSettlementsBestEffort("admin metrics");
    const uniques = {
      app_start_users: await scard("app_start_users"),
      h2h_click_users: await scard("h2h_click_users"),
      h2h_started_users: await scard("h2h_started_users"),
      h2h_completed_users: await scard("h2h_completed_users"),
      ai_click_users: await scard("ai_click_users"),
      ai_first_users: await scard("ai_first_users"),
      ai_completed_users: await scard("ai_completed_users"),
    };

    const [
      h2h_click_set,
      h2h_started_set,
      h2h_completed_set,
      ai_click_set,
      ai_first_set,
      ai_completed_set,
    ] = await Promise.all([
      sget("h2h_click_users"),
      sget("h2h_started_users"),
      sget("h2h_completed_users"),
      sget("ai_click_users"),
      sget("ai_first_users"),
      sget("ai_completed_users"),
    ]);

    const diffCount = (a: Set<string>, b: Set<string>) => {
      let n = 0;
      for (const v of a) if (!b.has(v)) n++;
      return n;
    };

    const computed = {
      h2h_clicked_never_started: diffCount(h2h_click_set, h2h_started_set),
      h2h_started_never_finished: diffCount(h2h_started_set, h2h_completed_set),
      ai_clicked_never_started: diffCount(ai_click_set, ai_first_set),
      ai_started_never_finished: diffCount(ai_first_set, ai_completed_set),
    };

    const counts = {
      app_start_count: await getCount("app_start_count"),
      h2h_click_count: await getCount("h2h_click_count"),
      h2h_started_count: await getCount("h2h_started_count"),
      h2h_game_over_count: await getCount("h2h_game_over_count"),
      h2h_cancel_queue_count: await getCount("h2h_cancel_queue_count"),
      h2h_opponent_left_count: await getCount("h2h_opponent_left_count"),
      h2h_player_left_count: await getCount("h2h_player_left_count"),
      ai_click_count: await getCount("ai_click_count"),
      ai_first_count: await getCount("ai_first_count"),
      ai_completed_count: await getCount("ai_completed_count"),
    };

    const aiDiffs = {
      doofus: await getCount("ai_diff_doofus_count"),
      goldfish: await getCount("ai_diff_goldfish_count"),
      beginner: await getCount("ai_diff_beginner_count"),
      coffee: await getCount("ai_diff_coffee_count"),
      tenderfoot: await getCount("ai_diff_tenderfoot_count"),
      casual: await getCount("ai_diff_casual_count"),
      offensive: await getCount("ai_diff_offensive_count"),
      defensive: await getCount("ai_diff_defensive_count"),
      brutal: await getCount("ai_diff_brutal_count"),
    };

    // Daily for past 7 days
    const daily: {
      dates: string[];
      hvh: number[];
      ai: Record<AiDifficulty, number[]>;
    } = {
      dates: [],
      hvh: [],
      ai: {
        doofus: [],
        goldfish: [],
        beginner: [],
        coffee: [],
        tenderfoot: [],
        casual: [],
        offensive: [],
        defensive: [],
        brutal: [],
      },
    };
    for (let i = 0; i < 7; i++) {
      const d = new Date(Date.now() - i * 86400000);
      const date = d.toISOString().slice(0, 10);
      daily.dates.unshift(date);
      daily.hvh.unshift(await getCount(DAILY_HVH(date)));
      for (const diff of diffs) {
        daily.ai[diff].unshift(await getCount(DAILY_AI(diff, date)));
      }
    }

    const activeGames = (await h2hStore.listLiveGames()).length;
    const rankedPlayers = {
      hvh: (await getPlayers()).length,
      hva: await soloStore.countRankedPlayers(),
    };

    res.json({
      uniques,
      counts,
      computed,
      aiDiffs,
      activeGames,
      rankedPlayers,
      daily,
    });
  } catch (error: unknown) {
    console.error("[ADMIN] metrics error", error);
    res.status(500).json({ status: "error", message: errorMessage(error) });
  }
});

/* =========================
   H2H Chat
   ========================= */
router.post("/api/h2h/chat", async (req, res) => {
  try {
    const uid = context.userId;
    if (!uid)
      return res
        .status(401)
        .json({ status: "error", message: "userId missing" });

    const { gameId, text } = (req.body || {}) as {
      gameId: string;
      text: string;
    };
    if (!gameId || typeof text !== "string")
      return res
        .status(400)
        .json({ status: "error", message: "gameId and text required" });

    const result = await h2hStore.appendChat(uid, gameId, text);
    const state = await enrichH2HProfiles(result.state);
    return res.json({ ...state, ok: true, chatItem: result.item });
  } catch (error: unknown) {
    return sendH2HError(res, "chat", error);
  }
});

router.post("/internal/menu/create-post", async (_req, res) => {
  try {
    const post = await createPost();
    slog("[MENU] created game post", { postId: post.id, postUrl: post.url });

    const response: UiResponse = {
      navigateTo: post.url,
      showToast: {
        text: "Euclid post created",
        appearance: "success",
      },
    };
    return res.json(response);
  } catch (error: unknown) {
    console.error("[MENU] Error creating post", error);
    const response: UiResponse = {
      showToast: "Failed to create game post",
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
server.on("error", (err) => console.error(`server error; ${err.stack}`));
server.listen(port);
