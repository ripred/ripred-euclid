import { describe, expect, it, vi } from "vitest";
import type { EditionDefinition, EditionState } from "./edition-contract";
import {
  editionHostName,
  editionLiveSummary,
  editionWatchSnapshot,
  isEditionGameId,
  LIVE_IDLE_MS,
  WATCH_RETENTION_MS,
} from "./edition-live";
import { editionSnapshot, runEditionCommand } from "./edition-session";

const id = "12d566fb-97af-4c7f-a1e6-b07c6d440111";
const nextId = "12d566fb-97af-4c7f-a1e6-b07c6d440222";
const time = 1_000_000_000;
const activity = { updatedAt: time, hostName: "ripred3" };
const rules: EditionDefinition<EditionState & { hint: string | null }> = {
  id: "test",
  create: () => ({ revision: 0, turn: 1, winner: null, hint: "private route" }),
  move: (state, action) => ({
    ...state,
    revision: state.revision + 1,
    turn: state.turn === 1 ? 2 : 1,
    winner: action === "win" ? state.turn : null,
  }),
  chooseMove: () => "reply",
  spectatorState: (state) => ({ ...state, hint: null }),
};
const start = { kind: "start", commandId: "start-0001", mode: "solo" };
const visibility = {
  kind: "spectators",
  enabled: true,
  commandId: "allow-0001",
  expectedId: id,
  expectedRevision: 0,
};
const create = () => runEditionCommand(rules, null, start, id, activity);
const publish = () =>
  runEditionCommand(rules, create(), visibility, nextId, activity);

describe("edition spectator authority and projection", () => {
  it("starts private and ignores forged visibility, owner and timestamps", () => {
    const game = runEditionCommand(
      rules,
      null,
      {
        ...start,
        spectatorsEnabled: true,
        hostName: "forged",
        updatedAt: time + 99999,
        owner: "victim",
      },
      id,
      activity,
    );
    expect(game.spectatorsEnabled).toBe(false);
    expect(game.activity).toEqual(activity);
    expect(editionWatchSnapshot(rules, game, id, time)).toBeNull();
  });
  it("changes visibility without placing, replying, or changing move revision", () => {
    const current = create();
    const move = vi.fn(rules.move);
    const chooseMove = vi.fn(rules.chooseMove);
    const game = runEditionCommand(
      { ...rules, move, chooseMove },
      current,
      visibility,
      nextId,
      activity,
    );
    expect(game.state).toBe(current.state);
    expect(game.id).toBe(id);
    expect(game.spectatorsEnabled).toBe(true);
    expect(move).not.toHaveBeenCalled();
    expect(chooseMove).not.toHaveBeenCalled();
  });
  it("retries the same visibility command without extending activity", () => {
    const game = publish();
    expect(
      runEditionCommand(rules, game, visibility, nextId, {
        ...activity,
        updatedAt: time + 1,
      }),
    ).toBe(game);
    expect(() =>
      runEditionCommand(rules, game, { ...visibility, enabled: false }, nextId),
    ).toThrow("already used");
  });
  it.each([undefined, null, 1, "true", {}])(
    "rejects non-boolean visibility %j",
    (enabled) => {
      expect(() =>
        runEditionCommand(rules, create(), { ...visibility, enabled }, nextId),
      ).toThrow("allow spectators");
    },
  );
  it("rejects absent, wrong-match and stale visibility commands", () => {
    expect(() => runEditionCommand(rules, null, visibility, nextId)).toThrow(
      "Start a game",
    );
    for (const patch of [{ expectedId: nextId }, { expectedRevision: 9 }])
      expect(() =>
        runEditionCommand(rules, create(), { ...visibility, ...patch }, nextId),
      ).toThrow("changed");
  });
  it("retains visibility on moves but starts replacement matches private", () => {
    const next = runEditionCommand(
      rules,
      publish(),
      {
        kind: "move",
        commandId: "move-0001",
        expectedId: id,
        expectedRevision: 0,
        action: "place",
      },
      nextId,
      activity,
    );
    expect(next.spectatorsEnabled).toBe(true);
    expect(next.state.revision).toBe(2);
    const restart = runEditionCommand(
      rules,
      next,
      {
        ...start,
        commandId: "start-0002",
        expectedId: id,
        expectedRevision: 2,
      },
      nextId,
      activity,
    );
    expect(restart.spectatorsEnabled).toBe(false);
    expect(editionWatchSnapshot(rules, restart, id, time)).toBeNull();
  });
  it("redacts receipts, owner metadata and private coaching without changing owner state", () => {
    const game = publish();
    const snapshot = editionWatchSnapshot(rules, game, id, time)!;
    expect(snapshot).toEqual({
      id,
      mode: "solo",
      state: { ...game.state, hint: null },
      hostName: "ripred3",
      updatedAt: time,
    });
    expect(game.state.hint).toBe("private route");
    expect(editionSnapshot(game)).not.toHaveProperty("activity");
    expect(editionSnapshot(game)).not.toHaveProperty("lastCommand");
  });
  it("requires an enabled canonical game and valid authoritative activity", () => {
    const game = publish();
    for (const updatedAt of [
      NaN,
      Infinity,
      time + 1,
      time - WATCH_RETENTION_MS,
    ])
      expect(
        editionWatchSnapshot(
          rules,
          { ...game, activity: { ...activity, updatedAt } },
          id,
          time,
        ),
      ).toBeNull();
    const legacy = { ...game };
    delete legacy.activity;
    expect(editionWatchSnapshot(rules, legacy, id, time)).toBeNull();
    expect(
      editionWatchSnapshot(
        rules,
        { ...game, spectatorsEnabled: false },
        id,
        time,
      ),
    ).toBeNull();
    expect(editionWatchSnapshot(rules, game, nextId, time)).toBeNull();
  });
  it("lists fresh unfinished games but permits terminal or idle direct watching for 24 hours", () => {
    const game = publish();
    const snapshot = editionWatchSnapshot(rules, game, id, time)!;
    expect(editionLiveSummary(snapshot, time)).toEqual({
      id,
      mode: "solo",
      hostName: "ripred3",
      updatedAt: time,
      revision: 0,
    });
    expect(editionLiveSummary(snapshot, time + LIVE_IDLE_MS)).toBeNull();
    expect(
      editionWatchSnapshot(rules, game, id, time + LIVE_IDLE_MS),
    ).not.toBeNull();
    expect(
      editionLiveSummary(
        { ...snapshot, state: { ...snapshot.state, winner: 1 } },
        time,
      ),
    ).toBeNull();
    expect(
      editionWatchSnapshot(
        rules,
        { ...game, state: { ...game.state, winner: 1 } },
        id,
        time + WATCH_RETENTION_MS - 1,
      ),
    ).not.toBeNull();
    expect(
      editionWatchSnapshot(rules, game, id, time + WATCH_RETENTION_MS),
    ).toBeNull();
  });
  it.each([
    "",
    "../owner",
    "someone",
    "x".repeat(36),
    "12d566fb-97af-4c7f-a1e6-b07c6d440111/extra",
  ])("rejects non-game identifiers %s", (value) =>
    expect(isEditionGameId(value)).toBe(false),
  );
  it("accepts opaque UUIDs and sanitizes public labels", () => {
    expect(isEditionGameId(id)).toBe(true);
    expect(editionHostName("ripred3")).toBe("ripred3");
    for (const value of [undefined, "", "<script>", "name\n", "a".repeat(41)])
      expect(editionHostName(value)).toBe("Redditor");
  });
});
