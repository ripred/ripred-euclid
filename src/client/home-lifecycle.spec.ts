import { describe, expect, it } from "vitest";

import { isCurrentH2HRequest, resolveQueueRecovery } from "./home-lifecycle";

describe("authoritative queue recovery", () => {
  it.each([
    ["join", "idle", "idle", false, false, ""],
    ["join", "queued", "poll", true, true, "Searching for another redditor…"],
    ["join", "active", "enter", true, true, ""],
    ["cancel", "idle", "idle", true, true, "Search canceled."],
    [
      "cancel",
      "queued",
      "poll",
      false,
      false,
      "Searching for another redditor…",
    ],
    ["cancel", "active", "enter", false, false, ""],
  ] as const)(
    "%s reconciled as %s",
    (
      operation,
      state,
      action,
      operationCompleted,
      clearActionError,
      status,
    ) => {
      expect(resolveQueueRecovery(operation, state)).toEqual({
        action,
        operationCompleted,
        clearActionError,
        status,
      });
    },
  );
});

describe("H2H request identity", () => {
  it("rejects a response after its route session is invalidated", async () => {
    let resolveRequest!: () => void;
    const deferred = new Promise<void>((resolve) => {
      resolveRequest = resolve;
    });
    const request = { session: 4 };
    let currentSession = 4;
    const mayApply = deferred.then(() =>
      isCurrentH2HRequest(request, currentSession),
    );

    currentSession++;
    resolveRequest();

    await expect(mayApply).resolves.toBe(false);
  });

  it("requires both the session and game for match mutations", () => {
    const request = { session: 9, gameId: "game-a" };

    expect(isCurrentH2HRequest(request, 9, "game-a")).toBe(true);
    expect(isCurrentH2HRequest(request, 10, "game-a")).toBe(false);
    expect(isCurrentH2HRequest(request, 9, "game-b")).toBe(false);
  });
});
