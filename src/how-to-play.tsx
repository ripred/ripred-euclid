import { BoardDiagram } from "./ui/BoardDiagram";
import {
  boardAspectRatio,
  cellsFromPoints,
  type GridPoint,
  type Owner,
} from "./ui/board-geometry";
import { Dialog } from "./ui/Dialog";
import "./how-to-play.css";

interface LessonSquare {
  owner: Owner;
  corners: GridPoint[];
}

interface Lesson {
  title: string;
  body: string;
  squares: LessonSquare[];
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
        cells={cellsFromPoints(
          4,
          4,
          lesson.squares.flatMap(({ owner, corners }) =>
            corners.map((corner) => ({ ...corner, owner })),
          ),
        )}
        squares={lesson.squares.map(({ owner, corners }, index) => ({
          key: `${lesson.title}-${index}`,
          owner,
          tone: "history",
          corners,
        }))}
      />
    </div>
  );
}

/**
 * Rules as three illustrated lessons plus the finish condition. The strip
 * layout lays the lessons side by side for the home screen.
 */
export function HowToPlay({ layout = "list" }: { layout?: "list" | "strip" }) {
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
      <p className="how-to-play__finish">
        <strong>First to the target wins.</strong> If the board fills first, the
        higher score wins. Practice games can use True Area scoring instead,
        which counts a square's real area.
      </p>
    </div>
  );
}

/** Rules and first-game tutorial share one dialog; only the action differs. */
export function HowToPlayDialog({
  variant,
  fadeTurns = 0,
  onClose,
}: {
  variant: "rules" | "tutorial";
  /** Fading pieces in the current game; 0 when stones are permanent. */
  fadeTurns?: number;
  onClose: () => void;
}) {
  const titleId = `euclid-${variant}-title`;
  return (
    <Dialog labelledBy={titleId} onDismiss={onClose} wide>
      <div>
        <p className="eyebrow">
          {variant === "tutorial" ? "Your first game" : "Rules"}
        </p>
        <h2 id={titleId}>How to play Euclid</h2>
      </div>
      <HowToPlay />
      {fadeTurns ? (
        <p className="how-to-play__fade">
          <strong>Fading pieces are on.</strong> Each stone lasts {fadeTurns} of
          its owner's turns, fading as it ages, then washes away. Completing a
          square anchors all four corners for good. A ringed stone is in its
          owner's final turn.
        </p>
      ) : null}
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
