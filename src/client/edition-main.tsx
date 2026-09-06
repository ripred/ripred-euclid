import { createRoot } from "react-dom/client";
import { Tide } from "./edition/Tide";

const root = document.getElementById("root");
if (root) createRoot(root).render(<Tide />);
