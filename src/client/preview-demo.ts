import { emptyCells, pointIndex } from "../shared/game/geometry";
import { completedSquares } from "./completed-squares";

export type Owner = 1 | 2;
export type DemoStepId =
  | "place"
  | "straight"
  | "rotated"
  | "size"
  | "block"
  | "multi";
export type DotSpec = { x: number; y: number; owner: Owner };
export type PointSpec = { x: number; y: number };
export type SquareCorners = [PointSpec, PointSpec, PointSpec, PointSpec];
export type SquareSpec = {
  key: string;
  owner: Owner;
  points: number;
  corners: SquareCorners;
};
export type DemoFrame = {
  dots: DotSpec[];
  scores: [number, number];
  move?: DotSpec;
  moveNumber: number;
  newSquares: SquareSpec[];
  allSquares: SquareSpec[];
};
export type DemoStep = {
  id: DemoStepId;
  /** A few words naming the lesson in the lesson list. */
  label: string;
  title: string;
  body: string;
  before: DemoFrame;
  after: DemoFrame;
};

type DemoMove = DotSpec;
type CapturedStepMeta = {
  id: DemoStepId;
  label: string;
  title: string;
  buildBody: (frame: DemoFrame) => string;
};

const BOARD_W = 8;
const BOARD_H = 8;

// One fixed legal game makes the tutorial deterministic while demonstrating
// every scoring and blocking concept in a single coherent sequence.
const RECORDED_GAME: DemoMove[] = [
  { x: 0, y: 0, owner: 1 },
  { x: 1, y: 1, owner: 2 },
  { x: 7, y: 7, owner: 1 },
  { x: 3, y: 1, owner: 2 },
  { x: 0, y: 7, owner: 1 },
  { x: 1, y: 3, owner: 2 },
  { x: 6, y: 6, owner: 1 },
  { x: 3, y: 3, owner: 2 },
  { x: 5, y: 1, owner: 1 },
  { x: 4, y: 0, owner: 2 },
  { x: 6, y: 2, owner: 1 },
  { x: 7, y: 0, owner: 2 },
  { x: 5, y: 3, owner: 1 },
  { x: 4, y: 3, owner: 2 },
  { x: 4, y: 2, owner: 1 },
  { x: 7, y: 3, owner: 2 },
  { x: 0, y: 4, owner: 1 },
  { x: 7, y: 1, owner: 2 },
  { x: 2, y: 4, owner: 1 },
  { x: 7, y: 2, owner: 2 },
  { x: 0, y: 6, owner: 1 },
  { x: 2, y: 6, owner: 2 },
  { x: 5, y: 4, owner: 1 },
  { x: 2, y: 0, owner: 2 },
  { x: 7, y: 4, owner: 1 },
  { x: 3, y: 0, owner: 2 },
  { x: 7, y: 6, owner: 1 },
  { x: 5, y: 0, owner: 2 },
  { x: 3, y: 4, owner: 1 },
  { x: 6, y: 0, owner: 2 },
  { x: 3, y: 6, owner: 1 },
  { x: 0, y: 1, owner: 2 },
  { x: 5, y: 6, owner: 1 },
];

// Both the splash tutorial and the spectator fallback use this same recording.
export const DEMO_RECORDING = {
  width: BOARD_W,
  height: BOARD_H,
  moves: RECORDED_GAME as readonly DemoMove[],
};

