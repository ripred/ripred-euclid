/**
 * Development-only preview and export of the brand art in dev/brand-art.tsx.
 * Open /dev/brand-assets.html while `npm run dev:local` is running; "Export
 * images" draws each image at its exact size and the local server saves it.
 */
import { useState } from "react";
import { createRoot } from "react-dom/client";

import { BRAND_ASSETS, brandAssetSvg, type BrandAssetName } from "./brand-art";

const svgUrl = (name: BrandAssetName) =>
  `data:image/svg+xml;charset=utf-8,${encodeURIComponent(brandAssetSvg(name))}`;

async function exportImage(name: BrandAssetName): Promise<void> {
  const { width, height, file } = BRAND_ASSETS[name];
  const source = new Image(width, height);
  source.src = svgUrl(name);
  await source.decode();
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  canvas.getContext("2d")!.drawImage(source, 0, 0, width, height);
  // Photographic art ships as JPEG; flat art keeps PNG's crisp edges.
  const jpeg = file.endsWith(".jpg");
  const image = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject()),
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

export function Gallery() {
  const [status, setStatus] = useState("");
  const exportAll = async () => {
    setStatus("Exporting…");
    try {
      for (const name of Object.keys(BRAND_ASSETS) as BrandAssetName[])
        await exportImage(name);
      setStatus("Exported every image.");
    } catch (error) {
      setStatus(`Export failed: ${String(error)}`);
    }
  };
  return (
    <main
      style={{ display: "grid", gap: 24, padding: 24, background: "#0b0b0c" }}
    >
      <p style={{ margin: 0, color: "#b6b6ba", font: "13px system-ui" }}>
        <button type="button" onClick={() => void exportAll()}>
          Export images
        </button>{" "}
        <output>{status}</output>
      </p>
      {(Object.keys(BRAND_ASSETS) as BrandAssetName[]).map((name) => (
        <figure
          key={name}
          style={{ margin: 0, color: "#b6b6ba", font: "13px system-ui" }}
        >
          <img
            alt={name}
            style={{ maxWidth: "100%", height: "auto", display: "block" }}
            src={svgUrl(name)}
          />
          <figcaption>
            {name} · {BRAND_ASSETS[name].width}×{BRAND_ASSETS[name].height} ·{" "}
            {BRAND_ASSETS[name].file}
          </figcaption>
        </figure>
      ))}
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<Gallery />);
