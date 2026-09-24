import { createRoot } from "react-dom/client";
import { EditionPreview } from "./edition/EditionPreview";

const root = document.getElementById("root");
if (!root) throw new Error("The preview root is missing.");
createRoot(root).render(<EditionPreview />);
