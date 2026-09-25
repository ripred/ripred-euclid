import { squareCatalog } from "./game/geometry";

export const CHALLENGE_SIZE = 8;
export const CHALLENGE_VERSION = 1;
export const CHALLENGE_GEOMETRIES = [
  "aligned",
  "mixed",
  "tilted",
  "oblique",
] as const;
export type ChallengeGeometry = (typeof CHALLENGE_GEOMETRIES)[number];

export interface ChallengeOptions {
  minimumMoves: number;
  targetSquares: number;
  geometry: ChallengeGeometry;
  sharedCorner: boolean;
  blockedCount: number;
  blockedPoints: number[];
  multipleSolutions: boolean;
  seed?: string;
}

export const DEFAULT_CHALLENGE_OPTIONS: ChallengeOptions = {
  minimumMoves: 2,
  targetSquares: 3,
  geometry: "oblique",
  sharedCorner: true,
  blockedCount: 0,
  blockedPoints: [],
  multipleSolutions: false,
};

/** Safe puzzle definition: no seed or private solution witnesses. */
export interface ChallengePuzzle {
  version: typeof CHALLENGE_VERSION;
  size: typeof CHALLENGE_SIZE;
  initial: number[];
  blocked: number[];
  minimumMoves: number;
  targetSquares: number;
}

export interface ChallengeSnapshot {
  puzzleId: string;
  attemptId: string;
  revision: number;
  puzzle: ChallengePuzzle;
  placements: number[];
  completedSquares: string[];
  complete: boolean;
  bestMoves: number | null;
  startedAt: number;
  finishedAt: number | null;
  elapsedMs: number;
  bestElapsedMs: number | null;
}

export interface ChallengeCommand {
  commandId: string;
  expectedRevision: number;
  puzzleId: string | null;
  attemptId: string | null;
}
export interface ChallengeGenerateRequest extends ChallengeCommand {
  options: ChallengeOptions;
}
export interface ChallengeMoveRequest extends ChallengeCommand {
  point: number;
}
export interface ChallengeResponse {
  snapshot: ChallengeSnapshot | null;
}

export class ChallengeError extends Error {
  constructor(
    public readonly code:
      | "invalid"
      | "unavailable"
      | "search_limit"
      | "stale"
      | "expired"
      | "forbidden",
    message: string,
  ) {
    super(message);
    this.name = "ChallengeError";
  }
}

export function readChallengeOptions(value: unknown): ChallengeOptions {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new ChallengeError("invalid", "Choose puzzle settings.");
  const o = value as Record<string, unknown>;
  const fields = new Set([
    "minimumMoves",
    "targetSquares",
    "geometry",
    "sharedCorner",
    "blockedCount",
    "blockedPoints",
    "multipleSolutions",
    "seed",
  ]);
  if (Object.keys(o).some((key) => !fields.has(key)))
    throw new ChallengeError("invalid", "Unknown puzzle setting.");
  const integer = (key: string, min: number, max: number): number => {
    const n = o[key];
    if (typeof n !== "number" || !Number.isSafeInteger(n) || n < min || n > max)
      throw new ChallengeError(
        "invalid",
        `${key} must be an integer from ${min} through ${max}.`,
      );
    return n;
  };
  const minimumMoves = integer("minimumMoves", 1, 4);
  const targetSquares = integer("targetSquares", 1, 4);
  const blockedCount = integer("blockedCount", 0, 60);
  if (!CHALLENGE_GEOMETRIES.includes(o.geometry as ChallengeGeometry))
    throw new ChallengeError("invalid", "Choose a supported geometry.");
  if (
    typeof o.sharedCorner !== "boolean" ||
    typeof o.multipleSolutions !== "boolean"
  )
    throw new ChallengeError(
      "invalid",
      "Choose the shared-corner and multiple-solution settings.",
    );
  if (
    !Array.isArray(o.blockedPoints) ||
    o.blockedPoints.length > blockedCount ||
    o.blockedPoints.some((p) => !Number.isSafeInteger(p) || p < 0 || p >= 64) ||
    new Set(o.blockedPoints).size !== o.blockedPoints.length
  )
    throw new ChallengeError(
      "invalid",
      "Blocked points must be distinct board positions and fit the total blocked count.",
    );
  if (
    o.seed !== undefined &&
    (typeof o.seed !== "string" || o.seed.length > 80)
  )
    throw new ChallengeError(
      "invalid",
      "The seed must be at most 80 characters.",
    );
  const seed = typeof o.seed === "string" ? o.seed.trim() : "";
  return {
    minimumMoves,
    targetSquares,
    geometry: o.geometry as ChallengeGeometry,
    sharedCorner: o.sharedCorner,
    blockedCount,
    blockedPoints: [...o.blockedPoints].sort((a: number, b: number) => a - b),
    multipleSolutions: o.multipleSolutions,
    ...(seed ? { seed } : {}),
  };
}

export function completedChallengeSquares(
  puzzle: ChallengePuzzle,
  placements: readonly number[],
): string[] {
  const occupied = new Set([...puzzle.initial, ...placements]);
  const blocked = new Set(puzzle.blocked);
  return squareCatalog(puzzle.size)
    .filter((s) => s.corners.every((p) => occupied.has(p) && !blocked.has(p)))
    .map((s) => s.id);
}

/** Accepted placements are append-only. The optimum never acts as a move cap. */
export function placeChallengePoint(
  snapshot: ChallengeSnapshot,
  point: number,
  now = Date.now(),
): ChallengeSnapshot {
  if (snapshot.complete)
    throw new ChallengeError(
      "invalid",
      "This attempt is complete. Restart to try again.",
    );
  if (
    !Number.isSafeInteger(point) ||
    point < 0 ||
    point >= snapshot.puzzle.size ** 2
  )
    throw new ChallengeError("invalid", "Choose a point on the board.");
  if (snapshot.puzzle.blocked.includes(point))
    throw new ChallengeError("invalid", "That point is blocked.");
  if (
    snapshot.puzzle.initial.includes(point) ||
    snapshot.placements.includes(point)
  )
    throw new ChallengeError("invalid", "That point is occupied.");
  const placements = [...snapshot.placements, point];
  const completedSquares = completedChallengeSquares(
    snapshot.puzzle,
    placements,
  );
  const complete = completedSquares.length >= snapshot.puzzle.targetSquares;
  const elapsedMs = Math.max(0, now - snapshot.startedAt);
  const improvesBest =
    complete &&
    (snapshot.bestMoves === null ||
      placements.length < snapshot.bestMoves ||
      (placements.length === snapshot.bestMoves &&
        elapsedMs < (snapshot.bestElapsedMs ?? Infinity)));
  return {
    ...snapshot,
    placements,
    completedSquares,
    complete,
    revision: snapshot.revision + 1,
    elapsedMs,
    finishedAt: complete ? now : null,
    bestMoves: improvesBest ? placements.length : snapshot.bestMoves,
    bestElapsedMs: improvesBest ? elapsedMs : snapshot.bestElapsedMs,
  };
}
