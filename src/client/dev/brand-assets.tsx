/**
 * Development-only preview and export of the brand art in dev/brand-art.tsx.
 * Open /dev/brand-assets.html while `npm run dev:local` is running. Proposal
 * exports use separate filenames and leave the current artwork intact.
 */
import { useState } from "react";
import { createRoot } from "react-dom/client";

import {
  BRAND_ASSETS,
  brandAssetsForScheme,
  brandAssetSvg,
  type BrandAssetName,
} from "./brand-art";
import type { ColorScheme } from "../design/player-palette";
import "./brand-assets.css";

const svgUrl = (name: BrandAssetName, scheme: ColorScheme) =>
  `data:image/svg+xml;charset=utf-8,${encodeURIComponent(brandAssetSvg(name, scheme))}`;

async function exportImage(
  name: BrandAssetName,
  scheme: ColorScheme,
): Promise<void> {
  const { width, height, file } = brandAssetsForScheme(scheme)[name];
  const source = new Image(width, height);
  source.src = svgUrl(name, scheme);
  await source.decode();
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("The image canvas is unavailable.");
  context.drawImage(source, 0, 0, width, height);
  // Keep the splash format compatible with the current entry screen.
  const jpeg = file.endsWith(".jpg");
  const image = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (blob) =>
        blob ? resolve(blob) : reject(new Error("Image encoding failed.")),
      jpeg ? "image/jpeg" : "image/png",
      0.86,
    ),
  );
  const response = await fetch(
    `/__local/brand-asset?file=${encodeURIComponent(file)}`,
    { method: "POST", body: image },
  );
  if (!response.ok) throw new Error(await response.text());
}

const ASSET_LABELS: Record<BrandAssetName, string> = {
  icon: "Community icon",
  "banner-desktop": "Desktop banner",
  "banner-mobile": "Mobile banner",
  splash: "Entry splash",
};
const SCHEMES = ["red-blue", "amber-amethyst"] as const;
const SCHEME_LABELS: Record<ColorScheme, string> = {
  "red-blue": "Current red / blue",
  "amber-amethyst": "Proposed amber / amethyst",
};
const PREVIEWS = Object.fromEntries(
  SCHEMES.map((scheme) => [
    scheme,
    Object.fromEntries(
      (Object.keys(BRAND_ASSETS) as BrandAssetName[]).map((name) => [
        name,
        svgUrl(name, scheme),
      ]),
    ) as Record<BrandAssetName, string>,
  ]),
) as Record<ColorScheme, Record<BrandAssetName, string>>;

export function Gallery() {
  const [status, setStatus] = useState("");
  const [exporting, setExporting] = useState<ColorScheme | null>(null);
  const exportArtwork = async (scheme: ColorScheme) => {
    if (exporting) return;
    setExporting(scheme);
    setStatus(`Exporting ${SCHEME_LABELS[scheme].toLowerCase()} artwork...`);
    try {
      for (const name of Object.keys(BRAND_ASSETS) as BrandAssetName[])
        await exportImage(name, scheme);
      setStatus(
        scheme === "amber-amethyst"
          ? "Saved all four proposal images. Current artwork is unchanged."
          : "Saved all four current images. Proposal artwork is unchanged.",
      );
    } catch (error) {
      setStatus(`Export failed: ${String(error)}`);
    } finally {
      setExporting(null);
    }
  };
  return (
    <main className="asset-gallery">
      <header className="asset-gallery__header">
        <div>
          <p className="asset-gallery__eyebrow">Euclid / artwork comparison</p>
          <h1>The same board. A different palette.</h1>
          <p className="asset-gallery__intro">
            Matching banner geometry in both palettes, with a separate icon and
            splash proposal. All artwork uses the game's own pieces.
          </p>
        </div>
        <nav aria-label="Local previews">
          <a href="/preview.html">Game preview</a>
          <a href="/index.html">App entry</a>
        </nav>
      </header>
      <div className="asset-gallery__export">
        <button
          type="button"
          disabled={exporting !== null}
          onClick={() => void exportArtwork("red-blue")}
        >
          {exporting === "red-blue" ? "Exporting current..." : "Export current"}
        </button>
        <button
          type="button"
          disabled={exporting !== null}
          onClick={() => void exportArtwork("amber-amethyst")}
        >
          {exporting === "amber-amethyst"
            ? "Exporting proposal..."
            : "Export proposal"}
        </button>
        <p>Four exact-size images per palette, saved to separate filenames.</p>
        <output aria-live="polite">{status}</output>
      </div>
      {(Object.keys(BRAND_ASSETS) as BrandAssetName[]).map((name) => (
        <section
          className="asset-comparison"
          key={name}
          aria-labelledby={`heading-${name}`}
        >
          <div className="asset-comparison__heading">
            <h2 id={`heading-${name}`}>{ASSET_LABELS[name]}</h2>
            <p>
              {BRAND_ASSETS[name].width} × {BRAND_ASSETS[name].height}
            </p>
          </div>
          <div className="asset-comparison__pair">
            {SCHEMES.map((scheme) => (
              <figure className="asset-card" key={scheme} data-scheme={scheme}>
                <figcaption className="asset-card__label">
                  {SCHEME_LABELS[scheme]}
                </figcaption>
                <div className={`asset-card__frame asset-card__frame--${name}`}>
                  <img
                    src={PREVIEWS[scheme][name]}
                    alt={`${ASSET_LABELS[name]}: ${SCHEME_LABELS[scheme]}`}
                    width={BRAND_ASSETS[name].width}
                    height={BRAND_ASSETS[name].height}
                  />
                </div>
                <div className="asset-card__details">
                  <code>{brandAssetsForScheme(scheme)[name].file}</code>
                  <a
                    href={PREVIEWS[scheme][name]}
                    download={`euclid-${scheme}-${name}.svg`}
                  >
                    SVG source
                  </a>
                </div>
              </figure>
            ))}
          </div>
        </section>
      ))}
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<Gallery />);
