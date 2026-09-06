import { EditionRuleError } from "./edition-contract";
import type {
  EditionDefinition,
  EditionState,
  Player,
} from "./edition-contract";

export const ROWS = 7;
export const TARGET = 24;
export const LINK_BONUS = 2;

export interface LatticePoint {
  id: number;
  row: number;
  column: number;
  label: string;
  x: number;
  y: number;
}

export interface Triangle {
  id: string;
  corners: readonly [number, number, number];
  area: number;
}

export interface TriangleClaim {
  id: string;
  player: Player;
  revision: number;
}

export interface WeaveState extends EditionState {
  cells: (Player | 0)[];
  scores: [number, number];
  claims: TriangleClaim[];
  previousMove: WeaveState["lastMove"];
  lastMove: {
    point: number;
    player: Player;
    triangles: string[];
    area: number;
    links: number;
    points: number;
  } | null;
}

export const POINTS: readonly LatticePoint[] = Array.from(
  { length: ROWS },
  (_, row) =>
    Array.from({ length: row + 1 }, (_, column) => ({
      id: (row * (row + 1)) / 2 + column,
      row,
      column,
      label: `${String.fromCharCode(65 + row)}${column + 1}`,
      x: 500 + (column - row / 2) * 140,
      y: 75 + row * 70 * Math.sqrt(3),
    })),
).flat();

/** Integer lattice coordinates avoid tolerance-dependent triangle detection. */
export function distanceSquared(a: LatticePoint, b: LatticePoint): number {
  const row = a.row - b.row;
  const column = a.column - b.column;
  return column * column - column * row + row * row;
}

function enumerateTriangles(): Triangle[] {
  const triangles: Triangle[] = [];
  for (const a of POINTS) {
    for (const b of POINTS) {
      if (b.id <= a.id) continue;
      const area = distanceSquared(a, b);
      for (const c of POINTS) {
        if (c.id <= b.id) continue;
        if (distanceSquared(a, c) === area && distanceSquared(b, c) === area) {
          triangles.push({
            id: `${a.id}-${b.id}-${c.id}`,
            corners: [a.id, b.id, c.id],
            area,
          });
        }
      }
    }
  }
  return triangles;
}

export const TRIANGLES: readonly Triangle[] = enumerateTriangles();
export const TRIANGLE_BY_ID = new Map(
  TRIANGLES.map((triangle) => [triangle.id, triangle]),
);
const trianglesAtPoint = POINTS.map((point) =>
  TRIANGLES.filter((triangle) => triangle.corners.includes(point.id)),
);

/** Identical endpoints define a full shared edge; touching or partial overlap does not. */
export function sharesEdge(a: Triangle, b: Triangle): boolean {
  return (
    a.id !== b.id &&
    a.corners.filter((corner) => b.corners.includes(corner)).length === 2
  );
}

export function createWeave(): WeaveState {
  return {
    revision: 0,
    turn: 1,
    winner: null,
    cells: POINTS.map(() => 0),
    scores: [0, 0],
    claims: [],
    previousMove: null,
    lastMove: null,
  };
}

function evaluatePlacement(state: WeaveState, point: number, player: Player) {
  const completed = (trianglesAtPoint[point] ?? []).filter((triangle) =>
    triangle.corners.every(
      (corner) => corner === point || state.cells[corner] === player,
    ),
  );
  const existing = state.claims.flatMap((claim) => {
    const triangle = TRIANGLE_BY_ID.get(claim.id);
    return claim.player === player && triangle ? [triangle] : [];
  });
  let links = 0;
  completed.forEach((triangle, index) => {
    for (const other of existing) if (sharesEdge(triangle, other)) links++;
    // Two triangles finished together also link; visit each unordered pair once.
    for (const other of completed.slice(0, index))
      if (sharesEdge(triangle, other)) links++;
  });
  const area = completed.reduce((total, triangle) => total + triangle.area, 0);
  return { completed, area, links, points: area + links * LINK_BONUS };
}

