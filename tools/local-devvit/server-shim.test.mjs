import assert from "node:assert/strict";
import { buildSync } from "esbuild";
import { once } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

test("local selection redirects reject external navigation before setting cookies", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "euclid-local-redirects-"));
  const bundled = join(root, "server-shim.cjs");
  buildSync({
    entryPoints: [fileURLToPath(new URL("./server-shim.mjs", import.meta.url))],
    bundle: true,
    platform: "node",
    format: "cjs",
    outfile: bundled,
  });
  const previous = process.env.EUCLID_LOCAL_STATE;
  let createServer;
  try {
    process.env.EUCLID_LOCAL_STATE = join(root, "state.json");
    ({ createServer } = createRequire(import.meta.url)(bundled));
  } finally {
    if (previous === undefined) delete process.env.EUCLID_LOCAL_STATE;
    else process.env.EUCLID_LOCAL_STATE = previous;
  }
  const server = createServer((_req, res) => res.writeHead(204).end());
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    rmSync(root, { recursive: true, force: true });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const origin = `http://127.0.0.1:${server.address().port}`;

  for (const [route, fallback, cookie] of [
    ["as?user=local_player", "/", "euclid-local-user=local_player"],
    ["post?id=t3_local", "/preview.html", "euclid-local-post=t3_local"],
  ]) {
    const request = (query = "") =>
      fetch(`${origin}/__local/${route}${query}`, { redirect: "manual" });
    for (const next of [
      "https://example.invalid/",
      "//example.invalid/",
      "///example.invalid/",
      "\\\\example.invalid/",
      "/\\example.invalid/",
      "/\t/example.invalid/",
      "/\r\n/example.invalid/",
      " /index.html",
      "\n//example.invalid/",
      "/index.html\u0000",
      "",
      "preview.html",
      "?view=solo",
      "#board",
    ]) {
      const response = await request(`&${new URLSearchParams({ next })}`);
      assert.equal(response.status, 400, JSON.stringify(next));
      assert.equal(response.headers.get("location"), null);
      assert.equal(response.headers.get("set-cookie"), null);
    }
    for (const next of [
      "/",
      "/index.html?mode=solo#board",
      "/preview.html?return=https%3A%2F%2Fexample.invalid%2F",
      "/preview.html?next=%252f%252fexample.invalid",
    ]) {
      const response = await request(`&${new URLSearchParams({ next })}`);
      assert.equal(response.status, 302);
      assert.equal(response.headers.get("location"), next);
      assert.ok(response.headers.get("set-cookie").startsWith(cookie));
      assert.equal(new URL(next, origin).origin, origin);
    }
    const missing = await request();
    assert.equal(missing.status, 302);
    assert.equal(missing.headers.get("location"), fallback);
    const first = await request(
      "&next=%2Findex.html&next=https%3A%2F%2Fexample.invalid",
    );
    assert.equal(first.headers.get("location"), "/index.html");
    const unsafeFirst = await request(
      "&next=https%3A%2F%2Fexample.invalid&next=%2Findex.html",
    );
    assert.equal(unsafeFirst.status, 400);
    assert.equal(unsafeFirst.headers.get("set-cookie"), null);
  }
});
