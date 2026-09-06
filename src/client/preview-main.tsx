import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { PreviewApp } from "./preview";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <PreviewApp />
  </StrictMode>,
);