export function moveWeave(state: WeaveState, action: unknown): WeaveState {
  if (state.winner !== null)
    throw new EditionRuleError("This weave is complete. Start a new game.");
  if (
    !action ||
    typeof action !== "object" ||
    !("point" in action) ||
    typeof action.point !== "number" ||
    !Number.isInteger(action.point) ||
    action.point < 0 ||
    action.point >= POINTS.length
  ) {
    throw new EditionRuleError("Choose a point on the lattice.");
  }
  const point = action.point;
  if (state.cells[point] !== 0)
    throw new EditionRuleError("That point is already claimed.");
  const player = state.turn;
  const result = evaluatePlacement(state, point, player);
  const cells = [...state.cells];
  cells[point] = player;
  const scores: [number, number] = [...state.scores];
  scores[player - 1] = (scores[player - 1] ?? 0) + result.points;
  const revision = state.revision + 1;
  let winner: WeaveState["winner"] = null;
  if ((scores[player - 1] ?? 0) >= TARGET) winner = player;
  else if (!cells.includes(0))
    winner = scores[0] === scores[1] ? 0 : scores[0] > scores[1] ? 1 : 2;
  return {
    cells,
    scores,
    revision,
    // Terminal turns never advance: no response move may follow a winning stitch.
    turn: winner === null ? (player === 1 ? 2 : 1) : player,
    winner,
    previousMove: state.lastMove,
    claims: [
      ...state.claims,
      ...result.completed.map((triangle) => ({
        id: triangle.id,
        player,
        revision,
      })),
    ],
    lastMove: {
      point,
      player,
      triangles: result.completed.map((triangle) => triangle.id),
      area: result.area,
      links: result.links,
      points: result.points,
    },
  };
}

function constructionValue(
  state: WeaveState,
  point: number,
  player: Player,
): number {
  const opponent = player === 1 ? 2 : 1;
  return (trianglesAtPoint[point] ?? []).reduce((total, triangle) => {
    if (triangle.corners.some((corner) => state.cells[corner] === opponent))
      return total;
    const owned = triangle.corners.filter(
      (corner) => state.cells[corner] === player,
    ).length;
    return total + Math.sqrt(triangle.area) * (owned === 1 ? 1 : 0.08);
  }, 0);
}

/** One-ply tactical search: finish, prevent a finish, then balance score and construction. */
export function chooseWeaveMove(state: WeaveState): { point: number } {
  if (state.winner !== null)
    throw new EditionRuleError("No move remains in a finished game.");
  const available = POINTS.filter((point) => state.cells[point.id] === 0);
  const player = state.turn;
  const opponent = player === 1 ? 2 : 1;
  let best = available[0];
  let bestValue = -Infinity;
  for (const point of available) {
    const next = moveWeave(state, { point: point.id });
    if (next.winner === player) return { point: point.id };
    let reply = 0;
    let concedesWin = false;
    if (next.winner === null) {
      for (const other of available) {
        if (other.id === point.id) continue;
        const threat = evaluatePlacement(next, other.id, opponent).points;
        reply = Math.max(reply, threat);
        if ((state.scores[opponent - 1] ?? 0) + threat >= TARGET)
          concedesWin = true;
      }
    }
    const attack = next.lastMove?.points ?? 0;
    const block = evaluatePlacement(state, point.id, opponent).points;
    const value =
      attack * 2 -
      reply * 2.2 +
      block * 0.5 +
      constructionValue(state, point.id, player) * 0.15 -
      (concedesWin ? 10_000 : 0);
    if (value > bestValue) {
      best = point;
      bestValue = value;
    }
  }
  if (!best) throw new EditionRuleError("There are no empty points.");
  return { point: best.id };
}

export const edition: EditionDefinition<WeaveState> = {
  id: "weave",
  create: createWeave,
  move: moveWeave,
  chooseMove: chooseWeaveMove,
};
