/**
 * Development-only preview and export of the app icons in dev/icon-art.tsx.
 * Open /src/dev/icons.html while `npm run dev` is running; "Export icons"
 * writes each file into public/icons through the dev server.
 */
import { useState } from "react";
import { createRoot } from "react-dom/client";

import { APP_ICONS, appIconSvg, type AppIconFile } from "./icon-art";

const FILES = Object.keys(APP_ICONS) as AppIconFile[];

const svgUrl = (file: AppIconFile) =>
  `data:image/svg+xml;charset=utf-8,${encodeURIComponent(appIconSvg(file))}`;

async function renderIcon(file: AppIconFile): Promise<Blob> {
  if (file.endsWith(".svg")) {
    return new Blob([appIconSvg(file)], { type: "image/svg+xml" });
  }
  const { size } = APP_ICONS[file];
  const source = new Image(size, size);
  source.src = svgUrl(file);
  await source.decode();
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  canvas.getContext("2d")!.drawImage(source, 0, 0, size, size);
  return new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject()), "image/png"),
  );
}

async function exportIcon(file: AppIconFile): Promise<void> {
  const response = await fetch(`/__dev/icon?file=${encodeURIComponent(file)}`, {
    method: "POST",
    body: await renderIcon(file),
  });
  if (!response.ok) throw new Error(await response.text());
}

export function Gallery() {
  const [status, setStatus] = useState("");
  const exportAll = async () => {
    setStatus("Exporting…");
    try {
      for (const file of FILES) await exportIcon(file);
      setStatus("Exported every icon.");
    } catch (error) {
      setStatus(`Export failed: ${String(error)}`);
    }
  };
  return (
    <main
      style={{
        display: "flex",
        flexWrap: "wrap",
        alignItems: "flex-end",
        gap: 24,
        padding: 24,
        background: "#0b0b0c",
        color: "#b6b6ba",
        font: "13px system-ui",
      }}
    >
      <p style={{ flexBasis: "100%", margin: 0 }}>
        <button type="button" onClick={() => void exportAll()}>
          Export icons
        </button>{" "}
        <output>{status}</output>
      </p>
      {FILES.map((file) => (
        <figure key={file} style={{ margin: 0 }}>
          <img
            alt={file}
            width={Math.min(APP_ICONS[file].size, 256)}
            height={Math.min(APP_ICONS[file].size, 256)}
            style={{ display: "block" }}
            src={svgUrl(file)}
          />
          <figcaption>
            {file} · {APP_ICONS[file].size}px
          </figcaption>
        </figure>
      ))}
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<Gallery />);
