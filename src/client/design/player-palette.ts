import { parseColorScheme, type ColorScheme } from "./color-scheme";

export { parseColorScheme, type ColorScheme } from "./color-scheme";

interface PlayerTone {
  name: string;
  fill: string;
  pressed: string;
  line: string;
  highlight: string;
  middle: string;
  shadow: string;
  rim: string;
  groove: string;
  flash: string;
  hint: string;
  textDark: string;
  textLight: string;
  buttonTop: string;
  buttonBottom: string;
  buttonLip: string;
  onColor: string;
}

export interface PlayerPalette {
  scheme: ColorScheme;
  players: readonly [PlayerTone, PlayerTone];
}

const PALETTES: Record<ColorScheme, PlayerPalette> = {
  "red-blue": {
    scheme: "red-blue",
    players: [
      {
        name: "Red",
        fill: "#e8341f",
        pressed: "#c92a17",
        line: "#f0594b",
        highlight: "#ff9c82",
        middle: "#f2452c",
        shadow: "#c7270f",
        rim: "#8c170a",
        groove: "rgb(90 14 2 / 0.55)",
        flash: "#ffd2c7",
        hint: "#e8341f",
        textDark: "#ff7d6c",
        textLight: "#c4260f",
        buttonTop: "#f75b43",
        buttonBottom: "#de341c",
        buttonLip: "#8e1a0b",
        onColor: "#ffffff",
      },
      {
        name: "Blue",
        fill: "#1f3fe0",
        pressed: "#1832bd",
        line: "#5b6cff",
        highlight: "#9aabff",
        middle: "#3a5bf2",
        shadow: "#1c35c9",
        rim: "#101d7d",
        groove: "rgb(4 10 60 / 0.55)",
        flash: "#d3dbff",
        hint: "#1f3fe0",
        textDark: "#93a1ff",
        textLight: "#1f3fe0",
        buttonTop: "#4d6bff",
        buttonBottom: "#2345e6",
        buttonLip: "#0f1d7c",
        onColor: "#ffffff",
      },
    ],
  },
  "amber-amethyst": {
    scheme: "amber-amethyst",
    players: [
      {
        name: "Amber",
        fill: "#fbb80f",
        pressed: "#d69808",
        line: "#ffd05a",
        highlight: "#ffe39b",
        middle: "#fbb80f",
        shadow: "#c48705",
        rim: "#785000",
        groove: "rgb(83 52 0 / 0.6)",
        flash: "#fff0c9",
        hint: "#795400",
        textDark: "#ffd05a",
        textLight: "#795400",
        buttonTop: "#ffc63c",
        buttonBottom: "#edaa08",
        buttonLip: "#875900",
        onColor: "#281c04",
      },
      {
        name: "Amethyst",
        fill: "#5e3478",
        pressed: "#48265e",
        line: "#c39adb",
        highlight: "#c69cdd",
        middle: "#78458f",
        shadow: "#5e3478",
        rim: "#351d46",
        groove: "rgb(38 14 54 / 0.6)",
        flash: "#ecd8f5",
        hint: "#5e3478",
        textDark: "#d2afe4",
        textLight: "#5e3478",
        buttonTop: "#805194",
        buttonBottom: "#5e3478",
        buttonLip: "#351d46",
        onColor: "#ffffff",
      },
    ],
  },
};

export const paletteForScheme = (scheme: ColorScheme): PlayerPalette =>
  PALETTES[scheme];

/** The build chooses the player names and their rendering tokens together. */
export const PLAYER_PALETTE = paletteForScheme(
  parseColorScheme(import.meta.env.VITE_COLOR_SCHEME),
);

export function playerName(owner: 1 | 2, titleCase = false): string {
  const name = PLAYER_PALETTE.players[owner - 1]!.name;
  return titleCase ? name : name.toLowerCase();
}

/** Stable aliases retain the same player slots in every palette. */
export function paletteVariables(
  palette: PlayerPalette,
): Record<string, string> {
  const playerVariables = Object.fromEntries(
    palette.players.flatMap((tone, index) => {
      const slot = index === 0 ? "red" : "blue";
      return Object.entries({
        [`--${slot}`]: tone.fill,
        [`--${slot}-pressed`]: tone.pressed,
        [`--${slot}-line`]: tone.line,
        [`--${slot}-hint`]: tone.hint,
        [`--${slot}-text-dark`]: tone.textDark,
        [`--${slot}-text-light`]: tone.textLight,
        [`--${slot}-on-color`]: tone.onColor,
        [`--piece-${slot}-hi`]: tone.highlight,
        [`--piece-${slot}-mid`]: tone.middle,
        [`--piece-${slot}-lo`]: tone.shadow,
        [`--piece-${slot}-rim`]: tone.rim,
        [`--piece-${slot}-groove`]: tone.groove,
        [`--piece-${slot}-flash`]: tone.flash,
        [`--button-${slot}-top`]: tone.buttonTop,
        [`--button-${slot}-bottom`]: tone.buttonBottom,
        [`--button-${slot}-lip`]: tone.buttonLip,
      });
    }),
  );
  const purpleAccent = palette.scheme === "amber-amethyst";
  const accent = palette.players[purpleAccent ? 1 : 0];
  return {
    ...playerVariables,
    "--accent": accent.fill,
    "--accent-pressed": accent.pressed,
    "--accent-line": accent.line,
    "--accent-gradient-end": purpleAccent
      ? accent.line
      : palette.players[1].fill,
    "--accent-token": purpleAccent ? "var(--token-blue)" : "var(--token-red)",
    "--action-highlight": purpleAccent ? accent.line : "var(--attention)",
    "--accent-text-dark": accent.textDark,
    "--accent-text-light": accent.textLight,
    "--accent-on-color": accent.onColor,
    "--accent-focus": purpleAccent ? "var(--accent-text)" : "var(--text)",
    "--accent-button-top": accent.buttonTop,
    "--accent-button-bottom": accent.buttonBottom,
    "--accent-button-lip": accent.buttonLip,
    "--control-accent-dark": purpleAccent ? accent.textDark : accent.fill,
    "--control-on-accent-dark": purpleAccent ? accent.fill : accent.onColor,
    "--control-accent-light": accent.fill,
    "--control-on-accent-light": accent.onColor,
  };
}

export function initializePlayerPalette(root: HTMLElement) {
  root.dataset.playerPalette = PLAYER_PALETTE.scheme;
  for (const [key, value] of Object.entries(paletteVariables(PLAYER_PALETTE)))
    root.style.setProperty(key, value);
}
