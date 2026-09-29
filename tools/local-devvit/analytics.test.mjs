import assert from "node:assert/strict";
import { fileURLToPath, pathToFileURL } from "node:url";
import { test } from "node:test";
import { resolveConfig } from "vite";
import { createTelemetryClient } from "./analytics-client-shim.mjs";
import { createTelemetryRouter, telemetry } from "./analytics-server-shim.mjs";

const assertDisabled = (result) =>
  assert.equal(result.receipt.status, "JOURNEY_RECEIPT_DENIED_DISABLED");

test("local client telemetry never calls fetch or invents an accepted Journey", async (t) => {
  const fetch = t.mock.fn(() => {
    throw new Error("No local telemetry traffic");
  });
  t.mock.method(globalThis, "fetch", fetch);
  const client = createTelemetryClient({ fetch });
  assertDisabled(await client.appReady());
  const start = await client.startJourney();
  assertDisabled(start);
  assert.equal(start.journeyId, "");
  assertDisabled(await client.progress({ progress: 0.5 }));
  assertDisabled(await client.interaction({ action: "rules" }));
  client.setJourneyId("local-synthetic-id");
  assert.equal(client.getActiveJourneyId(), "local-synthetic-id");
  assertDisabled(await client.endJourney({ complete: true }));
  assert.equal(client.getActiveJourneyId(), undefined);
  assert.equal(fetch.mock.callCount(), 0);
});

test("local client preserves the injected session helper contract", async () => {
  let id = "restored-synthetic-id";
  const journeySession = {
    getActiveJourneyId: () => id,
    setJourneyId: (value) => {
      id = value;
    },
    clearJourneyId: () => {
      id = undefined;
    },
    isPersistent: () => false,
  };
  const client = createTelemetryClient({ journeySession });
  assert.equal(client.journeySession, journeySession);
  client.setJourneyId("another-synthetic-id");
  assert.equal(id, "another-synthetic-id");
  await client.endJourney();
  assert.equal(id, undefined);
});

test("local server telemetry has no real transport and always reports disabled", async (t) => {
  const fetch = t.mock.fn(() => {
    throw new Error("No local telemetry traffic");
  });
  t.mock.method(globalThis, "fetch", fetch);
  for (const method of Object.values(telemetry))
    assertDisabled(await method({}));
  assert.equal(fetch.mock.callCount(), 0);
  const router = createTelemetryRouter({ basePath: "/test-telemetry" });
  const route = router.stack.find((layer) => layer.route)?.route;
  assert.equal(route.path, "/test-telemetry/journey/:event");
  for (const event of [
    "start",
    "app-ready",
    "progress",
    "interaction",
    "end",
  ]) {
    let result;
    await route.stack[0].handle(
      { params: { event } },
      {
        json: (value) => {
          result = value;
        },
      },
    );
    assertDisabled(result);
    if (event === "start") assert.equal(result.journeyId, "");
  }
});

test("both local bundles replace the Reddit analytics entrypoint", async () => {
  for (const side of ["client", "server"]) {
    const config = await resolveConfig(
      {
        configFile: fileURLToPath(
          new URL(`./vite.${side}.config.mjs`, import.meta.url),
        ),
      },
      "build",
    );
    const alias = config.resolve.alias.find(
      (entry) => entry.find === `@devvit/analytics/${side}/reddit`,
    );
    assert.ok(alias, `The local ${side} must replace the real analytics SDK`);
    const module = await import(pathToFileURL(alias.replacement).href);
    assertDisabled(await module.telemetry.appReady());
    assert.equal((await module.telemetry.startJourney()).journeyId, "");
  }
});
