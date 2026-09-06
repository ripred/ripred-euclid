import { describe, expect, it, vi } from "vitest";
import type { EditionDefinition, EditionState } from "./edition-contract";
import { createRelay, edition, moveRelay, solveRelay } from "./edition-game";
import {
  runEditionCommand,
  editionSnapshot,
  reconcileEditionSession,
} from "./edition-session";
import { EditionRuleError } from "./edition-contract";
import {
  EditionError,
  EditionInvariantError,
  editionErrorResponse,
} from "./edition-session";

const rules: EditionDefinition<EditionState> = {
  id: "test",
  create: () => ({ revision: 0, turn: 1, winner: null }),
  move: (state, action) => ({
    revision: state.revision + 1,
    turn: state.turn === 1 ? 2 : 1,
    winner: action === "win" ? state.turn : null,
  }),
  chooseMove: () => "reply",
};
const start = { kind: "start", commandId: "start-0001", mode: "solo" };
const move = {
  kind: "move",
  commandId: "move-00001",
  expectedId: "game-one",
  expectedRevision: 0,
  action: "place",
};

describe("edition authority", () => {
  it("leaves current rules and absent games unchanged during reconciliation", () => {
    const game = runEditionCommand(rules, null, start, "game-one");
    expect(reconcileEditionSession(rules, null)).toBeNull();
    expect(reconcileEditionSession(rules, game)).toBe(game);
    expect(
      reconcileEditionSession({ ...rules, reconcile: (state) => state }, game),
    ).toBe(game);
  });
  it("upgrades derived results without changing identity, revision, or retry receipts", () => {
    const game = runEditionCommand(rules, null, start, "game-one");
    const before = globalThis.structuredClone(game);
    const upgraded = reconcileEditionSession(
      { ...rules, reconcile: (state) => ({ ...state, winner: 1 }) },
      game,
    )!;
    expect(upgraded.id).toBe(game.id);
    expect(upgraded.mode).toBe(game.mode);
    expect(upgraded.state).toEqual({ ...game.state, winner: 1 });
    expect(upgraded.lastCommand).toBe(game.lastCommand);
    expect(game).toEqual(before);
  });
  it("rejects reconciliation that changes the accepted move revision", () => {
    const game = runEditionCommand(rules, null, start, "game-one");
    expect(() =>
      reconcileEditionSession(
        {
          ...rules,
          reconcile: (state) => ({ ...state, revision: state.revision + 1 }),
        },
        game,
      ),
    ).toThrow(EditionInvariantError);
  });
  it("reconciles an exact retry without repeating the command", () => {
    const game = runEditionCommand(rules, null, start, "game-one");
    const create = vi.fn(rules.create);
    const moveRule = vi.fn(rules.move);
    const upgradedRules: EditionDefinition<EditionState> = {
      ...rules,
      create,
      move: moveRule,
      reconcile: (state) => ({ ...state, winner: 1 }),
    };
    const result = runEditionCommand(upgradedRules, game, start, "new-id");
    expect(result.state).toEqual({ revision: 0, turn: 1, winner: 1 });
    expect(result.id).toBe("game-one");
    expect(result.lastCommand).toBe(game.lastCommand);
    expect(create).not.toHaveBeenCalled();
    expect(moveRule).not.toHaveBeenCalled();
    expect(() =>
      runEditionCommand(upgradedRules, game, { ...start, mode: "duel" }, "x"),
    ).toThrow("already used");
  });
  it("checks stale commands before reconciling saved state", () => {
    const game = runEditionCommand(rules, null, start, "game-one");
    const reconcile = vi.fn((state: EditionState) => state);
    expect(() =>
      runEditionCommand(
        { ...rules, reconcile },
        game,
        { ...move, expectedRevision: 99 },
        "unused",
      ),
    ).toThrow("changed");
    expect(reconcile).not.toHaveBeenCalled();
  });
  it("uses reconciled state for the next accepted puzzle command", () => {
    const puzzle = { ...rules, id: "relay" };
    const game = runEditionCommand(
      puzzle,
      null,
      { ...start, mode: "puzzle" },
      "game-one",
    );
    const moveRule = vi.fn(rules.move);
    const result = runEditionCommand(
      {
        ...puzzle,
        move: moveRule,
        reconcile: (state) => ({ ...state, winner: 1 }),
      },
      game,
      { ...move, action: "undo" },
      "unused",
    );
    expect(moveRule).toHaveBeenCalledWith(
      { revision: 0, turn: 1, winner: 1 },
      "undo",
    );
    expect(result.state.revision).toBe(1);
    expect(result.lastCommand.id).toBe(move.commandId);
  });
  it("separates safe rule/protocol messages from internal failures", () => {
    expect(
      editionErrorResponse(new EditionRuleError("Point occupied.")),
    ).toEqual({ status: 400, error: "Point occupied." });
    expect(editionErrorResponse(new EditionError("Stale move.", 409))).toEqual({
      status: 409,
      error: "Stale move.",
    });
    expect(
      editionErrorResponse(new EditionInvariantError("private details")),
    ).toEqual({
      status: 500,
      error: "The game could not complete that turn. Please reconnect.",
    });
    expect(editionErrorResponse(new Error("private storage key"))).toEqual({
      status: 503,
      error: "The game service is temporarily unavailable. Please reconnect.",
    });
  });
  it("does not run any game rule for a stale command", () => {
    const game = runEditionCommand(rules, null, start, "game-one");
    const moveRule = vi.fn(rules.move);
    const chooseMove = vi.fn(rules.chooseMove);
    expect(() =>
      runEditionCommand(
        { ...rules, move: moveRule, chooseMove },
        game,
        { ...move, expectedRevision: 99 },
        "unused",
      ),
    ).toThrow("changed");
    expect(moveRule).not.toHaveBeenCalled();
    expect(chooseMove).not.toHaveBeenCalled();
  });
  it("leaves the confirmed session intact if the opponent calculation fails", () => {
    const game = runEditionCommand(rules, null, start, "game-one");
    const before = globalThis.structuredClone(game);
    expect(() =>
      runEditionCommand(
        {
          ...rules,
          chooseMove: () => {
            throw new Error("unavailable");
          },
        },
        game,
        move,
        "unused",
      ),
    ).toThrow("unavailable");
    expect(game).toEqual(before);
  });
  it("recognizes broken revision and turn invariants as internal errors", () => {
    const game = runEditionCommand(rules, null, start, "game-one");
    expect(() =>
      runEditionCommand(
        { ...rules, move: (state) => state },
        game,
        move,
        "unused",
      ),
    ).toThrow(EditionInvariantError);
    expect(() =>
      runEditionCommand(
        {
          ...rules,
          move: (state) => ({
            ...state,
            revision: state.revision + 1,
            turn: 2,
          }),
        },
        game,
        move,
        "unused",
      ),
    ).toThrow(EditionInvariantError);
  });
  it("allows a puzzle undo after completion but never runs an opponent", () => {
    const chooseMove = vi.fn(rules.chooseMove);
    const puzzle = { ...rules, id: "relay", chooseMove };
    const game = runEditionCommand(
      puzzle,
      null,
      { ...start, mode: "puzzle" },
      "game-one",
    );
    const completed = runEditionCommand(
      puzzle,
      game,
      { ...move, action: "win" },
      "unused",
    );
    const undone = runEditionCommand(
      puzzle,
      completed,
      { ...move, commandId: "undo-00001", expectedRevision: 1, action: "undo" },
      "unused",
    );
    expect(undone.state.winner).toBeNull();
    expect(undone.state.revision).toBe(2);
    expect(chooseMove).not.toHaveBeenCalled();
  });
  it("owns both turns and does not expose command receipts", () => {
    const game = runEditionCommand(rules, null, start, "game-one");
    const next = runEditionCommand(rules, game, move, "ignored");
    expect(next.state).toEqual({ revision: 2, turn: 1, winner: null });
    expect(editionSnapshot(next)).not.toHaveProperty("lastCommand");
  });
  it("does not call the opponent after a winning move", () => {
    const chooseMove = vi.fn(() => "reply");
    const game = runEditionCommand(rules, null, start, "game-one");
    const next = runEditionCommand(
      { ...rules, chooseMove },
      game,
      { ...move, action: "win" },
      "ignored",
    );
    expect(next.state.revision).toBe(1);
    expect(next.state.winner).toBe(1);
    expect(chooseMove).not.toHaveBeenCalled();
    expect(() =>
      runEditionCommand(
        rules,
        next,
        { ...move, commandId: "late-00001", expectedRevision: 1 },
        "ignored",
      ),
    ).toThrow("finished");
  });
  it("rejects stale revisions, stale restart, replaced games, and command conflicts", () => {
    const game = runEditionCommand(rules, null, start, "game-one");
    expect(() =>
      runEditionCommand(rules, game, { ...move, expectedRevision: 9 }, "x"),
    ).toThrow("changed");
    expect(() =>
      runEditionCommand(rules, game, { ...move, expectedId: "other" }, "x"),
    ).toThrow("changed");
    expect(() =>
      runEditionCommand(
        rules,
        game,
        { ...start, commandId: "start-0002" },
        "x",
      ),
    ).toThrow("changed");
    expect(() =>
      runEditionCommand(rules, game, { ...start, mode: "duel" }, "x"),
    ).toThrow("already used");
  });
  it("replays a successful command without performing another move", () => {
    const game = runEditionCommand(rules, null, start, "game-one");
    const next = runEditionCommand(rules, game, move, "ignored");
    expect(runEditionCommand(rules, next, move, "ignored")).toBe(next);
    expect(runEditionCommand(rules, game, start, "new-id")).toBe(game);
  });
  it("honors pass-and-play and rejects arbitrary modes or commands", () => {
    const game = runEditionCommand(
      rules,
      null,
      { ...start, mode: "duel" },
      "game-one",
    );
    expect(runEditionCommand(rules, game, move, "x").state.revision).toBe(1);
    expect(() =>
      runEditionCommand(rules, null, { ...start, mode: "ranked" }, "x"),
    ).toThrow("Choose");
    expect(() => runEditionCommand(rules, null, null, "x")).toThrow("Invalid");
    expect(() =>
      runEditionCommand(rules, null, { kind: "start" }, "x"),
    ).toThrow("identifier");
  });
});

