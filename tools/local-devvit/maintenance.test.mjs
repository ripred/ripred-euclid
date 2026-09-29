import assert from "node:assert/strict";
import http from "node:http";
import { once } from "node:events";
import test from "node:test";
import { createLocalMaintenance } from "./maintenance.mjs";

test("maintenance runs trusted local POSTs and rejects ordinary browser requests", async (t) => {
  const errors = [];
  const maintenance = createLocalMaintenance({
    intervalMs: 20,
    reportError: (error) => errors.push(error),
  });
  let calls = 0;
  const server = http.createServer((req, res) => {
    assert.equal(req.url, maintenance.endpoint);
    if (!maintenance.authorized(req)) {
      res.writeHead(403).end();
      return;
    }
    calls++;
    res.writeHead(200).end("{}");
  });
  maintenance.attach(server);
  t.after(() => new Promise((resolve) => server.close(resolve)));
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const origin = `http://127.0.0.1:${server.address().port}`;
  const response = await fetch(`${origin}${maintenance.endpoint}`, {
    method: "POST",
  });
  assert.equal(response.status, 403);
  for (let retry = 0; calls < 2 && retry < 100; retry++)
    await new Promise((resolve) => setTimeout(resolve, 10));
  assert.ok(calls >= 2, "startup and recurring maintenance calls arrived");
  assert.deepEqual(errors, []);
});

test("maintenance does not overlap a slow scheduled request", async (t) => {
  const maintenance = createLocalMaintenance({
    intervalMs: 5,
    reportError: assert.fail,
  });
  let active = 0;
  let maxActive = 0;
  let calls = 0;
  const server = http.createServer((_req, res) => {
    active++;
    maxActive = Math.max(active, maxActive);
    calls++;
    setTimeout(() => {
      active--;
      res.writeHead(200).end();
    }, 25);
  });
  maintenance.attach(server);
  t.after(() => new Promise((resolve) => server.close(resolve)));
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  for (let retry = 0; calls < 2 && retry < 100; retry++)
    await new Promise((resolve) => setTimeout(resolve, 10));
  assert.ok(calls >= 2);
  assert.equal(maxActive, 1);
});
