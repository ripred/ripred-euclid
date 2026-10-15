// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi, type Mock } from "vitest";
import { Board, Player } from "../shared/game/engine";
import { GameScreen } from "./game-screen";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
afterEach(() => vi.unstubAllGlobals());

/** A phone-sized practice game with hints on and red pieces on `pieces`. */
async function withHintGame(
  pieces: readonly number[],
  run: (host: HTMLElement, onPlace: Mock) => Promise<void>,
) {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  vi.stubGlobal("getComputedStyle", () => ({
    paddingLeft: "0",
    paddingRight: "0",
    paddingTop: "0",
    paddingBottom: "0",
    marginLeft: "0",
    marginRight: "0",
  }));
  const board = new Board(new Player(), new Player(), { W: 8, H: 8 });
  for (const index of pieces) board.m_board[index] = 1;
  const onPlace = vi.fn();
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () =>
      root.render(
        <GameScreen
          board={board}
          viewport={{ width: 740, height: 870 }}
          exitLabel="Back"
          modeLabel="Practice"
          p1Name="You"
          p2Name="Euclid"
          midText="Your move"
          activeSide={1}
          placingSide={1}
          myColor={1}
          assistOn={true}
          scoreFeedback={null}
          futureScoreFeedback={[]}
          overlay={null}
          chatItems={[]}
          acceptPlacementKey={() => true}
          onCellClick={onPlace}
          onLeave={() => {}}
          onRules={() => {}}
        />,
      ),
    );
    await run(host, onPlace);
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
}

const hintValues = (host: HTMLElement) =>
  Array.from(
    host.querySelectorAll(".board__hint-value"),
    (label) => label.textContent,
  );

const focusPoint = (host: HTMLElement, index: number) =>
  act(async () =>
    host.querySelector<HTMLElement>(`[data-index="${index}"]`)!.focus(),
  );

/** Touches the centre of a point on the board, or lifts the finger. */
async function touch(host: HTMLElement, type: string, index?: number) {
  const grid = host.querySelector<HTMLElement>(".game__grid")!;
  const cell = parseFloat(grid.style.gridAutoRows);
  const point =
    index === undefined
      ? null
      : {
          clientX: ((index % 8) + 0.5) * cell,
          clientY: (Math.floor(index / 8) + 0.5) * cell,
        };
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, "touches", { value: { item: () => point } });
  await act(async () => grid.dispatchEvent(event));
  return event;
}

describe("game hint values", () => {
  it("shows only one-move square values when an owned piece receives focus without placing", async () => {
    await withHintGame([0, 3, 7, 24], async (host, onPlace) => {
      await focusPoint(host, 0);
      expect(hintValues(host)).toEqual(["16"]);
      expect(
        host.querySelector('[data-index="27"]')!.getAttribute("aria-label"),
      ).toContain("potential square values 16 points");
      expect(onPlace).not.toHaveBeenCalled();
    });
  });

  it("does not preview scores or create a placement prompt for an open point", async () => {
    await withHintGame([0, 3, 24], async (host, onPlace) => {
      await focusPoint(host, 27);
      expect(host.querySelector(".game__aim")).toBeNull();
      expect(hintValues(host)).toEqual([]);
      expect(onPlace).not.toHaveBeenCalled();
    });
  });

  it("places the first touch tap immediately and clears inspected hints", async () => {
    await withHintGame([0, 3, 24], async (host, onPlace) => {
      await focusPoint(host, 0);
      expect(hintValues(host)).toEqual(["16"]);
      const point = host.querySelector<HTMLElement>('[data-index="27"]')!;
      await act(async () => {
        const pointer = new Event("pointerdown", { bubbles: true });
        Object.defineProperty(pointer, "pointerType", { value: "touch" });
        point.dispatchEvent(pointer);
        point.focus();
        point.click();
      });
      expect(onPlace).toHaveBeenCalledExactlyOnceWith(3, 3);
      expect(hintValues(host)).toEqual([]);
      expect(host.querySelector(".game__aim")).toBeNull();
    });
  });

  it("holds the page still only while a touch presses the player's own piece", async () => {
    await withHintGame([0, 3, 7, 24], async (host) => {
      expect((await touch(host, "touchstart", 0)).defaultPrevented).toBe(true);
      expect(hintValues(host)).toEqual(["16"]);
      await touch(host, "touchend");
      expect(hintValues(host)).toEqual([]);
      expect((await touch(host, "touchstart", 27)).defaultPrevented).toBe(
        false,
      );
      expect(hintValues(host)).toEqual([]);
    });
  });
});
