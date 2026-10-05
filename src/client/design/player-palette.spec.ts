// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  paletteForScheme,
  paletteVariables,
  parseColorScheme,
} from "./player-palette";

function contrast(first: string, second: string) {
  const luminance = (hex: string) => {
    const linear = [1, 3, 5].map((offset) => {
      const value = parseInt(hex.slice(offset, offset + 2), 16) / 255;
      return value <= 0.04045
        ? value / 12.92
        : ((value + 0.055) / 1.055) ** 2.4;
    });
    return linear[0]! * 0.2126 + linear[1]! * 0.7152 + linear[2]! * 0.0722;
  };
  const values = [luminance(first), luminance(second)];
  return (Math.max(...values) + 0.05) / (Math.min(...values) + 0.05);
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("build-time player palette", () => {
  it("keeps red-blue as the default and rejects unknown selections", () => {
    expect(parseColorScheme(undefined)).toBe("red-blue");
    expect(parseColorScheme("red-blue")).toBe("red-blue");
    expect(parseColorScheme("amber-amethyst")).toBe("amber-amethyst");
    expect(() => parseColorScheme("yellow-purple")).toThrow(
      "VITE_COLOR_SCHEME",
    );
    expect(
      paletteForScheme("red-blue").players.map((tone) => tone.fill),
    ).toEqual(["#e8341f", "#1f3fe0"]);
  });

  it("keeps owner aliases stable for rendering and exported artwork", () => {
    const variables = paletteVariables(paletteForScheme("amber-amethyst"));
    expect(variables).toMatchObject({
      "--red": "#fbb80f",
      "--blue": "#5e3478",
      "--red-text-light": "#795400",
      "--blue-line": "#c39adb",
      "--red-hint": "#795400",
      "--blue-hint": "#5e3478",
      "--piece-blue-rim": "#351d46",
    });
    expect(Object.keys(variables)).toEqual(
      Object.keys(paletteVariables(paletteForScheme("red-blue"))),
    );
  });

  it("keeps the proposed palette's text readable on light, dark, and colored surfaces", () => {
    for (const tone of paletteForScheme("amber-amethyst").players) {
      for (const background of ["#111112", "#1b1b1d", "#242427", "#2f2f33"])
        expect(contrast(tone.textDark, background)).toBeGreaterThanOrEqual(4.5);
      for (const background of ["#efefec", "#ffffff", "#f6f6f3", "#e7e7e3"])
        expect(contrast(tone.textLight, background)).toBeGreaterThanOrEqual(
          4.5,
        );
      for (const background of [tone.fill, tone.buttonTop, tone.buttonBottom])
        expect(contrast(tone.onColor, background)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("distinguishes hint rings from ivory points and checked switch thumbs from their track", () => {
    for (const tone of paletteForScheme("amber-amethyst").players) {
      for (const background of ["#ffffff", "#ecebe7", "#b9b8b3"])
        expect(contrast(tone.hint, background)).toBeGreaterThanOrEqual(3);
    }
    for (const scheme of ["red-blue", "amber-amethyst"] as const) {
      const first = paletteForScheme(scheme).players[0];
      expect(contrast(first.onColor, first.fill)).toBeGreaterThanOrEqual(3);
    }
    for (const tone of paletteForScheme("red-blue").players)
      expect(tone.hint).toBe(tone.fill);
  });

  it("initializes the chosen tokens without changing the light/dark theme", async () => {
    vi.stubEnv("VITE_COLOR_SCHEME", "amber-amethyst");
    vi.resetModules();
    const { initializePlayerPalette, playerName } = await import(
      "./player-palette"
    );
    const root = document.createElement("div");
    root.dataset.colorScheme = "light";
    root.dataset.theme = "light";
    initializePlayerPalette(root);
    expect(root.dataset.playerPalette).toBe("amber-amethyst");
    expect(root.dataset.colorScheme).toBe("light");
    expect(root.dataset.theme).toBe("light");
    expect(root.style.getPropertyValue("--red")).toBe("#fbb80f");
    expect(root.style.getPropertyValue("--blue")).toBe("#5e3478");
    expect(playerName(1)).toBe("amber");
    expect(playerName(2, true)).toBe("Amethyst");
  });

  it.each(["red-blue", "amber-amethyst"] as const)(
    "uses the %s names in tutorial, replay, and accessible board labels",
    async (scheme) => {
      vi.stubEnv("VITE_COLOR_SCHEME", scheme);
      vi.resetModules();
      const [{ HowToPlay }, { ScoreChips }, { ownerName }, { DEMO_STEPS }] =
        await Promise.all([
          import("../how-to-play"),
          import("../share-replay"),
          import("../ui/board-geometry"),
          import("../preview-demo"),
        ]);
      const [first, second] = paletteForScheme(scheme).players;
      const lesson = renderToStaticMarkup(createElement(HowToPlay));
      const scores = renderToStaticMarkup(
        createElement(ScoreChips, { scores: [4, 9] }),
      );
      expect(lesson).toContain(`marked ${first.name.toLowerCase()} piece`);
      expect(lesson).toContain(`${second.name} has three corners`);
      expect(scores).toContain(`>${first.name}</span>`);
      expect(scores).toContain(`>${second.name}</span>`);
      expect(ownerName(1)).toBe(first.name.toLowerCase());
      expect(ownerName(2)).toBe(second.name.toLowerCase());
      expect(DEMO_STEPS.find((step) => step.id === "straight")?.body).toContain(
        `${second.name} closes a straight square`,
      );
    },
  );
});