// Keys are one-based move numbers whose before/after frames become teaching
// beats; moves between them establish the board context without extra slides.
const CAPTURED_STEPS = new Map<number, CapturedStepMeta>([
  [
    1,
    {
      id: "place",
      label: "One dot per turn",
      title: "Every turn places one dot",
      buildBody: () =>
        "This demo starts with a normal setup move: one new dot on one empty point, then the turn passes.",
    },
  ],
  [
    8,
    {
      id: "straight",
      label: "Straight squares",
      title: "Straight squares score immediately!",
      buildBody: (frame) => {
        const points = frame.newSquares.reduce(
          (sum, square) => sum + square.points,
          0,
        );
        return `Blue closes a straight square here and scores ${points} points on that move.`;
      },
    },
  ],
  [
    15,
    {
      id: "rotated",
      label: "Tilted squares",
      title: "Rotated squares count too!",
      buildBody: (frame) => {
        const points = frame.newSquares.reduce(
          (sum, square) => sum + square.points,
          0,
        );
        return `Red answers in the same demo with a leaning square for ${points} points. Rotated squares are fully legal.`;
      },
    },
  ],
  [
    16,
    {
      id: "size",
      label: "Bigger squares",
      title: "Larger squares swing the score!",
      buildBody: (frame) => {
        const points = frame.newSquares.reduce(
          (sum, square) => sum + square.points,
          0,
        );
        return `Later, Blue finishes a larger square worth ${points} points and jumps ahead ${frame.scores[1]} to ${frame.scores[0]}.`;
      },
    },
  ],
  [
    22,
    {
      id: "block",
      label: "Blocking",
      title: "You can block squares too!",
      buildBody: () =>
        "Blue claims the last open corner Red needed, blocking that square before it can ever score.",
    },
  ],
  [
    33,
    {
      id: "multi",
      label: "Several at once",
      title: "One move can finish multiple squares!",
      buildBody: (frame) => {
        const count = frame.newSquares.length;
        const points = frame.newSquares.reduce(
          (sum, square) => sum + square.points,
          0,
        );
        return `Careful setup can let one final dot complete ${count} squares at once for ${points} total points.`;
      },
    },
  ],
]);

function toDots(board: number[]): DotSpec[] {
  const dots: DotSpec[] = [];
  for (let index = 0; index < board.length; index++) {
    const owner = board[index];
    if (owner !== 1 && owner !== 2) continue;
    dots.push({
      x: index % BOARD_W,
      y: Math.floor(index / BOARD_W),
      owner,
    });
  }
  return dots;
}

function makeFrame(
  board: number[],
  scores: [number, number],
  moveNumber: number,
  move?: DemoMove,
  newSquares: SquareSpec[] = [],
  allSquares: SquareSpec[] = [],
): DemoFrame {
  return {
    dots: toDots(board),
    scores: [...scores] as [number, number],
    moveNumber,
    newSquares,
    allSquares,
    ...(move ? { move } : {}),
  };
}

function buildDemoSteps(): DemoStep[] {
  const board = emptyCells(BOARD_W, BOARD_H);
  const scores: [number, number] = [0, 0];
  const allSquares = new Map<string, SquareSpec>();
  const steps: DemoStep[] = [];

  RECORDED_GAME.forEach((move, index) => {
    const moveNumber = index + 1;
    const expectedOwner = moveNumber % 2 === 1 ? 1 : 2;
    if (move.owner !== expectedOwner) {
      throw new Error(`Preview demo move ${moveNumber} is out of turn.`);
    }

    const boardIndex = pointIndex(move.x, move.y, BOARD_W);
    if (board[boardIndex] !== 0) {
      throw new Error(
        `Preview demo move ${moveNumber} tries to reuse an occupied point.`,
      );
    }

    const before = makeFrame(
      board,
      scores,
      moveNumber - 1,
      undefined,
      [],
      [...allSquares.values()],
    );

    board[boardIndex] = move.owner;
    const newSquares = completedSquares(board, BOARD_W, BOARD_H, move);
    const points = newSquares.reduce((sum, square) => sum + square.points, 0);
    if (move.owner === 1) scores[0] += points;
    else scores[1] += points;
    for (const square of newSquares) allSquares.set(square.key, square);

    const after = makeFrame(board, scores, moveNumber, move, newSquares, [
      ...allSquares.values(),
    ]);
    const stepMeta = CAPTURED_STEPS.get(moveNumber);
    if (!stepMeta) return;

    steps.push({
      id: stepMeta.id,
      label: stepMeta.label,
      title: stepMeta.title,
      body: stepMeta.buildBody(after),
      before,
      after,
    });
  });

  if (steps.length !== CAPTURED_STEPS.size) {
    throw new Error("Preview demo is missing one or more instructional steps.");
  }

  return steps;
}

export const DEMO_STEPS = buildDemoSteps();
const firstDemoStep = DEMO_STEPS[0];
if (!firstDemoStep)
  throw new Error("Preview demo must contain at least one step.");
export const IDLE_FRAME = firstDemoStep.before;
