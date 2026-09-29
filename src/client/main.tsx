import "./index.css";

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { expandedInitialMode, expandedInitialAction } from "./expanded-entry";

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
