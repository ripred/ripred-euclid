/**
 * Euclid's subreddit and splash art as standalone SVG, rendered from the same
 * board components and design tokens the game uses. Development only: open
 * /dev/brand-assets.html under `npm run dev:local` to preview and export PNGs.
 */
import { renderToStaticMarkup } from "react-dom/server";

import tokensCss from "../design/tokens.css?raw";
import boardCss from "../ui/board.css?raw";
import brandCss from "../ui/brand.css?raw";
import { MacroDiagram, MarkDiagram } from "../ui/Brand";

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

// Fonts are not needed: the art carries no text.
const STYLES = [tokensCss.replace(/@import[^;]+;/g, ""), boardCss, brandCss]
  .join("\n")
  .concat("svg.board { width: 100%; height: 100%; }");

function artElement(name: BrandAssetName) {
  const { width, height } = BRAND_ASSETS[name];
  const mark = Math.round(width * 0.66);
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
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
      {name === "icon" ? (
        <svg
          x={(width - mark) / 2}
          y={(height - mark) / 2}
          width={mark}
          height={mark}
        >
          <MarkDiagram />
        </svg>
      ) : (
        <svg x={0} y={0} width={width} height={height}>
          <MacroDiagram repeat={name === "splash" ? 1 : 2} />
        </svg>
      )}
      {/* The splash sits under Reddit's name, heading and button. */}
      {name === "splash" ? (
        <rect width={width} height={height} fill="url(#calm)" />
      ) : null}
    </svg>
  );
}

export const brandAssetSvg = (name: BrandAssetName) =>
  renderToStaticMarkup(artElement(name));
