// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChallengeScreen } from "./challenge-screen";
import {
  placeChallengePoint,
  type ChallengeSnapshot,
} from "../shared/challenge";

let root: Root, host: HTMLDivElement;
let current: ChallengeSnapshot | null;
let failGenerate: boolean;
let loseMoveReply: boolean;
const fresh = (): ChallengeSnapshot => ({
  puzzleId: "puzzle",
  attemptId: "attempt",
  revision: 1,
  puzzle: {
    version: 1,
    size: 8,
    initial: [0, 1],
    blocked: [63],
    minimumMoves: 2,
    targetSquares: 1,
  },
  placements: [],
  completedSquares: [],
  complete: false,
  bestMoves: null,
  startedAt: 0,
  finishedAt: null,
  elapsedMs: 0,
  bestElapsedMs: null,
});
const leave = vi.fn();
const requests: Array<{ action: string; body: Record<string, unknown> }> = [];

async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}
async function click(element: Element) {
  await act(async () => {
    element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  await settle();
}
function button(text: string) {
  const found = Array.from(host.querySelectorAll("button")).find(
    (b) => b.textContent === text,
  );
  expect(found, text).toBeTruthy();
  return found!;
}
function point(index: number) {
  return host.querySelector(`[data-index="${index}"]`)!;
}
async function input(label: string, value: string) {
  const element = Array.from(host.querySelectorAll("label"))
    .find((l) => l.textContent?.startsWith(label))!
    .querySelector("input")!;
  expect(element).toBeTruthy();
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!.call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

beforeEach(async () => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  current = null;
  failGenerate = false;
  loseMoveReply = false;
  requests.length = 0;
  leave.mockReset();
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const action = url.split("/").at(-1)!;
      const body = init?.body
        ? (JSON.parse(String(init.body)) as Record<string, unknown>)
        : {};
      requests.push({ action, body });
      if (action === "generate") {
        if (failGenerate)
          return {
            ok: false,
            json: async () => ({ message: "No certified puzzle found." }),
          };
        current = fresh();
      }
      if (action === "move" && current) {
        current = placeChallengePoint(current, body.point as number);
        if (loseMoveReply) {
          loseMoveReply = false;
          throw new Error("Connection lost");
        }
      }
      if (action === "restart" && current)
        current = {
          ...current,
          attemptId: "retry",
          revision: current.revision + 1,
          placements: [],
          completedSquares: [],
          complete: false,
        };
      if (action === "abandon") current = null;
      return { ok: true, json: async () => ({ snapshot: current }) };
    }),
  );
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => {
    root.render(<ChallengeScreen onLeave={leave} />);
  });
  await settle();
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

describe("challenge playground interactions", () => {
  it("edits numbers and blocks before generating and validates whole numbers", async () => {
    await input("Minimum moves", "2.5");
    expect(button("Generate").matches(":disabled")).toBe(true);
    await input("Minimum moves", "3");
    await input("Target squares", "4");
    await click(button("Edit blocked spots"));
    await click(point(63));
    expect(host.querySelectorAll(".board__blocked-point")).toHaveLength(1);
    await input("Total blocked spots", "3");
    await click(button("Generate"));
    expect(
      requests.find((r) => r.action === "generate")?.body.options,
    ).toMatchObject({
      minimumMoves: 3,
      targetSquares: 4,
      blockedPoints: [63],
      blockedCount: 3,
    });
    expect(host.textContent).toContain("Squares: 0 / 1");
  });
  it("allows extra placements, completes automatically and restarts without undo", async () => {
    await click(button("Generate"));
    await click(point(7));
    await click(point(8));
    await click(point(9));
    expect(host.textContent).toContain("Puzzle complete");
    expect(host.textContent).toContain("Pieces placed: 3");
    expect(host.textContent).toContain("Best completed attempt: 3 moves");
    const before = requests.filter((r) => r.action === "move").length;
    await click(point(10));
    expect(requests.filter((r) => r.action === "move")).toHaveLength(before);
    expect(
      Array.from(host.querySelectorAll("button")).some((b) =>
        /undo|hint|share|watch/i.test(b.textContent ?? ""),
      ),
    ).toBe(false);
    await click(button("Restart puzzle"));
    expect(host.textContent).toContain("Pieces placed: 0");
    expect(host.textContent).toContain("Best completed attempt: 3 moves");
  });
  it("confirms discarding and retains the board if generation fails", async () => {
    await click(button("Generate"));
    await click(point(7));
    await click(button("Restart puzzle"));
    expect(host.querySelector('[role="dialog"]')).not.toBeNull();
    await click(button("Keep playing"));
    expect(host.textContent).toContain("Pieces placed: 1");
    failGenerate = true;
    await click(button("Generate"));
    await click(button("Discard and continue"));
    expect(host.textContent).toContain("No certified puzzle found.");
    expect(host.textContent).toContain("Pieces placed: 1");
    await click(button("Leave playground"));
    await click(button("Discard and continue"));
    expect(leave).toHaveBeenCalledOnce();
  });
  it("reconciles a lost move reply and never submits blocked points", async () => {
    await click(button("Generate"));
    await click(point(63));
    expect(requests.some((r) => r.action === "move")).toBe(false);
    loseMoveReply = true;
    await click(point(8));
    expect(host.textContent).toContain("Pieces placed: 1");
    await click(point(8));
    expect(requests.filter((r) => r.action === "move")).toHaveLength(1);
  });
  it("requires a confirming second tap on small touch targets", async () => {
    // Re-mount with a phone-sized board measurement.
    await act(async () => root.unmount());
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(
          private notify: (
            entries: { contentRect: { width: number } }[],
          ) => void,
        ) {}
        observe() {
          this.notify([{ contentRect: { width: 240 } }]);
        }
        disconnect() {}
      },
    );
    root = createRoot(host);
    await act(async () => {
      root.render(<ChallengeScreen onLeave={leave} />);
    });
    await settle();
    await click(button("Generate"));
    async function tap(index: number) {
      await act(async () => {
        const event = new MouseEvent("pointerdown", { bubbles: true });
        Object.defineProperty(event, "pointerType", { value: "touch" });
        point(index).dispatchEvent(event);
      });
      await click(point(index));
    }
    await tap(8);
    expect(requests.filter((r) => r.action === "move")).toHaveLength(0);
    expect(host.textContent).toContain("Tap A2 again");
    await tap(8);
    expect(requests.filter((r) => r.action === "move")).toHaveLength(1);
  });
  it("lets the moderator leave when state recovery is unavailable", async () => {
    await click(button("Generate"));
    vi.mocked(fetch).mockRejectedValue(new Error("Offline"));
    await click(point(8));
    expect(button("Generate").matches(":disabled")).toBe(true);
    await click(button("Leave playground"));
    expect(leave).toHaveBeenCalledOnce();
  });
  it("supports keyboard navigation and ignores repeated placement keys", async () => {
    await click(button("Generate"));
    await act(async () => {
      (point(8) as HTMLElement).focus();
      point(8).dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }),
      );
    });
    expect(document.activeElement).toBe(point(9));
    await act(async () => {
      point(9).dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Enter",
          repeat: true,
          bubbles: true,
        }),
      );
    });
    expect(requests.some((r) => r.action === "move")).toBe(false);
    await act(async () => {
      point(9).dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      );
    });
    await settle();
    expect(host.textContent).toContain("Pieces placed: 1");
  });
});
