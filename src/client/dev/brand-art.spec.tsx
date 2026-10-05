// @vitest-environment jsdom
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { squareCatalog } from "../../shared/game/geometry";
import { paletteForScheme, paletteVariables } from "../design/player-palette";
import { BrandMark, MarkDiagram } from "../ui/Brand";
import { MARK_CELLS, MARK_SQUARES } from "../ui/brand-boards";
import {
  BRAND_ASSETS,
  PROPOSED_BRAND_ASSETS,
  brandAssetSvg,
  type BrandAssetName,
} from "./brand-art";
import {
  PROPOSED_BRAND_SCENES,
  PROPOSED_SCENE_FRAMES,
  type BrandSceneName,
} from "./brand-scenes";

const names = Object.keys(BRAND_ASSETS) as BrandAssetName[];
const sceneNames = Object.keys(PROPOSED_BRAND_SCENES) as BrandSceneName[];
const parseSvg = (source: string) =>
  new DOMParser().parseFromString(source, "image/svg+xml");

function withoutPaletteAndGeneratedIds(document: Document): string {
  const root = document.documentElement;
  root.removeAttribute("data-palette");
  const style = (root as unknown as SVGSVGElement).style;
  for (const key of Object.keys(paletteVariables(paletteForScheme("red-blue"))))
    style.removeProperty(key);
  if (!style.length) root.removeAttribute("style");
  const ids = new Map(
    Array.from(
      root.querySelectorAll(".board > defs [id]"),
      (element, index) => [element.id, `asset-id-${index}`],
    ),
  );
  for (const element of [root, ...Array.from(root.querySelectorAll("*"))]) {
    for (const attribute of Array.from(element.attributes)) {
      let value = attribute.value;
      if (attribute.name === "id") value = ids.get(value) ?? value;
      else {
        for (const [id, normalized] of ids)
          value = value.replaceAll(`url(#${id})`, `url(#${normalized})`);
      }
      element.setAttribute(attribute.name, value);
    }
  }
  return new XMLSerializer().serializeToString(root);
}

describe("proposal scene geometry", () => {
  it.each([
    ["icon", 5, 1],
    ["splash", 12, 2],
  ] as const)(
    "draws every real completed square in %s without invented ones",
    (name, pieces, completed) => {
      const scene = PROPOSED_BRAND_SCENES[name];
      expect(scene.cells).toHaveLength(scene.width * scene.height);
      expect(scene.cells.filter(Boolean)).toHaveLength(pieces);
      const actual = squareCatalog(scene.width, scene.height)
        .filter(({ corners }) => {
          const owner = scene.cells[corners[0]!];
          return (
            owner && corners.every((index) => scene.cells[index] === owner)
          );
        })
        .map(({ id }) => id)
        .sort();
      const drawn = scene.squares
        .map((square) => {
          expect(square.tone).toBe("history");
          for (const point of square.corners) {
            expect(point.x).toBeGreaterThanOrEqual(0);
            expect(point.x).toBeLessThan(scene.width);
            expect(point.y).toBeGreaterThanOrEqual(0);
            expect(point.y).toBeLessThan(scene.height);
            expect(scene.cells[point.y * scene.width + point.x]).toBe(
              square.owner,
            );
          }
          return square.corners
            .map(({ x, y }) => y * scene.width + x)
            .sort((a, b) => a - b)
            .join("-");
        })
        .sort();
      expect(actual).toHaveLength(completed);
      expect(drawn).toEqual(actual);
    },
  );

  it("leaves the icon centre open and keeps the legacy icon intact", () => {
    expect(PROPOSED_BRAND_SCENES.icon.cells[4]).toBe(0);
    expect(PROPOSED_BRAND_SCENES.icon.cells[8]).toBe(2);
    expect(MARK_CELLS).toEqual([1, 0, 1, 0, 2, 0, 1, 0, 1]);
    expect(MARK_SQUARES).toHaveLength(1);
    expect(renderToStaticMarkup(createElement(MarkDiagram))).toBe(
      renderToStaticMarkup(createElement(MarkDiagram, { scheme: "red-blue" })),
    );
  });

  it.each(sceneNames)(
    "contains the entire %s board inside its asset",
    (name) => {
      const frame = PROPOSED_SCENE_FRAMES[name];
      const asset = PROPOSED_BRAND_ASSETS[name];
      expect(frame.x).toBeGreaterThanOrEqual(0);
      expect(frame.y).toBeGreaterThanOrEqual(0);
      expect(frame.x + frame.width).toBeLessThanOrEqual(asset.width);
      expect(frame.y + frame.height).toBeLessThanOrEqual(asset.height);
      expect(brandAssetSvg(name, "amber-amethyst")).not.toContain(
        "xMidYMid slice",
      );
    },
  );
});