describe("Relay saved-rule reconciliation", () => {
  const puzzleStart = {
    kind: "start",
    commandId: "puzzle-start",
    mode: "puzzle",
    options: { level: 2 },
  };

  function oldLostPuzzle() {
    const first = moveRelay(createRelay({ level: 2 }), { point: 15 });
    const second = moveRelay(first, { point: 17 });
    const accepted = {
      kind: "move",
      commandId: "puzzle-second",
      expectedId: "legacy-puzzle",
      expectedRevision: 1,
      action: { point: 17 },
    };
    // Both squares were earned, but the former one-move predicate marked a loss.
    const legacy = {
      ...runEditionCommand(edition, null, puzzleStart, "legacy-puzzle"),
      state: { ...second, winner: 0 as const, canFinish: false },
      lastCommand: {
        id: accepted.commandId,
        signature: JSON.stringify(accepted),
      },
    };
    delete legacy.state.rulesVersion;
    return { legacy, accepted };
  }

  it("recognizes a stored D3 then F3 loss as a win without changing its moves", () => {
    const { legacy } = oldLostPuzzle();
    const before = globalThis.structuredClone(legacy);
    const refreshed = reconcileEditionSession(edition, legacy)!;
    expect(refreshed.state.winner).toBe(1);
    expect(refreshed.state.canFinish).toBe(true);
    expect(refreshed.state.completed).toHaveLength(2);
    expect(refreshed.state.placements).toEqual([15, 17]);
    expect(refreshed.state.revision).toBe(2);
    expect(refreshed.lastCommand).toBe(legacy.lastCommand);
    expect(legacy).toEqual(before);
    expect(reconcileEditionSession(edition, refreshed)).toBe(refreshed);
  });

  it("corrects a retry response without placing F3 twice", () => {
    const { legacy, accepted } = oldLostPuzzle();
    const refreshed = runEditionCommand(edition, legacy, accepted, "unused");
    expect(refreshed.state.winner).toBe(1);
    expect(refreshed.state.placements).toEqual([15, 17]);
    expect(refreshed.state.revision).toBe(2);
    expect(refreshed.lastCommand).toEqual(legacy.lastCommand);
  });

  it("uses the corrected result before processing later commands", () => {
    const { legacy } = oldLostPuzzle();
    const next = {
      kind: "move",
      commandId: "puzzle-later",
      expectedId: legacy.id,
      expectedRevision: legacy.state.revision,
      action: { type: "hint" },
    };
    expect(() => runEditionCommand(edition, legacy, next, "unused")).toThrow(
      "Puzzle complete",
    );
    const undone = runEditionCommand(
      edition,
      legacy,
      { ...next, action: { type: "undo" } },
      "unused",
    );
    expect(undone.state.winner).toBeNull();
    expect(undone.state.completed).toHaveLength(1);
    expect(undone.state.canFinish).toBe(true);
    expect(undone.state.revision).toBe(3);
  });

  it("replaces obsolete dead-end advice after the first square was completed", () => {
    const first = moveRelay(createRelay({ level: 2 }), { point: 15 });
    const legacy = {
      ...runEditionCommand(edition, null, puzzleStart, "legacy-puzzle"),
      state: {
        ...first,
        revision: 2,
        canFinish: false,
        hint: { point: null, message: "No finish fits the moves left. Undo." },
      },
    };
    delete legacy.state.rulesVersion;
    const refreshed = reconcileEditionSession(edition, legacy)!;
    expect(refreshed.state.winner).toBeNull();
    expect(refreshed.state.canFinish).toBe(true);
    expect(refreshed.state.hint?.point).toBe(17);
    expect(refreshed.state.hint?.message).not.toContain("Undo");
    expect(refreshed.state.hint?.squares).toHaveLength(1);
    expect(refreshed.state.placements).toEqual([15]);
    expect(refreshed.state.revision).toBe(2);
  });

  it("reconciles generated puzzles against their saved board, not a collection fixture", () => {
    const game = runEditionCommand(
      edition,
      null,
      {
        ...puzzleStart,
        options: {
          generator: {
            moves: 2,
            goal: 2,
            difficulty: "standard",
            seed: "saved-route",
          },
        },
      },
      "generated-puzzle",
    );
    const stale = {
      ...game,
      state: { ...game.state, canFinish: false },
    };
    delete stale.state.rulesVersion;
    const refreshed = reconcileEditionSession(edition, stale)!;
    expect(refreshed.state.generatedPuzzle).toEqual(game.state.generatedPuzzle);
    expect(refreshed.state.cells).toEqual(game.state.cells);
    expect(refreshed.state.canFinish).toBe(true);
    expect(refreshed.state.revision).toBe(0);
    expect(refreshed.lastCommand).toBe(game.lastCommand);

    const solution = solveRelay(refreshed.state)!;
    let current = refreshed;
    for (const [index, point] of solution.entries()) {
      current = runEditionCommand(
        edition,
        current,
        {
          kind: "move",
          commandId: `generated-move-${index}`,
          expectedId: current.id,
          expectedRevision: current.state.revision,
          action: { point },
        },
        "unused",
      );
    }
    expect(current.state.winner).toBe(1);
    expect(current.state.generatedPuzzle).toEqual(game.state.generatedPuzzle);
    expect(current.state.revision).toBe(2);
  });
});
