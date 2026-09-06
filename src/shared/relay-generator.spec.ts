import { describe, expect, it, vi } from "vitest";
import {
  createRelay,
  moveRelay,
  reconcileRelay,
  relayPuzzle,
  solveRelay,
  type RelayState,
} from "./edition-game";
import {
  generateRelayPuzzle,
  readRelayGeneratorOptions,
  RELAY_GENERATOR_LIMITS,
  type RelayDifficulty,
  type RelayGeneratorOptions,
} from "./relay-generator";
import { SIZE, SQUARES, type RelayPuzzle } from "./relay-puzzle";

const difficulties: RelayDifficulty[] = ["beginner", "standard", "expert"];
const configurations = difficulties.flatMap((difficulty) =>
  Array.from({ length: 4 }, (_, moveIndex) => moveIndex + 1).flatMap((moves) =>
    Array.from({ length: 4 }, (_, goalIndex) => ({
      moves,
      goal: goalIndex + 1,
      difficulty,
      seed: `regression-${difficulty}-${moves}-${goalIndex + 1}`,
    })),
  ),
);

// Independent geometry oracle: four equal sides and two twice-as-long squared
// diagonals. This deliberately does not use the production square constructor.
function squareFromDistances(points: readonly number[]): boolean {
  const distances: number[] = [];
  for (let a = 0; a < points.length; a++) {
    for (let b = a + 1; b < points.length; b++) {
      const p = points[a]!;
      const q = points[b]!;
      distances.push(
        ((p % SIZE) - (q % SIZE)) ** 2 +
          (Math.floor(p / SIZE) - Math.floor(q / SIZE)) ** 2,
      );
    }
  }
  distances.sort((a, b) => a - b);
  return (
    distances[0]! > 0 &&
    distances[0] === distances[1] &&
    distances[0] === distances[2] &&
    distances[0] === distances[3] &&
    distances[4] === 2 * distances[0]! &&
    distances[5] === distances[4]
  );
}

function enumerateIndependentSquares(): number[][] {
  const squares: number[][] = [];
  for (let a = 0; a < SIZE * SIZE; a++)
    for (let b = a + 1; b < SIZE * SIZE; b++)
      for (let c = b + 1; c < SIZE * SIZE; c++)
        for (let d = c + 1; d < SIZE * SIZE; d++) {
          const corners = [a, b, c, d];
          if (squareFromDistances(corners)) squares.push(corners);
        }
  return squares;
}

const independentSquares = enumerateIndependentSquares();

function completedCount(occupied: Set<number>): number {
  return independentSquares.filter((square) =>
    square.every((point) => occupied.has(point)),
  ).length;
}

/** Search actual point subsets, independently of production square-union search. */
function hasShorterWin(puzzle: RelayPuzzle): boolean {
  const occupied = new Set(puzzle.initial);
  const empty = Array.from({ length: SIZE * SIZE }, (_, point) => point).filter(
    (point) => !occupied.has(point),
  );
  function search(index: number, remaining: number): boolean {
    if (completedCount(occupied) >= puzzle.goal) return true;
    if (remaining === 0) return false;
    for (let next = index; next < empty.length; next++) {
      const point = empty[next]!;
      occupied.add(point);
      const found = search(next + 1, remaining - 1);
      occupied.delete(point);
      if (found) return true;
    }
    return false;
  }
  return search(0, puzzle.moves - 1);
}

