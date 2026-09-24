import { createWeave, moveWeave } from "../../shared/edition-game";
import { WeaveBoard } from "./WeaveBoard";
import { InlinePreview } from "./InlinePreview";
import "./preview.css";

// Illustrative rules-derived board; no player session is created or loaded.
const illustration = [1, 5, 6, 12, 8, 14].reduce(
  (game, point) => moveWeave(game, { point }),
  createWeave(),
);

export function EditionPreview() {
  return (
    <InlinePreview
      title="Weave"
      subtitle="Claim points. Find triangles. Connect a weave."
      className="inline-preview--weave"
      aspectRatio={1000 / 870}
    >
      <WeaveBoard game={illustration} />
    </InlinePreview>
  );
}
