import { EditionRuleError } from "./edition-contract";
import type {
  EditionDefinition,
  EditionState,
  Player,
} from "./edition-contract";

export type Point3 = { x: number; y: number; z: number };
export type Cube = {
  id: string;
  origin: Point3;
  side: number;
  corners: number[];
  volume: number;
};
export type ClaimedCube = Cube & { owner: Player; move: number };
export type LatticeMove = Point3 & {
  player: Player;
  points: number;
  cubes: string[];
};
export interface LatticeState extends EditionState {
  size: 3 | 4;
  opening: "foundation" | "empty";
  computerStyle: "builder" | "tactician";
  board: (Player | 0)[];
  scores: [number, number];
  cubes: ClaimedCube[];
  history: LatticeMove[];
}

export function pointIndex({ x, y, z }: Point3, size: number): number {
  return x + size * y + size * size * z;
}

export function pointAt(index: number, size: number): Point3 {
  return {
    x: index % size,
    y: Math.floor(index / size) % size,
    z: Math.floor(index / (size * size)),
  };
}

/** Each origin/side pair names one cube, independent of which corner was placed last. */
export function cubeCatalog(size: number): Cube[] {
  const cubes: Cube[] = [];
  for (let side = 1; side < size; side++) {
    for (let z = 0; z < size - side; z++) {
      for (let y = 0; y < size - side; y++) {
        for (let x = 0; x < size - side; x++) {
          const corners: number[] = [];
          for (const dz of [0, side])
            for (const dy of [0, side])
              for (const dx of [0, side]) {
                corners.push(
                  pointIndex({ x: x + dx, y: y + dy, z: z + dz }, size),
                );
              }
          cubes.push({
            id: `${x}:${y}:${z}:${side}`,
            origin: { x, y, z },
            side,
            corners,
            volume: side ** 3,
          });
        }
      }
    }
  }
  return cubes;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function createLattice(options: unknown = {}): LatticeState {
  if (options === undefined) options = {};
  if (!isRecord(options))
    throw new EditionRuleError("Choose a valid lattice setup.");
  if (options.size !== undefined && options.size !== 3 && options.size !== 4)
    throw new EditionRuleError("The lattice must be 3 or 4 points wide.");
  if (
    options.opening !== undefined &&
    options.opening !== "empty" &&
    options.opening !== "foundation"
  )
    throw new EditionRuleError("Choose a valid opening.");
  const size = options.size === 3 ? 3 : 4;
  if (
    options.computerStyle !== undefined &&
    options.computerStyle !== "builder" &&
    options.computerStyle !== "tactician"
  )
    throw new EditionRuleError("Choose a valid computer style.");
  const computerStyle =
    options.computerStyle === "tactician" ? "tactician" : "builder";
  const opening = options.opening === "empty" ? "empty" : "foundation";
  const board: (Player | 0)[] = Array.from({ length: size ** 3 }, () => 0);
  if (opening === "foundation") {
    for (const x of [0, 1])
      for (const y of [0, 1]) {
        board[pointIndex({ x, y, z: 0 }, size)] = 1;
        board[
          pointIndex({ x: size - 1 - x, y: size - 1 - y, z: size - 1 }, size)
        ] = 2;
      }
  }
  return {
    size,
    opening,
    computerStyle,
    board,
    scores: [0, 0],
    cubes: [],
    history: [],
    revision: 0,
    turn: 1,
    winner: null,
  };
}

export function moveLattice(
  state: LatticeState,
  action: unknown,
): LatticeState {
  if (state.winner !== null)
    throw new EditionRuleError(
      "This game is complete. Start a new lattice to play again.",
    );
  if (!isRecord(action))
    throw new EditionRuleError("Choose a point on the lattice.");
  const { x, y, z } = action;
  if (
    ![x, y, z].every(
      (value) =>
        typeof value === "number" &&
        Number.isInteger(value) &&
        value >= 0 &&
        value < state.size,
    )
  ) {
    throw new EditionRuleError("That point is outside the lattice.");
  }
  const point = { x: x as number, y: y as number, z: z as number };
  const index = pointIndex(point, state.size);
  if (state.board[index] !== 0)
    throw new EditionRuleError("That point is already claimed.");
  const board = [...state.board];
  board[index] = state.turn;
  const already = new Set(state.cubes.map((cube) => cube.id));
  const completed = cubeCatalog(state.size).filter(
    (cube) =>
      !already.has(cube.id) &&
      cube.corners.includes(index) &&
      cube.corners.every((corner) => board[corner] === state.turn),
  );
  const points = completed.reduce((total, cube) => total + cube.volume, 0);
  const scores: [number, number] = [...state.scores];
  const scoreIndex = state.turn === 1 ? 0 : 1;
  scores[scoreIndex] += points;
  const winner = board.includes(0)
    ? null
    : scores[0] === scores[1]
      ? 0
      : scores[0] > scores[1]
        ? 1
        : 2;
  return {
    ...state,
    board,
    scores,
    cubes: [
      ...state.cubes,
      ...completed.map((cube) => ({
        ...cube,
        owner: state.turn,
        move: state.revision + 1,
      })),
    ],
    history: [
      ...state.history,
      {
        ...point,
        player: state.turn,
        points,
        cubes: completed.map((cube) => cube.id),
      },
    ],
    revision: state.revision + 1,
    // Terminal state keeps the finishing player. No opponent action follows a result.
    turn: winner === null ? (state.turn === 1 ? 2 : 1) : state.turn,
    winner,
  };
}

/** Inspecting progress never changes state; only fully owned, unblocked cubes can advance. */
export function cubeProgress(
  state: LatticeState,
  player: Player,
): { cube: Cube; owned: number; missing: number[] }[] {
  return cubeCatalog(state.size)
    .filter((cube) =>
      cube.corners.every(
        (index) => state.board[index] === 0 || state.board[index] === player,
      ),
    )
    .map((cube) => ({
      cube,
      owned: cube.corners.filter((index) => state.board[index] === player)
        .length,
      missing: cube.corners.filter((index) => state.board[index] === 0),
    }))
    .filter((item) => item.missing.length > 0)
    .sort(
      (a, b) =>
        b.owned - a.owned ||
        b.cube.volume - a.cube.volume ||
        a.cube.id.localeCompare(b.cube.id),
    );
}

/** Deterministic lookahead values completion, denial, and forks without hidden state. */
export function chooseLatticeMove(state: LatticeState): Point3 {
  if (state.winner !== null)
    throw new EditionRuleError("No move is available after the result.");
  const player = state.turn;
  const opponent = player === 1 ? 2 : 1;
  const ours = cubeProgress(state, player);
  // Builder concentrates on its own structures so a new player can learn cube completion.
  // Tactician also contests the opponent's structures and immediate scoring threats.
  const theirs =
    state.computerStyle === "tactician" ? cubeProgress(state, opponent) : [];
  let best = -Infinity;
  let selected = -1;
  for (let index = 0; index < state.board.length; index++) {
    if (state.board[index] !== 0) continue;
    let value = 0;
    let forks = 0;
    for (const { cube, owned, missing } of ours) {
      if (!missing.includes(index)) continue;
      value +=
        owned === 7
          ? cube.volume * 10000
          : (owned + 1) ** 3 * (1 + Math.log2(cube.volume));
      if (owned === 6) forks++;
    }
    for (const { cube, owned, missing } of theirs) {
      if (!missing.includes(index)) continue;
      value +=
        owned === 7
          ? cube.volume * 7000
          : owned ** 2 * (1 + Math.log2(cube.volume)) * 0.8;
    }
    value += forks > 1 ? forks * 600 : 0;
    const point = pointAt(index, state.size);
    const middle = (state.size - 1) / 2;
    value -=
      (Math.abs(point.x - middle) +
        Math.abs(point.y - middle) +
        Math.abs(point.z - middle)) *
      0.01;
    if (value > best) {
      best = value;
      selected = index;
    }
  }
  if (selected < 0) throw new EditionRuleError("The lattice is full.");
  return pointAt(selected, state.size);
}

export const edition: EditionDefinition<LatticeState> = {
  id: "lattice",
  create: createLattice,
  move: moveLattice,
  chooseMove: chooseLatticeMove,
};
