import "./style.css";
import { createLattice } from "../../shared/edition-game";
import { InlinePreview } from "./InlinePreview";
import { LatticeBoard } from "./LatticeBoard";
import "./edition-preview.css";

const model = {
  game: createLattice({
    size: 4,
    opening: "foundation",
    computerStyle: "builder",
  }),
  selected: null,
  layer: 1,
  isolate: false,
  showCubes: true,
  trace: null,
};

export function EditionPreview() {
  return (
    <InlinePreview
      title="Lattice"
      subtitle="Think in another dimension."
      className="lattice-inline"
    >
      <LatticeBoard model={model} onSelect={() => undefined} decorative />
    </InlinePreview>
  );
}
