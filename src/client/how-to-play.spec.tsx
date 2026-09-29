// @vitest-environment jsdom
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { squareCatalog } from "../shared/game/geometry";
import { HowToPlay } from "./how-to-play";

describe("shared illustrated rules", () => {
  it.each(["list", "strip"] as const)(
    "shows a legal blocking move without claiming a scored square in %s layout",
    (layout) => {
      const host = document.createElement("div");
      host.innerHTML = renderToStaticMarkup(<HowToPlay layout={layout} />);
      const lessons = host.querySelectorAll(".lesson");
      expect(lessons).toHaveLength(4);
      const blocking = lessons[3]!;
      expect(blocking.querySelector("h3")?.textContent).toBe(
        "4Block your opponent",
      );
      expect(blocking.textContent).toContain("blocking alone scores no points");
      expect(blocking.querySelector(".board__band")).toBeNull();
      expect(blocking.querySelector(".board__blocked--2")).not.toBeNull();
      expect(
        blocking.querySelector(".board__marker--last")?.getAttribute("cx"),
      ).toBe("3.5");
      expect(
        blocking.querySelector(".board__marker--last")?.getAttribute("cy"),
      ).toBe("3.5");
      expect(
        blocking.querySelector("svg")?.getAttribute("aria-label"),
      ).toContain("red piece occupies its fourth corner");

      const cells = Array<number>(16).fill(0);
      for (const piece of Array.from(
        blocking.querySelectorAll(".board__piece"),
      )) {
        const disc = piece.querySelector(".board__piece-disc")!;
        const x = Number(disc.getAttribute("cx")) - 0.5;
        const y = Number(disc.getAttribute("cy")) - 0.5;
        cells[y * 4 + x] = piece.classList.contains("board__piece--1") ? 1 : 2;
      }
      expect(cells.filter((owner) => owner === 1)).toHaveLength(4);
      expect(cells.filter((owner) => owner === 2)).toHaveLength(3);
      expect([cells[5], cells[7], cells[13], cells[15]]).toEqual([2, 2, 2, 1]);
      expect(
        squareCatalog(4).some(
          ({ corners }) =>
            cells[corners[0]!] !== 0 &&
            corners.every((index) => cells[index] === cells[corners[0]!]),
        ),
      ).toBe(false);
    },
  );
});
