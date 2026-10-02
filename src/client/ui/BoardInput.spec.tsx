// @vitest-environment jsdom
import { act, useRef } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { BoardInput } from "./BoardInput";
import { useBoardInput } from "./use-board-input";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

describe("hint inspection input", () => {
  it("previews keyboard focus without placing and requires a second touch tap even on large cells", async () => {
    const place = vi.fn();
    const inspect = vi.fn();
    function Harness() {
      const gridRef = useRef<HTMLDivElement>(null);
      const controls = useBoardInput({
        width: 2,
        height: 2,
        cellSize: 50,
        enabled: true,
        confirmTouch: true,
        revision: 0,
        gridRef,
        isOpen: () => true,
        onPlace: place,
      });
      return (
        <BoardInput
          width={2}
          height={2}
          cellSize={50}
          controls={controls}
          label="Board"
          describeCell={String}
          onHover={inspect}
        />
      );
    }
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    try {
      await act(async () => root.render(<Harness />));
      const cell = host.querySelector<HTMLElement>('[data-index="0"]')!;
      await act(async () => cell.focus());
      expect(inspect).toHaveBeenCalledWith(0);
      expect(place).not.toHaveBeenCalled();
      const pointer = new Event("pointerdown", { bubbles: true });
      Object.defineProperty(pointer, "pointerType", { value: "touch" });
      await act(async () => {
        cell.dispatchEvent(pointer);
        cell.click();
      });
      expect(place).not.toHaveBeenCalled();
      await act(async () => cell.click());
      expect(place).toHaveBeenCalledExactlyOnceWith(0);
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  });
});
