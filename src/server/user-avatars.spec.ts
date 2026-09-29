import { describe, expect, it, vi } from "vitest";
import { UserAvatars } from "./user-avatars";
import { MemoryRedis } from "./testing/memory-redis";

const first =
  "https://www.redditstatic.com/avatars/defaults/v2/avatar_default_0.png";
const second = "https://i.redd.it/snoovatar/avatars/example.png";
const SIX_HOURS = 6 * 60 * 60 * 1000;

describe("public avatar lookup", () => {
  it("normalizes handles, coalesces concurrent lookups, and shares cached results across instances", async () => {
    let now = 1000;
    const redis = new MemoryRedis(() => now);
    const lookup = vi.fn().mockResolvedValue(first);
    const avatars = new UserAvatars(redis, lookup, () => now);
    expect(
      await Promise.all([avatars.get("u/Player"), avatars.get(" player ")]),
    ).toEqual([first, first]);
    expect(lookup).toHaveBeenCalledExactlyOnceWith("player");
    expect(await new UserAvatars(redis, lookup, () => now).get("PLAYER")).toBe(
      first,
    );
    expect(lookup).toHaveBeenCalledTimes(1);
    now += SIX_HOURS;
    lookup.mockResolvedValue(second);
    expect(await avatars.get("player")).toBe(second);
    expect(lookup).toHaveBeenCalledTimes(2);
  });

  it("caches missing avatars and clears an old image after a successful empty lookup", async () => {
    let now = 1000;
    const lookup = vi
      .fn()
      .mockResolvedValueOnce(first)
      .mockResolvedValue(undefined);
    const avatars = new UserAvatars(
      new MemoryRedis(() => now),
      lookup,
      () => now,
    );
    expect(await avatars.get("player")).toBe(first);
    now += SIX_HOURS;
    expect(await avatars.get("player")).toBeNull();
    expect(await avatars.get("player")).toBeNull();
    expect(lookup).toHaveBeenCalledTimes(2);
    now += 15 * 60 * 1000;
    await avatars.get("player");
    expect(lookup).toHaveBeenCalledTimes(3);
  });

  it("retains the last known image during an outage and briefly backs off", async () => {
    let now = 1000;
    const lookup = vi.fn().mockResolvedValue(first);
    const avatars = new UserAvatars(
      new MemoryRedis(() => now),
      lookup,
      () => now,
    );
    await avatars.get("player");
    now += SIX_HOURS;
    lookup.mockRejectedValue(new Error("Unavailable"));
    expect(await avatars.get("player")).toBe(first);
    expect(await avatars.get("player")).toBe(first);
    expect(lookup).toHaveBeenCalledTimes(2);
    await expect(avatars.get("new_player")).rejects.toThrow("Unavailable");
    lookup.mockResolvedValue(second);
    expect(await avatars.get("new_player")).toBe(second);
  });

  it.each(["[deleted]", "../player", "", "anonymous", "x".repeat(21)])(
    "rejects an invalid handle %s before calling Reddit",
    async (name) => {
      const lookup = vi.fn();
      await expect(
        new UserAvatars(new MemoryRedis(), lookup).get(name),
      ).rejects.toThrow("Invalid");
      expect(lookup).not.toHaveBeenCalled();
    },
  );

  it("returns only secure image URLs and decodes escaped query separators", async () => {
    const lookup = vi
      .fn()
      .mockResolvedValueOnce("data:text/html,invalid")
      .mockResolvedValueOnce(`${second}?size=72&amp;format=png`);
    const avatars = new UserAvatars(new MemoryRedis(), lookup);
    expect(await avatars.get("one")).toBeNull();
    expect(await avatars.get("two")).toBe(`${second}?size=72&format=png`);
  });
});
