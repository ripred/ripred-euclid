import {
  closeSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

const compareMembers = (a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b));

/** A single-process local Redis adapter. The optional clock is only for tests. */
export function createLocalRedis({ filePath, now = Date.now } = {}) {
  let store = readSnapshot(filePath);
  let versions = new Map();

  // Every operation, including MULTI/EXEC, uses the same copy-on-write path.
  // Persistence completes before publishing the snapshot to live readers.
  function execute(operations, watched) {
    const draft = structuredClone(store);
    const nextVersions = new Map(versions);
    const timestamp = now();
    let changed = false;
    const touch = (key) => {
      changed = true;
      nextVersions.set(key, (nextVersions.get(key) ?? 0) + 1);
    };
    for (const [key, entry] of draft) {
      if (entry.expiresAt !== undefined && entry.expiresAt <= timestamp) {
        draft.delete(key);
        touch(key);
      }
    }
    const conflict =
      watched &&
      [...watched].some(
        ([key, version]) => (nextVersions.get(key) ?? 0) !== version,
      );
    const entryOfType = (key, type) => {
      const entry = draft.get(key);
      if (entry && entry.type !== type)
        throw new TypeError(
          "WRONGTYPE Operation against a key holding the wrong kind of value",
        );
      return entry;
    };
    const sorted = (key) =>
      [...(entryOfType(key, "zset")?.value ?? [])]
        .map(([member, score]) => ({ member, score }))
        .sort(
          (a, b) => a.score - b.score || compareMembers(a.member, b.member),
        );
    const results = conflict
      ? null
      : operations.map(({ method, args }) => {
          const [key, value, options] = args;
          switch (method) {
            case "get":
              return entryOfType(key, "string")?.value;
            case "set": {
              if (typeof value !== "string")
                throw new TypeError("Redis values must be strings.");
              if (options?.nx && options?.xx)
                throw new TypeError("SET cannot use NX and XX together.");
              if (
                (options?.nx && draft.has(key)) ||
                (options?.xx && !draft.has(key))
              )
                return null;
              const expiresAt =
                options?.expirationSeconds === undefined
                  ? undefined
                  : timestamp + options.expirationSeconds * 1000;
              draft.set(key, {
                type: "string",
                value,
                ...(expiresAt === undefined ? {} : { expiresAt }),
              });
              touch(key);
              return "OK";
            }
            case "del": {
              let removed = 0;
              for (const deleted of args)
                if (draft.delete(deleted)) {
                  touch(deleted);
                  removed++;
                }
              return removed;
            }
            case "expire": {
              if (!Number.isSafeInteger(value))
                throw new TypeError("EXPIRE requires integer seconds.");
              const entry = draft.get(key);
              if (!entry) return 0;
              if (value <= 0) draft.delete(key);
              else entry.expiresAt = timestamp + value * 1000;
              touch(key);
              return 1;
            }
            case "zAdd": {
              const entry = entryOfType(key, "zset") ?? {
                type: "zset",
                value: new Map(),
              };
              let added = 0;
              for (const member of args.slice(1)) {
                if (
                  typeof member.member !== "string" ||
                  !Number.isFinite(member.score)
                )
                  throw new TypeError("Invalid sorted-set member.");
                if (!entry.value.has(member.member)) added++;
                entry.value.set(member.member, member.score);
              }
              if (args.length > 1) {
                draft.set(key, entry);
                touch(key);
              }
              return added;
            }
            case "zRem": {
              const entry = entryOfType(key, "zset");
              let removed = 0;
              for (const member of value)
                if (entry?.value.delete(member)) removed++;
              if (removed) {
                if (!entry.value.size) draft.delete(key);
                touch(key);
              }
              return removed;
            }
            case "zRange":
              return range(sorted(key), value, options, args[3]);
            case "zRank": {
              const rank = sorted(key).findIndex(
                (entry) => entry.member === value,
              );
              return rank < 0 ? undefined : rank;
            }
            case "zCard":
              return entryOfType(key, "zset")?.value.size ?? 0;
            default:
              throw new TypeError(`Unsupported Redis command: ${method}`);
          }
        });
    if (changed) {
      if (filePath) saveSnapshot(filePath, draft);
      store = draft;
      versions = nextVersions;
    }
    return results;
  }

  const methods = [
    "get",
    "set",
    "del",
    "expire",
    "zAdd",
    "zRem",
    "zRange",
    "zRank",
    "zCard",
  ];
  const operation = (method, args) => {
    args = structuredClone(args);
    if (method === "set" && args[2]?.expiration) {
      const expiration = args[2].expiration.getTime();
      if (!Number.isFinite(expiration))
        throw new TypeError("Invalid Redis expiration date.");
      // Devvit converts Date to relative seconds when SET is queued. Redis
      // starts that TTL at EXEC and clamps an already-past date to one second.
      args[2].expirationSeconds = Math.max(
        1,
        Math.floor((expiration - now()) / 1000),
      );
      delete args[2].expiration;
    }
    return { method, args };
  };
  const redis = Object.fromEntries(
    methods.map((method) => [
      method,
      async (...args) => execute([operation(method, args)])[0],
    ]),
  );
  redis.watch = async (...keys) => {
    execute([]);
    const watched = new Map(keys.map((key) => [key, versions.get(key) ?? 0]));
    let queue = null;
    const transaction = Object.fromEntries(
      methods.map((method) => [
        method,
        async (...args) => {
          if (!queue) throw new Error("MULTI has not been called");
          queue.push(operation(method, args));
          return transaction;
        },
      ]),
    );
    return Object.assign(transaction, {
      async multi() {
        if (queue) throw new Error("MULTI calls cannot be nested");
        queue = [];
      },
      async exec() {
        if (!queue) throw new Error("MULTI has not been called");
        const pending = queue;
        queue = null;
        try {
          return execute(pending, watched);
        } finally {
          watched.clear();
        }
      },
      async discard() {
        queue = null;
        watched.clear();
      },
      async unwatch() {
        watched.clear();
        return transaction;
      },
    });
  };
  return redis;
}

