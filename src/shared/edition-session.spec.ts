import { describe, expect, it, vi } from "vitest";
import type { EditionDefinition, EditionState } from "./edition-contract";
import { runEditionCommand, editionSnapshot } from "./edition-session";
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
