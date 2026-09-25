/**
 * Local-only stand-in for the parts of `@devvit/web/server` that Euclid's
 * server uses. It lets the real, unmodified server code run on a developer
 * machine for UI work. It is never bundled into a Devvit upload.
 *
 * Identity comes from the `euclid-local-user` cookie, so two browser profiles
 * (or `/__local/as?user=name`) can play a Redditor-vs-Redditor match.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { writeFileSync } from "node:fs";
import http from "node:http";
import path from "node:path";
import {
  MOCK_RANKINGS,
  MOCK_SPOTLIGHTS,
  mockAvatarUrl,
} from "./preview-fixtures.mjs";

const identity = new AsyncLocalStorage();
const USER_COOKIE = "euclid-local-user";
const POST_COOKIE = "euclid-local-post";
const USER_HEADER = "x-euclid-local-user";
const DEFAULT_USER = "local_player";
const LOCAL_POST_ID = "t3_local";
const LOCAL_SUBREDDIT = "euclid_local";

const current = () => identity.getStore() ?? toIdentity(DEFAULT_USER);

function toIdentity(username) {
  return { userId: `t2_${username}`, username };
}

function readCookie(header, name) {
  const match = header?.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  return decodeURIComponent(match?.[1] ?? "").replace(/[^\w-]/g, "");
}

const cookieUser = (header) => readCookie(header, USER_COOKIE) || DEFAULT_USER;

/* ---------- Redis: string keys with optimistic WATCH/MULTI/EXEC ---------- */

const store = new Map();
const versions = new Map();

function live(key) {
  const entry = store.get(key);
  if (entry?.expiresAt !== undefined && entry.expiresAt <= Date.now()) {
    store.delete(key);
    return undefined;
  }
  return entry;
}

function write(key, value, expiration) {
  if (value === null) store.delete(key);
  else
    store.set(key, {
      value,
      ...(expiration ? { expiresAt: expiration.getTime() } : {}),
    });
  versions.set(key, (versions.get(key) ?? 0) + 1);
}

export const redis = {
  async get(key) {
    return live(key)?.value;
  },
  async set(key, value, options) {
    write(key, value, options?.expiration);
    return "OK";
  },
  async del(...keys) {
    keys.forEach((key) => write(key, null));
  },
  async watch(...keys) {
    const watched = new Map(keys.map((key) => [key, versions.get(key) ?? 0]));
    let queue = null;
    const enqueue = (entry) => {
      if (!queue) throw new Error("MULTI has not been called");
      queue.push(entry);
    };
    return {
      async multi() {
        queue = [];
      },
      async set(key, value, options) {
        enqueue({ key, value, ...(options ? options : {}) });
      },
      async del(...delKeys) {
        delKeys.forEach((key) => enqueue({ key, value: null }));
      },
      async exec() {
        const conflict = [...watched].some(
          ([key, version]) => (versions.get(key) ?? 0) !== version,
        );
        const pending = queue ?? [];
        queue = null;
        if (conflict) return null;
        pending.forEach(({ key, value, expiration }) =>
          write(key, value, expiration),
        );
        return pending.map(() => "OK");
      },
      async discard() {
        queue = null;
      },
      async unwatch() {
        watched.clear();
      },
    };
  },
};

/* ---------- Reddit and request context ---------- */

let postCounter = 0;
/** Posts created locally, so `/__local/post?id=…` can open one like Reddit. */
const posts = new Map();

export const reddit = {
  getModerators({ username }) {
    return {
      all: async () => (username === "local_moderator" ? [{ username }] : []),
    };
  },
  async getCurrentUsername() {
    return current().username;
  },
  async getSnoovatarUrl(username) {
    return mockAvatarUrl(username);
  },
  async getCurrentUser() {
    const username = current().username;
    return { username, getSnoovatarUrl: async () => mockAvatarUrl(username) };
  },
  async getCurrentSubreddit() {
    return { name: LOCAL_SUBREDDIT };
  },
  async submitCustomPost(options) {
    postCounter += 1;
    const id = `t3_local_${postCounter}`;
    posts.set(id, { title: options.title ?? "", postData: options.postData });
    console.log(
      `[local-devvit] custom post ${id}: ${options.title ?? "(untitled)"} — open /__local/post?id=${id}`,
    );
    return {
      id,
      permalink: `/r/${LOCAL_SUBREDDIT}/comments/${id.slice(3)}/`,
      url: `http://localhost/r/${LOCAL_SUBREDDIT}/comments/${id.slice(3)}/`,
    };
  },
};

export const context = {
  get userId() {
    return current().userId;
  },
  get postId() {
    return current().postId ?? LOCAL_POST_ID;
  },
  get postData() {
    return posts.get(current().postId)?.postData;
  },
  subredditName: LOCAL_SUBREDDIT,
  appVersion: "local",
};

/* ---------- Brand art export (src/client/dev/brand-assets.html) ---------- */

// Only PNG or JPEG files in the two art folders may be written.
const BRAND_ASSET_DIRS = ["subreddit/images/", "src/client/public/"];

function saveBrandAsset(req, res, file) {
  const allowed =
    /\.(png|jpg)$/.test(file) &&
    !file.includes("..") &&
    BRAND_ASSET_DIRS.some((dir) => file.startsWith(dir));
  if (!allowed) {
    res.writeHead(400).end("Refusing to write outside the brand art folders.");
    return;
  }
  const chunks = [];
  req.on("data", (chunk) => chunks.push(chunk));
  req.on("end", () => {
    writeFileSync(path.resolve(file), Buffer.concat(chunks));
    console.log(`[local-devvit] wrote ${file}`);
    res.writeHead(204).end();
  });
}

/* ---------- HTTP server ---------- */

export const getServerPort = () => Number(process.env.EUCLID_API_PORT ?? 7475);

export function createServer(app) {
  return http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (
      req.method === "GET" &&
      (url.pathname === "/api/rankings" ||
        url.pathname === "/api/challenge-spotlights")
    ) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify(
          url.pathname === "/api/rankings" ? MOCK_RANKINGS : MOCK_SPOTLIGHTS,
        ),
      );
      return;
    }
    if (url.pathname === "/__local/brand-asset" && req.method === "POST") {
      saveBrandAsset(req, res, url.searchParams.get("file") ?? "");
      return;
    }
    if (url.pathname === "/__local/posts") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(Object.fromEntries(posts), null, 2));
      return;
    }
    if (url.pathname === "/__local/post") {
      // Without an id this returns to the ordinary game post.
      const id = readCookie(
        `${POST_COOKIE}=${url.searchParams.get("id") ?? ""}`,
        POST_COOKIE,
      );
      res.writeHead(302, {
        "set-cookie": `${POST_COOKIE}=${id}; Path=/; SameSite=Lax`,
        location: url.searchParams.get("next") ?? "/preview.html",
      });
      res.end();
      return;
    }
    if (url.pathname === "/__local/as") {
      const name = cookieUser(`${USER_COOKIE}=${url.searchParams.get("user")}`);
      res.writeHead(302, {
        "set-cookie": `${USER_COOKIE}=${name}; Path=/; SameSite=Lax`,
        location: url.searchParams.get("next") ?? "/",
      });
      res.end();
      return;
    }
    const postId = readCookie(req.headers.cookie, POST_COOKIE) || undefined;
    // A per-tab identity header (see vite.client.config.mjs) beats the cookie.
    const tabUser = readCookie(`u=${req.headers[USER_HEADER] ?? ""}`, "u");
    identity.run(
      {
        ...toIdentity(tabUser || cookieUser(req.headers.cookie)),
        postId,
      },
      () => app(req, res),
    );
  });
}