function range(entries, start, stop, options = {}) {
  if (options.reverse) entries.reverse();
  const by = options.by ?? "rank";
  if (by === "rank") {
    if (options.limit)
      throw new TypeError("Sorted-set LIMIT requires score or lex bounds.");
    if (!Number.isInteger(start) || !Number.isInteger(stop))
      throw new TypeError("Rank bounds must be integers.");
    const first = start < 0 ? Math.max(entries.length + start, 0) : start;
    const last = stop < 0 ? entries.length + stop : stop;
    entries = last < first ? [] : entries.slice(first, last + 1);
  } else if (by === "score" || by === "lex") {
    const [minimum, maximum] = options.reverse ? [stop, start] : [start, stop];
    entries = entries.filter(
      ({ member, score }) =>
        insideBound(by === "score" ? score : member, minimum, true, by) &&
        insideBound(by === "score" ? score : member, maximum, false, by),
    );
  } else throw new TypeError(`Unsupported sorted-set range: ${by}`);
  const limit =
    options.limit ?? (by === "rank" ? undefined : { offset: 0, count: 1000 });
  if (limit) {
    const { offset, count } = limit;
    if (
      !Number.isSafeInteger(offset) ||
      offset < 0 ||
      !Number.isSafeInteger(count)
    )
      throw new TypeError("Invalid sorted-set range limit.");
    entries =
      count < 0 ? entries.slice(offset) : entries.slice(offset, offset + count);
  }
  return entries;
}

function insideBound(value, raw, lower, by) {
  if (raw === (by === "score" ? "-inf" : "-")) return lower;
  if (raw === (by === "score" ? "+inf" : "+")) return !lower;
  const exclusive = typeof raw === "string" && raw.startsWith("(");
  const stripped =
    typeof raw === "string" && /^[([]/.test(raw) ? raw.slice(1) : raw;
  const bound = by === "score" ? Number(stripped) : stripped;
  if (by === "score" && !Number.isFinite(bound))
    throw new TypeError("Invalid score bound.");
  const comparison =
    by === "score" ? value - bound : compareMembers(value, bound);
  return lower
    ? exclusive
      ? comparison > 0
      : comparison >= 0
    : exclusive
      ? comparison < 0
      : comparison <= 0;
}

function readSnapshot(filePath) {
  if (!filePath) return new Map();
  let raw;
  try {
    raw = readFileSync(filePath, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return new Map();
    throw error;
  }
  const snapshot = JSON.parse(raw);
  if (snapshot.version !== 1 || !Array.isArray(snapshot.entries))
    throw new Error(
      "Unrecognized local Redis snapshot; preserve it before resetting local state.",
    );
  return new Map(
    snapshot.entries.map(([key, entry]) => {
      if (
        typeof key !== "string" ||
        !entry ||
        (entry.expiresAt !== undefined && !Number.isFinite(entry.expiresAt)) ||
        (entry.type !== "string" && entry.type !== "zset") ||
        (entry.type === "string" && typeof entry.value !== "string") ||
        (entry.type === "zset" &&
          (!Array.isArray(entry.value) ||
            entry.value.some(
              (item) =>
                !Array.isArray(item) ||
                typeof item[0] !== "string" ||
                !Number.isFinite(item[1]),
            )))
      )
        throw new Error(
          "Invalid local Redis snapshot; preserve it before resetting local state.",
        );
      return [
        key,
        {
          ...entry,
          value: entry.type === "zset" ? new Map(entry.value) : entry.value,
        },
      ];
    }),
  );
}

function saveSnapshot(filePath, store) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  const snapshot = {
    version: 1,
    entries: [...store].map(([key, entry]) => [
      key,
      {
        ...entry,
        value: entry.type === "zset" ? [...entry.value] : entry.value,
      },
    ]),
  };
  let descriptor;
  try {
    descriptor = openSync(temporary, "wx", 0o600);
    writeFileSync(descriptor, JSON.stringify(snapshot));
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = undefined;
    renameSync(temporary, filePath);
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
    try {
      unlinkSync(temporary);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
}
