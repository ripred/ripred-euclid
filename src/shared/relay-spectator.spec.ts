import { describe, expect, it } from "vitest";
import { edition } from "./edition-game";
import { editionWatchSnapshot } from "./edition-live";
import { runEditionCommand } from "./edition-session";

describe("Relay spectator projection", () => {
  it.each([
    { level: 2 },
    {
      generator: {
        moves: 2,
        goal: 2,
        difficulty: "standard",
        seed: "spectator-test",
      },
    },
  ])(
    "retains puzzle state without publishing the host's hint or solvability analysis: %j",
    (options) => {
      const id = "12d566fb-97af-4c7f-a1e6-b07c6d440111";
      const activity = { updatedAt: 1000, hostName: "ripred3" };
      const started = runEditionCommand(
        edition,
        null,
        { kind: "start", commandId: "start-0001", mode: "puzzle", options },
        id,
        activity,
      );
      const hinted = runEditionCommand(
        edition,
        started,
        {
          kind: "move",
          commandId: "hint-00001",
          expectedId: id,
          expectedRevision: 0,
          action: { type: "hint" },
        },
        id,
        activity,
      );
      const published = runEditionCommand(
        edition,
        hinted,
        {
          kind: "spectators",
          commandId: "allow-0001",
          expectedId: id,
          expectedRevision: hinted.state.revision,
          enabled: true,
        },
        id,
        activity,
      );
      const watched = editionWatchSnapshot(edition, published, id, 1000)!;
      expect(published.state.hint?.point).not.toBeNull();
      expect(published.state.canFinish).toBe(true);
      expect(watched.state.hint).toBeNull();
      expect(watched.state).not.toHaveProperty("canFinish");
      expect(watched.state.cells).toEqual(published.state.cells);
      expect(watched.state.placements).toEqual(published.state.placements);
      expect(watched.state.generatedPuzzle).toEqual(
        published.state.generatedPuzzle,
      );
      expect(watched).not.toHaveProperty("lastCommand");
    },
  );
});
