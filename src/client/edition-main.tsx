import { createRoot } from "react-dom/client";
import { Tide } from "./edition/Tide";
import { EditionProvider } from "./edition/EditionProvider";
import { SpectatorControls } from "./edition/SpectatorControls";

const root = document.getElementById("root");
if (!root) throw new Error("The game root is missing.");
createRoot(root).render(
  <EditionProvider>
    <SpectatorControls />
    <Tide />
  </EditionProvider>,
);
