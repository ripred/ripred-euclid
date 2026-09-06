import { createRoot } from "react-dom/client";
import { Prism } from "./edition/Prism";

const root = document.getElementById("root");
if (!root) throw new Error("The game container is missing.");
createRoot(root).render(<Prism />);
