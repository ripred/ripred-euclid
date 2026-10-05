// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  paletteForScheme,
  paletteVariables,
  parseColorScheme,
} from "./player-palette";

function cssSource(file: string): string {
  return readFileSync(new URL(file, import.meta.url), "utf8");
}

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

  it.each(["", "yellow-purple", "AMBER-AMETHYST", " amber-amethyst "])(
    "rejects invalid color scheme %j",
    (value) => {
      expect(() => parseColorScheme(value)).toThrow("VITE_COLOR_SCHEME");
    },
  );

  it("keeps CSS default colors and literal fallbacks aligned with the default palette", () => {
    const variables = paletteVariables(paletteForScheme("red-blue"));
    const tokens = cssSource("./tokens.css");
    const declarations = Array.from(
      tokens.matchAll(/^\s*(--[\w-]+):\s*(#[\da-f]+);/gm),
    ).filter(([, token]) => token! in variables);
    expect(declarations).toHaveLength(14);
    for (const [, token, value] of declarations)
      expect(value, token).toBe(variables[token!]);

    const styles = ["./tokens.css", "./base.css", "../ui/board.css"]
      .map(cssSource)
      .join("\n");
    const fallbacks = Array.from(
      styles.matchAll(/var\((--[\w-]+),\s*(#[\da-f]{3,8}|rgb\([^)]*\))\)/gi),
    ).filter(([, token]) => token! in variables);
    expect(fallbacks).toHaveLength(15);
    for (const [, token, value] of fallbacks)
      expect(
        value!.replace(/^#([\da-f])([\da-f])([\da-f])$/i, "#$1$1$2$2$3$3"),
        token,
      ).toBe(variables[token!]);
  });

  it("uses neutral board focus while retaining the interface accent for controls", () => {
    const tokens = cssSource("./tokens.css");
    const input = cssSource("../ui/board-input.css");
    const base = cssSource("./base.css");
    expect(tokens).toMatch(/--board-focus-ring:\s*var\(--text\);/);
    expect(tokens).toMatch(
      /--focus-ring:\s*var\(--accent-focus, var\(--text\)\);/,
    );
    expect(input).toMatch(
      /\.game__cell:focus-visible\s*\{[^}]*var\(--board-focus-ring\)/,
    );
    expect(input).not.toContain("var(--focus-ring)");
    expect(base).toMatch(
      /:focus-visible\s*\{\s*outline:\s*2px solid var\(--focus-ring\)/,
    );
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

  it.each([
    ["red-blue", 0],
    ["amber-amethyst", 1],
  ] as const)(
    "selects the %s app accent independently of player one",
    (scheme, index) => {
      const palette = paletteForScheme(scheme);
      const variables = paletteVariables(palette);
      const accent = palette.players[index];
      expect(variables).toMatchObject({
        "--accent": accent.fill,
        "--accent-pressed": accent.pressed,
        "--accent-line": accent.line,
        "--accent-text-dark": accent.textDark,
        "--accent-text-light": accent.textLight,
        "--accent-on-color": accent.onColor,
        "--accent-focus":
          scheme === "amber-amethyst" ? "var(--accent-text)" : "var(--text)",
        "--accent-button-top": accent.buttonTop,
        "--accent-button-bottom": accent.buttonBottom,
        "--accent-button-lip": accent.buttonLip,
        "--red": palette.players[0].fill,
        "--blue": palette.players[1].fill,
      });
      if (scheme === "amber-amethyst")
        expect(variables["--accent"]).not.toBe(variables["--red"]);
    },
  );

  it.each(["red-blue", "amber-amethyst"] as const)(
    "keeps %s controls and focus visible in light and dark chrome",
    (scheme) => {
      const variables = paletteVariables(paletteForScheme(scheme));
      const surfaces = {
        dark: ["#111112", "#1b1b1d", "#242427", "#2f2f33"],
        light: ["#efefec", "#ffffff", "#f6f6f3", "#e7e7e3"],
      };
      for (const theme of ["dark", "light"] as const) {
        const control = variables[`--control-accent-${theme}`]!;
        const foreground = variables[`--control-on-accent-${theme}`]!;
        const text = variables[`--accent-text-${theme}`]!;
        expect(contrast(control, foreground)).toBeGreaterThanOrEqual(3);
        for (const surface of surfaces[theme]) {
          expect(contrast(control, surface)).toBeGreaterThanOrEqual(3);
          expect(contrast(text, surface)).toBeGreaterThanOrEqual(4.5);
        }
      }
      if (scheme === "amber-amethyst") {
        for (const stop of ["top", "bottom"])
          expect(
            contrast(
              variables[`--accent-button-${stop}`]!,
              variables["--accent-on-color"]!,
            ),
          ).toBeGreaterThanOrEqual(4.5);
      }
    },
  );

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

  it("distinguishes hint rings from ivory points", () => {
    for (const tone of paletteForScheme("amber-amethyst").players) {
      for (const background of ["#ffffff", "#ecebe7", "#b9b8b3"])
        expect(contrast(tone.hint, background)).toBeGreaterThanOrEqual(3);
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
    expect(root.style.getPropertyValue("--accent")).toBe("#5e3478");
    expect(root.style.getPropertyValue("--control-accent-dark")).toBe(
      "#d2afe4",
    );
    expect(root.style.getPropertyValue("--control-accent-light")).toBe(
      "#5e3478",
    );
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