describe("standalone brand art", () => {
  it.each(["banner-desktop", "banner-mobile"] as const)(
    "preserves all original %s geometry, material styles and cropping across palettes",
    (name) => {
      const original = parseSvg(brandAssetSvg(name, "red-blue"));
      const proposed = parseSvg(brandAssetSvg(name, "amber-amethyst"));
      expect(proposed.documentElement.getAttribute("style")).not.toBe(
        original.documentElement.getAttribute("style"),
      );
      for (const document of [original, proposed]) {
        const board = document.querySelector(".board");
        expect(board?.getAttribute("viewBox")?.split(" ").map(Number)).toEqual([
          -0.12,
          -0.12,
          expect.closeTo(28.24, 8),
          5.34,
        ]);
        expect(board?.getAttribute("preserveAspectRatio")).toBe(
          "xMidYMid slice",
        );
        expect(board?.querySelectorAll(".board__piece-disc")).toHaveLength(44);
        expect(board?.querySelectorAll(".board__piece--1")).toHaveLength(24);
        expect(board?.querySelectorAll(".board__piece--2")).toHaveLength(20);
        expect(board?.querySelectorAll(".board__point-cap")).toHaveLength(96);
        expect(board?.querySelectorAll(".board__band")).toHaveLength(6);
        expect(board?.querySelectorAll(".board__grooves line")).toHaveLength(
          33,
        );
        expect(board?.parentElement?.getAttribute("x")).toBe("0");
        expect(board?.parentElement?.getAttribute("y")).toBe("0");
        expect(board?.parentElement?.getAttribute("width")).toBe(
          String(BRAND_ASSETS[name].width),
        );
        expect(board?.parentElement?.getAttribute("height")).toBe(
          String(BRAND_ASSETS[name].height),
        );
        expect(document.querySelector("mask")).toBeNull();
        expect(document.querySelector(".brand-proposal-grid")).toBeNull();
      }
      expect(withoutPaletteAndGeneratedIds(proposed)).toBe(
        withoutPaletteAndGeneratedIds(original),
      );
    },
  );

  it.each(["red-blue", "amber-amethyst"] as const)(
    "embeds every %s color token without depending on the page",
    (scheme) => {
      for (const name of names) {
        const source = brandAssetSvg(name, scheme);
        const document = parseSvg(source);
        expect(document.querySelector("parsererror")).toBeNull();
        const svg = document.documentElement as unknown as SVGSVGElement;
        expect(svg.getAttribute("data-palette")).toBe(scheme);
        for (const [key, value] of Object.entries(
          paletteVariables(paletteForScheme(scheme)),
        ))
          expect(svg.style.getPropertyValue(key)).toBe(value);
        expect(svg.querySelector("text")).toBeNull();
        expect(source).not.toContain("@import");
      }
    },
  );

  it("keeps old filenames and defaults separate from proposal exports", () => {
    expect(BRAND_ASSETS.icon.file).toBe(
      "subreddit/images/euclid_board_icon_300.png",
    );
    expect(BRAND_ASSETS.splash.file).toBe("src/client/public/splash.jpg");
    for (const name of names) {
      expect(brandAssetSvg(name)).toBe(brandAssetSvg(name, "red-blue"));
      expect(PROPOSED_BRAND_ASSETS[name].file).not.toBe(
        BRAND_ASSETS[name].file,
      );
      expect(PROPOSED_BRAND_ASSETS[name].width).toBe(BRAND_ASSETS[name].width);
      expect(PROPOSED_BRAND_ASSETS[name].height).toBe(
        BRAND_ASSETS[name].height,
      );
    }
    expect(brandAssetSvg("banner-desktop")).toContain("xMidYMid slice");
  });

  it("uses the same proposed mark in an app header and the icon export", () => {
    const app = parseSvg(
      renderToStaticMarkup(
        createElement(BrandMark, { scheme: "amber-amethyst" }),
      ),
    );
    const art = parseSvg(brandAssetSvg("icon", "amber-amethyst"));
    const discs = (document: Document) =>
      Array.from(document.querySelectorAll(".board__piece-disc")).map(
        (disc) => `${disc.getAttribute("cx")},${disc.getAttribute("cy")}`,
      );
    expect(discs(app)).toEqual(discs(art));
    expect(discs(app)).toHaveLength(5);
  });
});
