import { describe, expect, it } from "vitest";
import {
  createRelay,
  moveRelay,
  PUZZLES,
  solveRelay,
  type RelayState,
} from "../../shared/edition-game";
import { selectedRelayPoint, type RelaySelection } from "./relay-selection";

const gameId = "relay-test-session";

function selection(game: RelayState, point: number): RelaySelection {
  return { gameId, revision: game.revision, point };
}

describe("Relay point selection", () => {
  it("selects the authoritative hint without consuming a placement", () => {
    const game = moveRelay(createRelay({ level: 2 }), { type: "hint" });

    expect(selectedRelayPoint(game, gameId, null)).toBe(game.hint?.point);
    expect(game.placements).toEqual([]);
  });

  it("lets the player override a hint on the same game revision", () => {
    const game = moveRelay(createRelay({ level: 2 }), { type: "hint" });
    const alternative = game.cells.findIndex(
      (cell, point) => cell === 0 && point !== game.hint?.point,
    );

    expect(selectedRelayPoint(game, gameId, selection(game, alternative))).toBe(
      alternative,
    );
  });

  it("preserves a manual selection across a refresh of the same revision", () => {
    const game = createRelay({ level: 2 });
    const point = game.cells.indexOf(0);
    const refreshed = { ...game, cells: [...game.cells] };

    expect(selectedRelayPoint(refreshed, gameId, selection(game, point))).toBe(
      point,
    );
  });

  it("replaces an older manual selection with a newly requested hint", () => {
    const game = createRelay({ level: 2 });
    const point = game.cells.indexOf(0);
    const hinted = moveRelay(game, { type: "hint" });

    expect(point).not.toBe(hinted.hint?.point);
    expect(selectedRelayPoint(hinted, gameId, selection(game, point))).toBe(
      hinted.hint?.point,
    );
  });

  it("clears a selection after a placement advances the revision", () => {
    const game = createRelay({ level: 2 });
    const point = PUZZLES[2]!.solution[0]!;
    const placed = moveRelay(game, { point });

    expect(
      selectedRelayPoint(placed, gameId, selection(game, point)),
    ).toBeNull();
  });

  it("does not carry a selection into a restarted game with the same revision", () => {
    const game = createRelay({ level: 2 });
    const point = game.cells.indexOf(0);

    expect(
      selectedRelayPoint(game, "new-relay-session", selection(game, point)),
    ).toBeNull();
  });

  it("uses the restarted game's own hint instead of the previous selection", () => {
    const game = moveRelay(createRelay({ level: 2 }), { type: "hint" });
    const previousPoint = game.cells.indexOf(0);

    expect(
      selectedRelayPoint(
        game,
        "new-relay-session",
        selection(game, previousPoint),
      ),
    ).toBe(game.hint?.point);
  });

  it("does not select a point for an impossible hint", () => {
    const blocked = moveRelay(createRelay({ level: 2 }), {
      point: 6,
    });
    const game = moveRelay(blocked, { type: "hint" });

    expect(game.hint?.point).toBeNull();
    expect(selectedRelayPoint(game, gameId, null)).toBeNull();
  });

  it("does not select anything before a game and identity are available", () => {
    const game = createRelay({ level: 2 });
    const chosen = selection(game, game.cells.indexOf(0));

    expect(selectedRelayPoint(null, gameId, chosen)).toBeNull();
    expect(selectedRelayPoint(game, null, chosen)).toBeNull();
    expect(selectedRelayPoint(game, gameId, null)).toBeNull();
  });

  it("rejects an occupied selected or suggested point", () => {
    const game = createRelay({ level: 2 });
    const occupied = game.cells.indexOf(1);

    expect(
      selectedRelayPoint(game, gameId, selection(game, occupied)),
    ).toBeNull();
    expect(
      selectedRelayPoint(
        { ...game, hint: { point: occupied, message: "An obsolete hint." } },
        gameId,
        null,
      ),
    ).toBeNull();
  });

  it.each([-1, 36, 0.5, NaN])(
    "rejects an invalid selected point %s",
    (point) => {
      const game = createRelay({ level: 2 });

      expect(
        selectedRelayPoint(game, gameId, selection(game, point)),
      ).toBeNull();
    },
  );

  it.each([14, 35])(
    "clears point selection when the puzzle has ended",
    (point) => {
      const game = moveRelay(createRelay(), { point });
      const empty = game.cells.indexOf(0);

      expect(game.winner).not.toBeNull();
      expect(
        selectedRelayPoint(game, gameId, selection(game, empty)),
      ).toBeNull();
    },
  );
});

describe("Relay generated puzzle selection", () => {
  const options = {
    generator: {
      moves: 2,
      goal: 1,
      difficulty: "beginner",
      seed: "generated-selection",
    },
  };

  it("selects a generated hint while allowing a deliberate override", () => {
    const game = moveRelay(createRelay(options), { type: "hint" });
    const alternative = game.cells.findIndex(
      (cell, point) => cell === 0 && point !== game.hint!.point,
    );

    expect(game.generatedPuzzle).toBeDefined();
    expect(selectedRelayPoint(game, gameId, null)).toBe(game.hint!.point);
    expect(selectedRelayPoint(game, gameId, selection(game, alternative))).toBe(
      alternative,
    );
  });

  it("clears the old selection when the same generated seed is restarted", () => {
    const initial = createRelay(options);
    const restarted = createRelay(options);
    const point = initial.cells.indexOf(0);

    expect(restarted.cells).toEqual(initial.cells);
    expect(restarted.revision).toBe(initial.revision);
    expect(
      selectedRelayPoint(
        restarted,
        "restarted-generated-game",
        selection(initial, point),
      ),
    ).toBeNull();
  });

  it("selects a fresh generated hint after undo without consuming another move", () => {
    const initial = createRelay(options);
    const solution = solveRelay(initial);
    expect(solution).toHaveLength(2);
    const placed = moveRelay(initial, { point: solution![0] });
    const restored = moveRelay(placed, { type: "undo" });
    const hinted = moveRelay(restored, { type: "hint" });
    const oldSelection = selection(initial, initial.cells.indexOf(0));

    expect(restored.cells).toEqual(initial.cells);
    expect(restored.generatedPuzzle).toEqual(initial.generatedPuzzle);
    expect(hinted.placements).toEqual([]);
    expect(selectedRelayPoint(hinted, gameId, oldSelection)).toBe(
      hinted.hint!.point,
    );
  });
});
