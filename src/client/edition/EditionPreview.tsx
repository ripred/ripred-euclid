import { edition } from "../../shared/edition-game";
import { TideBoard } from "./TideBoard";
import { InlinePreview } from "./InlinePreview";
import "./preview.css";

// Illustrative rules-derived board; no player session is created or loaded.
const illustration = [7, 21, 8, 22, 13, 27, 14, 28].reduce(
  (game, point) => edition.move(game, { point }),
  edition.create({}),
);

export function EditionPreview() {
  return (
    <InlinePreview
      title="Tide"
      subtitle="Build squares. Anchor what lasts."
      className="inline-preview--tide"
    >
      <TideBoard game={illustration} />
    </InlinePreview>
  );
}
