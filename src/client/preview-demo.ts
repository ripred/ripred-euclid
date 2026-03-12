export type Owner = 1 | 2;
export type DemoStepId = 'place' | 'straight' | 'rotated' | 'size' | 'multi';
export type DotSpec = { x: number; y: number; owner: Owner };
export type PointSpec = { x: number; y: number };
export type SquareSpec = {
  key: string;
  owner: Owner;
  points: number;
  corners: PointSpec[];
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
  title: string;
  body: string;
  before: DemoFrame;
  after: DemoFrame;
};

type DemoMove = DotSpec;
type CapturedStepMeta = {
  id: DemoStepId;
  title: string;
  buildBody: (frame: DemoFrame) => string;
};

const BOARD_W = 8;
const BOARD_H = 8;

const RECORDED_GAME: DemoMove[] = [
  { x: 5, y: 5, owner: 1 },
  { x: 1, y: 1, owner: 2 },
  { x: 4, y: 1, owner: 1 },
  { x: 3, y: 1, owner: 2 },
  { x: 5, y: 2, owner: 1 },
  { x: 1, y: 3, owner: 2 },
  { x: 3, y: 2, owner: 1 },
  { x: 3, y: 3, owner: 2 },
  { x: 4, y: 3, owner: 1 },
  { x: 0, y: 4, owner: 2 },
  { x: 6, y: 6, owner: 1 },
  { x: 3, y: 4, owner: 2 },
  { x: 6, y: 1, owner: 1 },
  { x: 0, y: 7, owner: 2 },
  { x: 7, y: 2, owner: 1 },
  { x: 3, y: 7, owner: 2 },
  { x: 6, y: 3, owner: 1 },
];

const CAPTURED_STEPS = new Map<number, CapturedStepMeta>([
  [7, {
    id: 'place',
    title: 'Every turn places one dot',
    buildBody: () => 'This real game starts with a normal setup move: one new dot on one empty point, then the turn passes.',
  }],
  [8, {
    id: 'straight',
    title: 'Straight squares score immediately',
    buildBody: (frame) => {
      const points = frame.newSquares.reduce((sum, square) => sum + square.points, 0);
      return `Blue closes a straight square here and scores ${points} points on that move.`;
    },
  }],
  [9, {
    id: 'rotated',
    title: 'Rotated squares count too',
    buildBody: (frame) => {
      const points = frame.newSquares.reduce((sum, square) => sum + square.points, 0);
      return `Red answers in the same game with a leaning square for ${points} points. Rotated squares are fully legal.`;
    },
  }],
  [16, {
    id: 'size',
    title: 'Larger squares swing the score',
    buildBody: (frame) => {
      const points = frame.newSquares.reduce((sum, square) => sum + square.points, 0);
      return `Later, Blue finishes a larger square worth ${points} points and jumps ahead ${frame.scores[1]} to ${frame.scores[0]}.`;
    },
  }],
  [17, {
    id: 'multi',
    title: 'One move can finish multiple squares',
    buildBody: (frame) => {
      const count = frame.newSquares.length;
      const points = frame.newSquares.reduce((sum, square) => sum + square.points, 0);
      return `Careful setup can let one final dot complete ${count} squares at once for ${points} total points.`;
    },
  }],
]);

function pointIndex(x: number, y: number): number {
  return y * BOARD_W + x;
}

function scoreSquare(corners: PointSpec[]): number {
  const xs = corners.map((point) => point.x);
  const ys = corners.map((point) => point.y);
  return (Math.max(...xs) - Math.min(...xs) + 1) * (Math.max(...ys) - Math.min(...ys) + 1);
}