describe("Relay deterministic puzzle generator", () => {
  it("agrees with independently enumerated square geometry", () => {
    expect(independentSquares).toHaveLength(105);
    expect(independentSquares.map((square) => square.join("-")).sort()).toEqual(
      SQUARES.map((square) => square.id).sort(),
    );
  });

  it.each(configurations)(
    "certifies $difficulty / $moves moves / $goal squares without a shorter win",
    (options) => {
      const puzzle = generateRelayPuzzle(options);
      expect(puzzle).toEqual(generateRelayPuzzle(options));
      expect(puzzle.generator).toEqual(options);
      expect(puzzle.moves).toBe(options.moves);
      expect(puzzle.goal).toBe(options.goal);
      expect(new Set(puzzle.initial).size).toBe(puzzle.initial.length);
      expect(new Set(puzzle.solution).size).toBe(options.moves);
      expect(puzzle.solution).toHaveLength(options.moves);
      expect(
        [...puzzle.initial, ...puzzle.solution].every(
          (point) =>
            Number.isInteger(point) && point >= 0 && point < SIZE * SIZE,
        ),
      ).toBe(true);
      expect(
        puzzle.solution.some((point) => puzzle.initial.includes(point)),
      ).toBe(false);
      expect(completedCount(new Set(puzzle.initial))).toBe(0);
      expect(
        completedCount(new Set([...puzzle.initial, ...puzzle.solution])),
      ).toBeGreaterThanOrEqual(options.goal);
      expect(hasShorterWin(puzzle)).toBe(false);

      let state = createRelay({ generator: options });
      expect(solveRelay(state)).toEqual(puzzle.solution);
      // Reversing a solution cannot affect the cumulative objective.
      for (const point of [...puzzle.solution].reverse()) {
        expect(state.winner).toBeNull();
        state = moveRelay(state, { point });
        expect(state.canFinish).toBe(true);
      }
      expect(state.winner).toBe(1);
      expect(new Set(state.completed).size).toBe(state.completed.length);
    },
  );

  it.each(difficulties)(
    "creates genuinely different %s boards from different seeds",
    (difficulty) => {
      const boards = new Set(
        Array.from({ length: 40 }, (_, index) =>
          generateRelayPuzzle({
            moves: 3,
            goal: 3,
            difficulty,
            seed: `variation-${index}`,
          }).initial.join(","),
        ),
      );
      expect(boards.size).toBeGreaterThan(30);
    },
  );

  it("uses different structural construction policies for difficulty", () => {
    const options = { moves: 2, goal: 2, seed: "structural-difficulty" };
    const beginner = generateRelayPuzzle({
      ...options,
      difficulty: "beginner",
    });
    const standard = generateRelayPuzzle({
      ...options,
      difficulty: "standard",
    });
    const expert = generateRelayPuzzle({ ...options, difficulty: "expert" });
    expect(
      new Set(
        [beginner, standard, expert].map((puzzle) => puzzle.initial.join(",")),
      ).size,
    ).toBe(3);
    expect(standard.initial.length).toBeGreaterThan(beginner.initial.length);
    expect(expert.initial.length).toBeGreaterThan(standard.initial.length);
    expect(beginner.description).toContain("aligned");
    expect(expert.description).toContain("Other routes may also work");
  });

  it.each(difficulties)(
    "allows the necessarily empty four-move one-square %s puzzle",
    (difficulty) => {
      const puzzle = generateRelayPuzzle({
        moves: 4,
        goal: 1,
        difficulty,
        seed: "foundation",
      });
      expect(puzzle.initial).toEqual([]);
      expect(puzzle.description).toContain("empty board");
      expect(hasShorterWin(puzzle)).toBe(false);
    },
  );

  it("accepts Unicode seeds reproducibly and does not mutate input", () => {
    const options: RelayGeneratorOptions = Object.freeze({
      moves: 3,
      goal: 4,
      difficulty: "expert",
      seed: "Cuadrados – 四角 ◇",
    });
    expect(generateRelayPuzzle(options)).toEqual(generateRelayPuzzle(options));
    expect(options.seed).toBe("Cuadrados – 四角 ◇");
  });

  it.each([undefined, null, [], "settings", {}, { difficulty: "beginner" }])(
    "rejects malformed settings %j",
    (settings) => {
      expect(() => readRelayGeneratorOptions(settings)).toThrow();
      expect(() => createRelay({ generator: settings })).toThrow();
    },
  );

  it.each(["moves", "goal"])(
    "validates numeric %s without coercion",
    (field) => {
      const options: RelayGeneratorOptions = {
        moves: 2,
        goal: 2,
        difficulty: "standard",
        seed: "validation",
      };
      for (const value of [
        -1,
        0,
        5,
        1.5,
        NaN,
        Infinity,
        -Infinity,
        true,
        "2",
        null,
        undefined,
      ]) {
        expect(() =>
          readRelayGeneratorOptions({ ...options, [field]: value }),
        ).toThrow("support");
        expect(() =>
          createRelay({ generator: { ...options, [field]: value } }),
        ).toThrow("support");
      }
    },
  );

  it.each(["easy", "EXPERT", "", false, null, undefined])(
    "rejects unknown difficulty %j",
    (difficulty) => {
      expect(() =>
        readRelayGeneratorOptions({
          moves: 2,
          goal: 2,
          seed: "validation",
          difficulty,
        }),
      ).toThrow("difficulty");
    },
  );

  it.each([
    "",
    " \n\t",
    "a".repeat(RELAY_GENERATOR_LIMITS.maxSeedLength + 1),
    42,
    null,
    undefined,
  ])("rejects malformed seed %j", (seed) => {
    expect(() =>
      readRelayGeneratorOptions({
        moves: 2,
        goal: 2,
        difficulty: "standard",
        seed,
      }),
    ).toThrow("seed");
  });
});

