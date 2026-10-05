import { BoardDiagram } from "./ui/BoardDiagram";
import {
  boardAspectRatio,
  cellsFromPoints,
  type BoardMarker,
  type GridPoint,
  type Owner,
} from "./ui/board-geometry";
import { Dialog } from "./ui/Dialog";
import "./how-to-play.css";
import type { GameVariant } from "../shared/game/rules";
import { TideRules } from "./tide-rules";
import { playerName } from "./design/player-palette";

interface LessonSquare {
  owner: Owner;
  corners: GridPoint[];
  tone?: "history" | "blocked";
}

interface Lesson {
  title: string;
  body: string;
  squares: LessonSquare[];
  pieces?: (GridPoint & { owner: Owner })[];
  marker?: BoardMarker;
  diagramDescription?: string;
}

// Each lesson is a real 4×4 position drawn with the game's own board.
const LESSONS: Lesson[] = [
  {
    title: "Claim four corners",
    body: "Take turns placing one piece on an open point. Own all four corners of a square to score it.",
    squares: [
      {
        owner: 1,
        corners: [
          { x: 0, y: 1 },
          { x: 2, y: 1 },
          { x: 2, y: 3 },
          { x: 0, y: 3 },
        ],
      },
    ],
  },
  {
    title: "Tilted squares count",
    body: "Squares can lean at any angle. Points inside or along an edge don't matter, and one move can finish several squares.",
    squares: [
      {
        owner: 2,
        corners: [
          { x: 1, y: 0 },
          { x: 3, y: 1 },
          { x: 2, y: 3 },
          { x: 0, y: 2 },
        ],
      },
    ],
  },
  {
    title: "Bigger scores more",
    body: "Grid Footprint scoring squares the points along one side of the upright box around a square. The small square spans 2 for 4 points; the big one spans 4 for 16.",
    squares: [
      {
        owner: 2,
        corners: [
          { x: 0, y: 0 },
          { x: 3, y: 0 },
          { x: 3, y: 3 },
          { x: 0, y: 3 },
        ],
      },
      {
        owner: 1,
        corners: [
          { x: 1, y: 1 },
          { x: 2, y: 1 },
          { x: 2, y: 2 },
          { x: 1, y: 2 },
        ],
      },
    ],
  },
  {
    title: "Block your opponent",
    body: `Claim the fourth corner before your opponent can finish a square. The marked ${playerName(1)} piece stops ${playerName(2)} here; blocking alone scores no points.`,
    diagramDescription: `${playerName(2, true)} has three corners of a square. The marked ${playerName(1)} piece occupies its fourth corner, blocking ${playerName(2)} from completing it.`,
    // Three earlier red moves make this a legal alternating-turn position.
    pieces: [
      { x: 0, y: 0, owner: 1 },
      { x: 0, y: 1, owner: 1 },
      { x: 0, y: 3, owner: 1 },
      { x: 1, y: 1, owner: 2 },
      { x: 3, y: 1, owner: 2 },
      { x: 1, y: 3, owner: 2 },
      { x: 3, y: 3, owner: 1 },
    ],
    squares: [
      {
        owner: 2,
        tone: "blocked",
        corners: [
          { x: 1, y: 1 },
          { x: 3, y: 1 },
          { x: 3, y: 3 },
          { x: 1, y: 3 },
        ],
      },
    ],
    marker: { x: 3, y: 3, owner: 1, kind: "last" },
  },
];

function LessonBoard({ lesson }: { lesson: Lesson }) {
  return (
    <div
      className="lesson__board"
      style={{ aspectRatio: boardAspectRatio(4, 4) }}
    >
      <BoardDiagram
        width={4}
        height={4}
        title={lesson.diagramDescription ?? lesson.title}
        cells={cellsFromPoints(
          4,
          4,
          lesson.pieces ??
            lesson.squares.flatMap(({ owner, corners }) =>
              corners.map((corner) => ({ ...corner, owner })),
            ),
        )}
        squares={lesson.squares.map(({ owner, corners, tone }, index) => ({
          key: `${lesson.title}-${index}`,
          owner,
          tone: tone ?? "history",
          corners,
        }))}
        markers={lesson.marker ? [lesson.marker] : []}
      />
    </div>
  );
}

/**
 * Rules as illustrated lessons plus the finish condition. The strip
 * layout lays the lessons side by side for the home screen.
 */
export function HowToPlay({
  layout = "list",
  gameVariant = "standard",
}: {
  layout?: "list" | "strip";
  gameVariant?: GameVariant;
}) {
  return (
    <div className={`how-to-play how-to-play--${layout}`}>
      <ol className="lessons">
        {LESSONS.map((lesson, index) => (
          <li key={lesson.title} className="lesson">
            <LessonBoard lesson={lesson} />
            <div>
              <h3>
                <span className="lesson__step">{index + 1}</span>
                {lesson.title}
              </h3>
              <p>{lesson.body}</p>
            </div>
          </li>
        ))}
      </ol>
      {gameVariant === "tide" ? (
        <TideRules className="how-to-play__finish" />
      ) : (
        <p className="how-to-play__finish">
          <strong>First to the target wins.</strong> If the board fills first,
          the higher score wins.
        </p>
      )}
    </div>
  );
}

/** Rules and first-game tutorial share one dialog; only the action differs. */
export function HowToPlayDialog({
  variant,
  onClose,
  gameVariant = "standard",
}: {
  variant: "rules" | "tutorial";
  onClose: () => void;
  gameVariant?: GameVariant;
}) {
  const titleId = `euclid-${variant}-title`;
  return (
    <Dialog labelledBy={titleId} onDismiss={onClose} wide>
      <div>
        <p className="eyebrow">
          {variant === "tutorial" ? "Your first game" : "Rules"}
        </p>
        <h2 id={titleId}>
          How to play Euclid{gameVariant === "tide" ? " Tide" : ""}
        </h2>
      </div>
      <HowToPlay gameVariant={gameVariant} />
      <div className="dialog__actions">
        <button
          type="button"
          autoFocus
          className={
            variant === "tutorial" ? "btn btn--primary btn--lg" : "btn"
          }
          onClick={onClose}
        >
          {variant === "tutorial" ? "Start playing" : "Got it"}
        </button>
      </div>
    </Dialog>
  );
}
