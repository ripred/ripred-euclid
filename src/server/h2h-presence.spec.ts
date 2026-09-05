import { describe, expect, it, vi } from "vitest";

import { createH2HCanonicalState, createInitialH2HBoard } from "./h2h";
import { resolveH2HPresence, type H2HPresenceReader } from "./h2h-presence";
import type { H2HMappingRead } from "./h2h-store";

function activeMapping(): H2HMappingRead {
  const gameId = "game-1";
  return {
    gameId,
    state: createH2HCanonicalState(
      gameId,
      createInitialH2HBoard("p1", "p2", { now: 1_000 }),
    ),
    isPlayer1: true,
  };
}

describe("resolveH2HPresence", () => {
  it("reports an existing mapping as active without reading the queue", async () => {
    const mapping = activeMapping();
    const reader: H2HPresenceReader = {
      getMapping: vi.fn().mockResolvedValue(mapping),
      isQueued: vi.fn().mockResolvedValue(false),
    };

    await expect(resolveH2HPresence(reader, "p1")).resolves.toEqual({
      state: "active",
      mapping,
    });
    expect(reader.isQueued).not.toHaveBeenCalled();
  });

  it.each([
    [true, "queued"],
    [false, "idle"],
  ] as const)("reports queue membership %s as %s", async (queued, state) => {
    const reader: H2HPresenceReader = {
      getMapping: vi.fn().mockResolvedValue(null),
      isQueued: vi.fn().mockResolvedValue(queued),
    };

    await expect(resolveH2HPresence(reader, "p1")).resolves.toEqual({ state });
    expect(reader.getMapping).toHaveBeenCalledTimes(2);
  });

  it("prefers a mapping created while queue membership is being read", async () => {
    const mapping = activeMapping();
    const getMapping = vi
      .fn<H2HPresenceReader["getMapping"]>()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(mapping);
    const reader: H2HPresenceReader = {
      getMapping,
      // A pairing transaction can remove this user from the queue before the
      // first mapping read is followed by the membership read.
      isQueued: vi.fn().mockResolvedValue(false),
    };

    await expect(resolveH2HPresence(reader, "p1")).resolves.toEqual({
      state: "active",
      mapping,
    });
    expect(getMapping).toHaveBeenCalledTimes(2);
  });
});
