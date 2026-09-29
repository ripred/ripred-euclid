// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChallengeBoard } from "./ChallengeBoard";

let host: HTMLDivElement;
let root: Root;
let resize: (
  entries: { contentRect: { width: number; height: number } }[],
) => void;
const onPlace = vi.fn();

beforeEach(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  onPlace.mockReset();
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(notify: typeof resize) {
        resize = notify;
      }
      observe() {}
      disconnect() {}
    },
  );
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

async function render(fitToSpace = true) {
  await act(async () => {
    root.render(
      <ChallengeBoard
        puzzle={{
          version: 1,
          size: 8,
          initial: [],
          blocked: [],
          minimumMoves: 4,
          targetSquares: 1,
        }}
        revision="attempt:1"
        enabled
        fitToSpace={fitToSpace}
        onPlace={onPlace}
      />,
    );
  });
}

async function size(width: number, height: number) {
  await act(async () => resize([{ contentRect: { width, height } }]));
}

function footprint() {
  const board = host.querySelector<HTMLDivElement>(".challenge-board")!;
  const { width, height, marginLeft, marginRight, marginTop, marginBottom } =
    board.style;
  return {
    width: parseFloat(width) + parseFloat(marginLeft) + parseFloat(marginRight),
    height:
      parseFloat(height) + parseFloat(marginTop) + parseFloat(marginBottom),
    gridWidth: parseFloat(width),
  };
}

describe("ChallengeBoard space fitting", () => {
  it("fits the whole drawing after width-only and height-only slot changes", async () => {
    await render();
    await size(400, 240);
    expect(footprint().width).toBeLessThanOrEqual(400);
    expect(footprint().height).toBeLessThanOrEqual(240);
    const initialWidth = footprint().gridWidth;

    await size(400, 95);
    expect(footprint().height).toBeLessThanOrEqual(95);
    expect(footprint().gridWidth).toBeLessThan(initialWidth);
    // Short viewports must not retain the playground's 16px minimum cells.
    expect(footprint().gridWidth).toBeLessThan(8 * 16);

    await size(65, 95);
    expect(footprint().width).toBeLessThanOrEqual(65);
    expect(footprint().height).toBeLessThanOrEqual(95);

    await size(1200, 1000);
    expect(footprint().gridWidth).toBe(8 * 68);
  });

  it("reserves touch-confirmation text outside the measured board slot", async () => {
    await render();
    await size(240, 180);
    const hint = host.querySelector<HTMLParagraphElement>(
      ".challenge-board-fit__hint",
    )!;
    const container = host.querySelector(".challenge-board-container--fit")!;
    expect(container.contains(hint)).toBe(false);
    expect(hint.style.visibility).toBe("hidden");
    const initialWidth = footprint().gridWidth;
    const point = host.querySelector('[data-index="0"]')!;
    await act(async () => {
      const event = new MouseEvent("pointerdown", { bubbles: true });
      Object.defineProperty(event, "pointerType", { value: "touch" });
      point.dispatchEvent(event);
      point.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onPlace).not.toHaveBeenCalled();
    expect(hint.style.visibility).toBe("visible");
    expect(hint.textContent).toBe("Tap A1 again to place.");
    expect(footprint().gridWidth).toBe(initialWidth);
    await act(async () =>
      point.dispatchEvent(new MouseEvent("click", { bubbles: true })),
    );
    expect(onPlace).toHaveBeenCalledExactlyOnceWith(0);
  });

  it("keeps the moderator playground width-based sizing", async () => {
    await render(false);
    await size(240, 0);
    const board = host.querySelector<HTMLDivElement>(".challenge-board")!;
    expect(board.style.width).toBe("216px");
    expect(host.querySelector(".challenge-board-fit")).toBeNull();
    expect(host.querySelector(".field__hint")).toBeNull();
  });
});
