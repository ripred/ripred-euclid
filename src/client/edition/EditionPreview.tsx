import "./style.css";
import { InlinePreview } from "./InlinePreview";
import { PrismBoard } from "./PrismBoard";
import { makeExhibit } from "./prism-exhibit";
import "./edition-preview.css";

const exhibit = makeExhibit();

export function EditionPreview() {
  return (
    <InlinePreview
      title="Prism"
      subtitle="A different perspective."
      className="prism-inline"
    >
      <PrismBoard
        game={exhibit}
        active={false}
        decorative
        flat={false}
        onMove={() => undefined}
      />
    </InlinePreview>
  );
}
