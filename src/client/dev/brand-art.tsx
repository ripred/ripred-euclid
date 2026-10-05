/**
 * Euclid's subreddit and splash art as standalone SVG, rendered from the same
 * board components and design tokens the game uses. Development only: open
 * /dev/brand-assets.html under `npm run dev:local` to preview and export PNGs.
 */
import { renderToStaticMarkup } from "react-dom/server";
import type { CSSProperties } from "react";

import tokensCss from "../design/tokens.css?raw";
import boardCss from "../ui/board.css?raw";
import brandCss from "../ui/brand.css?raw";
import { MacroDiagram, MarkDiagram } from "../ui/Brand";
import { BoardDiagram } from "../ui/BoardDiagram";
import {
  paletteForScheme,
  paletteVariables,
  type ColorScheme,
} from "../design/player-palette";
import {
  PROPOSED_BRAND_SCENES,
  PROPOSED_SCENE_FRAMES,
  type BrandSceneName,
} from "./brand-scenes";

export const BRAND_ASSETS = {
  icon: {
    width: 300,
    height: 300,
    file: "subreddit/images/euclid_board_icon_300.png",
  },
  "banner-desktop": {
    width: 3168,
    height: 256,
    file: "subreddit/images/euclid_board_banner_desktop.png",
  },
  "banner-mobile": {
    width: 1592,
    height: 128,
    file: "subreddit/images/euclid_board_banner_mobile.png",
  },
  splash: { width: 1200, height: 900, file: "src/client/public/splash.jpg" },
} as const;

export type BrandAssetName = keyof typeof BRAND_ASSETS;

export const PROPOSED_BRAND_ASSETS = {
  icon: {
    width: 300,
    height: 300,
    file: "subreddit/images/euclid_amber_amethyst_icon_300.png",
  },
  "banner-desktop": {
    width: 3168,
    height: 256,
    file: "subreddit/images/euclid_amber_amethyst_banner_desktop.png",
  },
  "banner-mobile": {
    width: 1592,
    height: 128,
    file: "subreddit/images/euclid_amber_amethyst_banner_mobile.png",
  },
  splash: {
    width: 1200,
    height: 900,
    file: "src/client/public/splash-amber-amethyst.jpg",
  },
} as const;

export const brandAssetsForScheme = (scheme: ColorScheme) =>
  scheme === "amber-amethyst" ? PROPOSED_BRAND_ASSETS : BRAND_ASSETS;

// Fonts are not needed: the art carries no text.
const STYLES = [
  tokensCss.replace(/@import[^;]+;/g, ""),
  boardCss,
  brandCss,
].join("\n").concat(`
    svg.board { width: 100%; height: 100%; }
    .brand-proposal-grid .board__point { opacity: 0.36; }
    .brand-proposal-grid .board__grooves { opacity: 0.28; }
  `);

function proposalBoard(name: BrandSceneName) {
  const scene = PROPOSED_BRAND_SCENES[name];
  const frame = PROPOSED_SCENE_FRAMES[name];
  return (
    <svg {...frame}>
      {name === "icon" ? (
        <MarkDiagram scheme="amber-amethyst" />
      ) : (
        <BoardDiagram
          width={scene.width}
          height={scene.height}
          cells={scene.cells}
          squares={scene.squares}
          className="brand-proposal-grid"
          fit="contain"
        />
      )}
    </svg>
  );
}

function artElement(name: BrandAssetName, scheme: ColorScheme) {
  const { width, height } = brandAssetsForScheme(scheme)[name];
  const mark = Math.round(width * 0.66);
  const proposed = scheme === "amber-amethyst";
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      data-palette={scheme}
      style={paletteVariables(paletteForScheme(scheme)) as CSSProperties}
    >
      <style>{STYLES}</style>
      <defs>
        <radialGradient id="stage" cx="50%" cy="40%" r="75%">
          <stop offset="0%" stopColor="#34343b" />
          <stop offset="100%" stopColor="#141416" />
        </radialGradient>
        <radialGradient id="calm" cx="50%" cy="55%" r="70%">
          <stop offset="0%" stopColor="#0a0a0c" stopOpacity="0.72" />
          <stop offset="100%" stopColor="#0a0a0c" stopOpacity="0.28" />
        </radialGradient>
      </defs>
      <rect width={width} height={height} fill="url(#stage)" />
      {proposed && (name === "icon" || name === "splash") ? (
        proposalBoard(name)
      ) : name === "icon" ? (
        <svg
          x={(width - mark) / 2}
          y={(height - mark) / 2}
          width={mark}
          height={mark}
        >
          <MarkDiagram scheme="red-blue" />
        </svg>
      ) : (
        <svg x={0} y={0} width={width} height={height}>
          <MacroDiagram repeat={name === "splash" ? 1 : 2} />
        </svg>
      )}
      {/* The splash sits under Reddit's name, heading and button. */}
      {name === "splash" && !proposed ? (
        <rect width={width} height={height} fill="url(#calm)" />
      ) : null}
    </svg>
  );
}

export const brandAssetSvg = (
  name: BrandAssetName,
  scheme: ColorScheme = "red-blue",
) => renderToStaticMarkup(artElement(name, scheme));
