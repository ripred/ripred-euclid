// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { ChallengeTimer } from "./ChallengeTimer";
import type { ChallengeSnapshot } from "../shared/challenge";

it("advances from server elapsed time, ignores wall-clock edits, freezes, and restarts", async () => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers({
    toFake: ["Date", "performance", "setInterval", "clearInterval"],
  });
  const host = document.createElement("div"),
    root = createRoot(host);
  const snapshot: ChallengeSnapshot = {
    puzzleId: "p",
    attemptId: "a",
    revision: 1,
    puzzle: {
      version: 1,
      size: 8,
      initial: [0, 1, 8],
      blocked: [],
      minimumMoves: 1,
      targetSquares: 1,
    },
    placements: [],
    completedSquares: [],
    complete: false,
    bestMoves: null,
    bestElapsedMs: null,
    startedAt: 1000,
    finishedAt: null,
    elapsedMs: 1200,
  };
  try {
    await act(async () => root.render(<ChallengeTimer snapshot={snapshot} />));
    expect(host.textContent).toBe("Elapsed 0:01.2");
    await act(async () => {
      vi.setSystemTime(90000000);
      vi.advanceTimersByTime(1000);
    });
    expect(host.textContent).toBe("Elapsed 0:02.2");
    await act(async () =>
      root.render(
        <ChallengeTimer
          snapshot={{
            ...snapshot,
            complete: true,
            elapsedMs: 2300,
            finishedAt: 3300,
          }}
        />,
      ),
    );
    await act(async () => vi.advanceTimersByTime(10000));
    expect(host.textContent).toBe("Solved in 0:02.3");
    await act(async () =>
      root.render(
        <ChallengeTimer
          snapshot={{ ...snapshot, attemptId: "b", elapsedMs: 0 }}
        />,
      ),
    );
    await act(async () => vi.advanceTimersByTime(500));
    expect(host.textContent).toBe("Elapsed 0:00.5");
  } finally {
    await act(async () => root.unmount());
    vi.useRealTimers();
  }
});
