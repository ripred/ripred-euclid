// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Board, Player } from "../shared/game/engine";
import { GameScreen } from "./game-screen";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
afterEach(() => vi.unstubAllGlobals());

describe("game hint values", () => {
  it("shows all potential values when an owned piece receives focus without placing", async () => {
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
    for (const index of [0, 3, 7]) board.m_board[index] = 1;
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
      await act(async () =>
        host.querySelector<HTMLElement>('[data-index="0"]')!.focus(),
      );
      expect(
        Array.from(
          host.querySelectorAll(".board__hint-value"),
          (label) => label.textContent,
        ),
      ).toEqual(["16", "16", "64", "64"]);
      expect(
        host.querySelector('[data-index="24"]')!.getAttribute("aria-label"),
      ).toContain("potential square values 16 points");
      expect(onPlace).not.toHaveBeenCalled();
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  });
});
