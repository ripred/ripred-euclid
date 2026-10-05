import "./index.css";

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { expandedInitialMode, expandedInitialAction } from "./expanded-entry";
import { initializePlayerPalette } from "./design/player-palette";

initializePlayerPalette(document.documentElement);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App
      initialAction={expandedInitialAction(
        document.documentElement.dataset.entry,
      )}
      initialMode={expandedInitialMode(document.documentElement.dataset.entry)}
    />
  </StrictMode>,
);
