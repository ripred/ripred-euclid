import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Lattice } from "./edition/Lattice";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Lattice />
  </StrictMode>,
);
