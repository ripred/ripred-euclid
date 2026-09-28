import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createLocalRedis } from "./redis-store.mjs";

function fixture(t) {
  const directory = mkdtempSync(path.join(os.tmpdir(), "euclid-local-redis-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const filePath = path.join(directory, "state.json");
  let timestamp = Date.UTC(2026, 8, 27);
  const options = { filePath, now: () => timestamp };
  return {
    directory,
    filePath,
    redis: createLocalRedis(options),
    reload: () => createLocalRedis(options),
    advance: (ms) => {
      timestamp += ms;
    },
    now: options.now,
  };
}

test("strings and sorted sets survive restart with their expiration", async (t) => {
  const local = fixture(t);
  await local.redis.set("settings", JSON.stringify({ daily: true }));
  await local.redis.set("attempt", "playing", {
    expiration: new Date(local.now() + 2000),
  });
  await local.redis.zAdd(
    "standings",
    { member: "b", score: 2 },
    { member: "a", score: 2 },
  );
  await local.redis.expire("standings", 2);
  local.advance(1000);
  const reloaded = local.reload();
  assert.equal(await reloaded.get("settings"), '{"daily":true}');
  assert.equal(await reloaded.get("attempt"), "playing");
  assert.deepEqual(await reloaded.zRange("standings", 0, -1), [
    { member: "a", score: 2 },
    { member: "b", score: 2 },
  ]);
  local.advance(1000);
  assert.equal(await reloaded.get("attempt"), undefined);
  assert.equal(await reloaded.zCard("standings"), 0);
  assert.equal(await local.reload().get("attempt"), undefined);
  assert.deepEqual(readdirSync(local.directory), ["state.json"]);
});

test("MULTI commits strings and sorted sets together; DISCARD changes neither", async (t) => {
  const local = fixture(t);
  await local.redis.set("attempt", "old");
  const before = readFileSync(local.filePath, "utf8");
  const tx = await local.redis.watch("attempt", "standings");
  await tx.multi();
  await tx.set("attempt", "completed");
  await tx.zAdd("standings", { member: "player", score: 10 });
  await tx.expire("standings", 3600);
  assert.equal(await local.redis.get("attempt"), "old");
  assert.equal(readFileSync(local.filePath, "utf8"), before);
  assert.deepEqual(await tx.exec(), ["OK", 1, 1]);
  assert.equal(await local.reload().get("attempt"), "completed");
  assert.equal(await local.reload().zRank("standings", "player"), 0);
  const discarded = await local.redis.watch("attempt", "standings");
  await discarded.multi();
  await discarded.del("attempt");
  await discarded.zRem("standings", ["player"]);
  await discarded.discard();
  assert.equal(await local.redis.get("attempt"), "completed");
  assert.equal(await local.redis.zCard("standings"), 1);
});

test("WATCH conflicts prevent all queued writes, including expiry races", async (t) => {
  const local = fixture(t);
  await local.redis.set("attempt", "old", {
    expiration: new Date(local.now() + 1000),
  });
  const tx = await local.redis.watch("attempt");
  await tx.multi();
  await tx.set("result", "should not commit");
  local.advance(1000);
  assert.equal(await tx.exec(), null);
  assert.equal(await local.redis.get("result"), undefined);
  const sorted = await local.redis.watch("standings");
  await sorted.multi();
  await sorted.set("result", "also should not commit");
  await local.redis.zAdd("standings", { member: "other", score: 9 });
  assert.equal(await sorted.exec(), null);
  assert.equal(await local.redis.get("result"), undefined);
});

test("sorted ties use Redis byte ordering and updates preserve ranks and pagination", async (t) => {
  const { redis } = fixture(t);
  assert.equal(
    await redis.zAdd(
      "board",
      { member: "z", score: 1 },
      { member: "A", score: 1 },
      { member: "a", score: 1 },
      { member: "last", score: 2 },
    ),
    4,
  );
  assert.deepEqual(
    (await redis.zRange("board", 0, -1)).map((v) => v.member),
    ["A", "a", "z", "last"],
  );
  assert.deepEqual(
    (await redis.zRange("board", 1, 2)).map((v) => v.member),
    ["a", "z"],
  );
  assert.deepEqual(
    (await redis.zRange("board", -2, -1)).map((v) => v.member),
    ["z", "last"],
  );
  assert.deepEqual(
    (await redis.zRange("board", 0, 1, { by: "rank", reverse: true })).map(
      (v) => v.member,
    ),
    ["last", "z"],
  );
  assert.equal(await redis.zAdd("board", { member: "last", score: 0 }), 0);
  assert.equal(await redis.zRank("board", "last"), 0);
  assert.equal(await redis.zRank("board", "missing"), undefined);
  assert.equal(await redis.zRem("board", ["last", "absent"]), 1);
  assert.equal(await redis.zCard("board"), 3);
  await assert.rejects(redis.get("board"), /WRONGTYPE/);
});

test("range supports inclusive/exclusive score bounds and lexicographic limits", async (t) => {
  const { redis } = fixture(t);
  await redis.zAdd(
    "board",
    { member: "a", score: 1 },
    { member: "b", score: 2 },
    { member: "c", score: 3 },
  );
  assert.deepEqual(
    await redis.zRange("board", "(1", "+inf", {
      by: "score",
      limit: { offset: 1, count: 1 },
    }),
    [{ member: "c", score: 3 }],
  );
  assert.deepEqual(
    await redis.zRange("board", "+inf", "(1", { by: "score", reverse: true }),
    [
      { member: "c", score: 3 },
      { member: "b", score: 2 },
    ],
  );
  assert.deepEqual(await redis.zRange("board", "[a", "(c", { by: "lex" }), [
    { member: "a", score: 1 },
    { member: "b", score: 2 },
  ]);
});

test("invalid queued operations and failed persistence never publish partial state", async (t) => {
  const local = fixture(t);
  await local.redis.set("attempt", "old");
  const tx = await local.redis.watch("attempt");
  await tx.multi();
  await tx.set("attempt", "new");
  await tx.zAdd("attempt", { member: "wrong type", score: 1 });
  await assert.rejects(tx.exec(), /WRONGTYPE/);
  assert.equal(await local.redis.get("attempt"), "old");
  assert.equal(await local.reload().get("attempt"), "old");
  rmSync(local.filePath);
  mkdirSync(local.filePath);
  await assert.rejects(local.redis.set("attempt", "not persisted"));
  assert.equal(await local.redis.get("attempt"), "old");
  assert.deepEqual(readdirSync(local.directory), ["state.json"]);
});

test("sample seed NX cannot overwrite settled winners, and corrupt files are preserved", async (t) => {
  const local = fixture(t);
  await local.redis.set("winners", "real");
  assert.equal(await local.redis.set("winners", "sample", { nx: true }), null);
  assert.equal(await local.reload().get("winners"), "real");
  writeFileSync(local.filePath, "corrupt but valuable");
  assert.throws(local.reload, SyntaxError);
  assert.equal(readFileSync(local.filePath, "utf8"), "corrupt but valuable");
});

test("SET clears previous TTL while sorted-set mutations preserve it", async (t) => {
  const local = fixture(t);
  await local.redis.set("settings", "old", {
    expiration: new Date(local.now() + 1000),
  });
  await local.redis.set("settings", "new");
  await local.redis.zAdd("board", { member: "a", score: 1 });
  await local.redis.expire("board", 1);
  await local.redis.zAdd("board", { member: "b", score: 1 });
  local.advance(1000);
  assert.equal(await local.redis.get("settings"), "new");
  assert.equal(await local.redis.zCard("board"), 0);
});

test("past retention dates settle successfully with Devvit's minimum one-second TTL", async (t) => {
  const local = fixture(t);
  const tx = await local.redis.watch("instance", "summary");
  await tx.multi();
  await tx.set("instance", "settled", {
    expiration: new Date(local.now() - 90 * 86_400_000),
  });
  await tx.set("summary", "winner recorded");
  assert.deepEqual(await tx.exec(), ["OK", "OK"]);
  assert.equal(await local.reload().get("instance"), "settled");
  local.advance(1000);
  assert.equal(await local.reload().get("instance"), undefined);
  assert.equal(await local.reload().get("summary"), "winner recorded");
});

test("SET rounds TTL down to seconds when queued and applies it at EXEC", async (t) => {
  const local = fixture(t);
  await local.redis.set("direct", "value", {
    expiration: new Date(local.now() + 2999),
  });
  const tx = await local.redis.watch("queued");
  await tx.multi();
  await tx.set("queued", "value", { expiration: new Date(local.now() + 2999) });
  local.advance(1500);
  await tx.exec();
  local.advance(500);
  assert.equal(await local.redis.get("direct"), undefined);
  assert.equal(await local.redis.get("queued"), "value");
  local.advance(1500);
  assert.equal(await local.redis.get("queued"), undefined);
});

test("rank ranges reject LIMIT just like the Devvit client", async (t) => {
  const { redis } = fixture(t);
  await assert.rejects(
    redis.zRange("board", 0, 20, {
      by: "rank",
      limit: { offset: 0, count: 5 },
    }),
    /LIMIT/,
  );
});
