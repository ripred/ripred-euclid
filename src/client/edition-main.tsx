import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Lattice } from "./edition/Lattice";
import { EditionProvider } from "./edition/EditionProvider";
import { SpectatorControls } from "./edition/SpectatorControls";

const root = document.getElementById("root");
if (!root) throw new Error("The game root is missing.");
createRoot(root).render(
  <StrictMode>
    <EditionProvider>
      <SpectatorControls />
      <Lattice />
    </EditionProvider>
  </StrictMode>,
);