function orderSquareCorners(corners: PointSpec[]): PointSpec[] {
  const centerX = corners.reduce((sum, point) => sum + point.x, 0) / corners.length;
  const centerY = corners.reduce((sum, point) => sum + point.y, 0) / corners.length;

  const ordered = [...corners].sort((left, right) => {
    const leftAngle = Math.atan2(left.y - centerY, left.x - centerX);
    const rightAngle = Math.atan2(right.y - centerY, right.x - centerX);
    return leftAngle - rightAngle;
  });

  let startIndex = 0;
  for (let index = 1; index < ordered.length; index++) {
    const point = ordered[index];
    const current = ordered[startIndex];
    if (point.y < current.y || (point.y === current.y && point.x < current.x)) {
      startIndex = index;
    }
  }

  return ordered.slice(startIndex).concat(ordered.slice(0, startIndex));
}

function squareKey(corners: PointSpec[]): string {
  return corners
    .map((point) => pointIndex(point.x, point.y))
    .sort((left, right) => left - right)
    .join(',');
}

function computeCompletedSquares(board: number[], move: DemoMove): SquareSpec[] {
  const other = move.owner === 1 ? 2 : 1;
  const seen = new Set<string>();
  const squares: SquareSpec[] = [];

  for (let row = 0; row < BOARD_H; row++) {
    for (let col = 0; col < BOARD_W; col++) {
      const dx = col - move.x;
      const dy = row - move.y;
      const x1 = move.x - dy;
      const y1 = move.y + dx;
      const x2 = col - dy;
      const y2 = row + dx;

      if (
        x1 < 0 || x1 >= BOARD_W ||
        y1 < 0 || y1 >= BOARD_H ||
        x2 < 0 || x2 >= BOARD_W ||
        y2 < 0 || y2 >= BOARD_H ||
        (col === move.x && row === move.y)
      ) {
        continue;
      }

      const corners = orderSquareCorners([
        { x: move.x, y: move.y },
        { x: col, y: row },
        { x: x1, y: y1 },
        { x: x2, y: y2 },
      ]);
      const values = corners.map((point) => board[pointIndex(point.x, point.y)]);

      if (values.some((value) => value === other)) continue;
      if (values.some((value) => value === 0)) continue;

      const key = squareKey(corners);
      if (seen.has(key)) continue;
      seen.add(key);

      squares.push({
        key,
        owner: move.owner,
        points: scoreSquare(corners),
        corners,
      });
    }
  }

  return squares;
}

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
    move,
    moveNumber,
    newSquares,
    allSquares,
  };
}

function buildDemoSteps(): DemoStep[] {
  const board = new Array<number>(BOARD_W * BOARD_H).fill(0);
  const scores: [number, number] = [0, 0];
  const allSquares = new Map<string, SquareSpec>();
  const steps: DemoStep[] = [];

  RECORDED_GAME.forEach((move, index) => {
    const moveNumber = index + 1;
    const expectedOwner = moveNumber % 2 === 1 ? 1 : 2;
    if (move.owner !== expectedOwner) {
      throw new Error(`Preview demo move ${moveNumber} is out of turn.`);
    }

    const boardIndex = pointIndex(move.x, move.y);
    if (board[boardIndex] !== 0) {
      throw new Error(`Preview demo move ${moveNumber} tries to reuse an occupied point.`);
    }

    const before = makeFrame(board, scores, moveNumber - 1, undefined, [], [...allSquares.values()]);

    board[boardIndex] = move.owner;
    const newSquares = computeCompletedSquares(board, move);
    const points = newSquares.reduce((sum, square) => sum + square.points, 0);
    scores[move.owner - 1] += points;
    for (const square of newSquares) allSquares.set(square.key, square);

    const after = makeFrame(board, scores, moveNumber, move, newSquares, [...allSquares.values()]);
    const stepMeta = CAPTURED_STEPS.get(moveNumber);
    if (!stepMeta) return;

    steps.push({
      id: stepMeta.id,
      title: stepMeta.title,
      body: stepMeta.buildBody(after),
      before,
      after,
    });
  });

  if (steps.length !== CAPTURED_STEPS.size) {
    throw new Error('Preview demo is missing one or more instructional steps.');
  }

  return steps;
}

export const DEMO_STEPS = buildDemoSteps();
export const IDLE_FRAME = DEMO_STEPS[0].before;
