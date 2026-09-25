import { PieceGlyph } from "./BoardDiagram";
import "./score-chips.css";

/** Both scores as compact chips, each marked with its player's piece. */
export function ScoreChips({
  scores,
  labels = ["Red", "Blue"],
}: {
  scores: readonly [number, number];
  labels?: readonly [string, string];
}) {
  return (
    <div className="score-chips">
      {([1, 2] as const).map((owner) => (
        <span key={owner} className="score-chip">
          <PieceGlyph owner={owner} size={16} />
          <span className="score-chip__label">{labels[owner - 1]}</span>
          <span className="score-chip__value num">{scores[owner - 1]}</span>
        </span>
      ))}
    </div>
  );
}
