import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { PreviewApp } from "./preview";
import { initializePlayerPalette } from "./design/player-palette";

initializePlayerPalette(document.documentElement);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <PreviewApp />
  </StrictMode>,
);