describe("Relay generated-puzzle state", () => {
  const generator: RelayGeneratorOptions = {
    moves: 4,
    goal: 3,
    difficulty: "expert",
    seed: "saved-generated-puzzle",
  };

  it("stores a resumable definition without the private solution witness", () => {
    const puzzle = generateRelayPuzzle(generator);
    const state = createRelay({ generator });
    expect(state.generatedPuzzle).toEqual({
      name: puzzle.name,
      description: puzzle.description,
      initial: puzzle.initial,
      moves: puzzle.moves,
      goal: puzzle.goal,
      generator,
    });
    expect(state.generatedPuzzle).not.toHaveProperty("solution");
    expect(relayPuzzle(state)).toBe(state.generatedPuzzle);
    expect(
      createRelay({ generator: state.generatedPuzzle?.generator }),
    ).toEqual(state);
    expect(createRelay()).not.toHaveProperty("generatedPuzzle");
  });

  it("provides server-owned fresh seeds only when none is supplied", () => {
    const random = vi
      .spyOn(globalThis.crypto, "randomUUID")
      .mockReturnValueOnce("11111111-1111-4111-8111-111111111111")
      .mockReturnValueOnce("22222222-2222-4222-8222-222222222222");
    try {
      const settings = { moves: 2, goal: 2, difficulty: "standard" };
      const first = createRelay({ generator: settings });
      const second = createRelay({ generator: settings });
      expect(first.generatedPuzzle?.generator?.seed).not.toBe(
        second.generatedPuzzle?.generator?.seed,
      );
      expect(first.cells).not.toEqual(second.cells);
      createRelay({ generator });
      expect(random).toHaveBeenCalledTimes(2);
    } finally {
      random.mockRestore();
    }
  });

  it("resumes, hints, finishes and undoes using the saved generated definition", () => {
    const original = createRelay({ generator });
    let state: RelayState = JSON.parse(JSON.stringify(original));
    while (state.winner === null) {
      const plan = solveRelay(state)!;
      const hint = moveRelay(state, { type: "hint" });
      const finish = plan.reduce(
        (current, point) => moveRelay(current, { point }),
        state,
      );
      expect(hint.hint?.point).toBe(plan[0]);
      expect([...(hint.hint?.squares ?? [])].sort()).toEqual(
        finish.completed.filter((id) => !state.completed.includes(id)).sort(),
      );
      state = moveRelay(hint, { point: hint.hint?.point });
      expect(state.hint).toBeNull();
      expect(state.generatedPuzzle).toEqual(original.generatedPuzzle);
      expect(state.canFinish).toBe(true);
    }
    expect(state.winner).toBe(1);
    while (state.placements.length > 0)
      state = moveRelay(state, { type: "undo" });
    expect(state).toEqual({ ...original, revision: state.revision });
  });

  it("reconciles an old generated definition once without changing the command revision", () => {
    const initial = createRelay({ generator });
    const hinted = moveRelay(initial, { type: "hint" });
    const old = { ...hinted };
    delete old.rulesVersion;
    delete old.canFinish;
    old.hint = { point: null, message: "Old guidance" };
    const updated = reconcileRelay(old);
    expect(updated).toEqual(hinted);
    expect(reconcileRelay(updated)).toBe(updated);
    expect(old).not.toHaveProperty("rulesVersion");
    expect(old.hint.message).toBe("Old guidance");
  });
});
