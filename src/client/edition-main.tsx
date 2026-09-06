import { createRoot } from "react-dom/client";
import { Prism } from "./edition/Prism";
import { EditionProvider } from "./edition/EditionProvider";
import { SpectatorControls } from "./edition/SpectatorControls";

const root = document.getElementById("root");
if (!root) throw new Error("The game root is missing.");
createRoot(root).render(
  <EditionProvider>
    <SpectatorControls />
    <Prism />
  </EditionProvider>,
);
