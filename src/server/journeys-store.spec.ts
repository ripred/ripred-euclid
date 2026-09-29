import { describe, expect, it } from "vitest";
import { JOURNEYS_INTERACTION_LIMIT } from "../shared/journeys";
import {
  JOURNEY_BINDING_TTL_MS,
  JourneysStore,
  journeyBindingKey,
} from "./journeys-store";
import { MemoryRedis } from "./testing/memory-redis";

const owner = { actor: "user:owner", postId: "post" };
const activity = { kind: "solo" as const, gameId: "game" };

describe("bounded Journey attempt ledger", () => {
  it("caps unique interactions and expires all binding data without indefinitely renewing it", async () => {
    let now = 100;
    const redis = new MemoryRedis(() => now),
      store = new JourneysStore(redis, () => now);
    await store.reserveStart(owner, "segment", activity);
    await store.finishStart(
      owner,
      "segment",
      "journey",
      "JOURNEY_RECEIPT_VALID",
    );
    for (let i = 0; i < JOURNEYS_INTERACTION_LIMIT; i++) {
      expect(
        await store.claim(owner, "segment", "journey", activity, {
          kind: "interaction",
          fingerprint: String(i),
        }),
      ).toBe(true);
    }
    expect(
      await store.claim(owner, "segment", "journey", activity, {
        kind: "interaction",
        fingerprint: "overflow",
      }),
    ).toBe(false);
    now += JOURNEY_BINDING_TTL_MS - 1;
    expect(await store.get(owner, "segment")).not.toBeNull();
    now++;
    expect(await store.get(owner, "segment")).toBeNull();
    expect(redis.value(journeyBindingKey(owner, "segment"))).toBeUndefined();
  });

  it("bounds start allocation per day even when requests obey minute limits", async () => {
    let now = 100;
    const redis = new MemoryRedis(() => now),
      store = new JourneysStore(redis, () => now);
    for (let i = 0; i < 256; i++) {
      await store.admit(owner, true);
      now += 60_001;
    }
    await expect(store.admit(owner, true)).rejects.toMatchObject({
      name: "RequestLimitError",
    });
  });

  it("never permits a concurrent claim to move an established round to another game", async () => {
    const store = new JourneysStore(new MemoryRedis());
    await store.reserveStart(owner, "segment", activity);
    await store.finishStart(
      owner,
      "segment",
      "journey",
      "JOURNEY_RECEIPT_VALID",
    );
    expect(
      await store.claim(
        owner,
        "segment",
        "journey",
        { kind: "solo", gameId: "other" },
        { kind: "end" },
      ),
    ).toBe(false);
    expect((await store.get(owner, "segment"))?.status).toBe("active");
  });

  it("rejects corrupt records instead of forwarding an unbound event", async () => {
    const redis = new MemoryRedis(),
      store = new JourneysStore(redis);
    redis.seed(
      journeyBindingKey(owner, "segment"),
      JSON.stringify({
        version: 1,
        expiresAt: Date.now() + 100_000,
        activity: { kind: "unknown" },
        status: "active",
      }),
    );
    await expect(store.get(owner, "segment")).rejects.toThrow(
      "Invalid Journey binding",
    );
  });
});
