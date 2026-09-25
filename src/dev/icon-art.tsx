/**
 * Euclid's app icons as standalone SVG, rendered from the same board
 * components and design tokens the game uses. Development only: with
 * `npm run dev` running, open /src/dev/icons.html to preview and export.
 */
import { renderToStaticMarkup } from "react-dom/server";

import tokensCss from "../design/tokens.css?raw";
import boardCss from "../ui/board.css?raw";
import brandCss from "../ui/brand.css?raw";
import { MarkDiagram } from "../ui/Brand";

/**
 * `mark` is the logo's share of the canvas. Maskable icons keep it inside the
 * central safe zone that every platform's mask leaves visible.
 */
export const APP_ICONS = {
  "icon.svg": { size: 512, mark: 0.7, rounded: true },
  "icon-192.png": { size: 192, mark: 0.7, rounded: false },
  "icon-512.png": { size: 512, mark: 0.7, rounded: false },
  "icon-maskable-512.png": { size: 512, mark: 0.52, rounded: false },
  "apple-touch-icon.png": { size: 180, mark: 0.66, rounded: false },
} as const;

export type AppIconFile = keyof typeof APP_ICONS;

// Fonts are not needed: the art carries no text.
const STYLES = [
  tokensCss.replace(/@font-face\s*{[^}]*}/g, ""),
  boardCss,
  brandCss,
]
  .join("\n")
  .concat("svg.board { width: 100%; height: 100%; }");

function iconElement(file: AppIconFile) {
  const { size, mark, rounded } = APP_ICONS[file];
  const markSize = Math.round(size * mark);
  const radius = rounded ? size * 0.22 : 0;
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
    >
      <style>{STYLES}</style>
      <defs>
        <radialGradient id="stage" cx="50%" cy="40%" r="75%">
          <stop offset="0%" stopColor="#34343b" />
          <stop offset="100%" stopColor="#141416" />
        </radialGradient>
      </defs>
      <rect width={size} height={size} rx={radius} fill="url(#stage)" />
      <svg
        x={(size - markSize) / 2}
        y={(size - markSize) / 2}
        width={markSize}
        height={markSize}
      >
        <MarkDiagram />
      </svg>
    </svg>
  );
}

export const appIconSvg = (file: AppIconFile) =>
  renderToStaticMarkup(iconElement(file));
