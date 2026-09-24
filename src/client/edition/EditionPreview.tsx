import { createRelay, moveRelay } from "../../shared/edition-game";
import { RelayBoard } from "./RelayBoard";
import { InlinePreview } from "./InlinePreview";
import "./preview.css";

// Illustrative rules-derived board; no player session is created or loaded.
const illustration = moveRelay(createRelay({ level: 2 }), { point: 15 });

export function EditionPreview() {
  return (
    <InlinePreview
      title="Relay"
      subtitle="A few points. A new connection."
      className="inline-preview--relay"
    >
      <RelayBoard game={illustration} />
    </InlinePreview>
  );
}
