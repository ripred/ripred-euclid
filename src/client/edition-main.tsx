import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Weave } from "./edition/Weave";
import "./edition/style.css";

const root = document.getElementById("root");
if (!root) throw new Error("The game root is missing.");
createRoot(root).render(
  <StrictMode>
    <Weave />
  </StrictMode>,
);
