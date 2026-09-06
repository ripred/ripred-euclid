import "./index.css";

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { expandedInitialMode } from "./expanded-entry";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App
      initialMode={expandedInitialMode(document.documentElement.dataset.entry)}
    />
  </StrictMode>,
);
