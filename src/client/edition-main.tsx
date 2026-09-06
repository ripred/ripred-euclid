import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Weave } from "./edition/Weave";
import { EditionProvider } from "./edition/EditionProvider";
import { SpectatorControls } from "./edition/SpectatorControls";
import "./edition/style.css";

const root = document.getElementById("root");
if (!root) throw new Error("The game root is missing.");
createRoot(root).render(
  <StrictMode>
    <EditionProvider>
      <SpectatorControls />
      <Weave />
    </EditionProvider>
  </StrictMode>,
);
