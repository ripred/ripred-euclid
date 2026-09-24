import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./edition/style.css";
import { EditionPreview } from "./edition/EditionPreview";

const root = document.getElementById("root");
if (!root) throw new Error("The preview root is missing.");
createRoot(root).render(
  <StrictMode>
    <EditionPreview />
  </StrictMode>,
);
