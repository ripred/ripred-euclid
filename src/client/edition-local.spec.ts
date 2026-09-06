import { createServer, type Server } from "node:http";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type {
  EditionDefinition,
  EditionSnapshot,
  EditionState,
  EditionWatchSnapshot,
  LiveEditionGame,
} from "../shared/edition-contract";
import { createLocalEditionMiddleware } from "./edition-local";

type State = EditionState & { hint: string | null };
const rules: EditionDefinition<State> = {
  id: "local-test",
  create: () => ({ revision: 0, turn: 1, winner: null, hint: "private plan" }),
  move: (state, action) => ({
    ...state,
    revision: state.revision + 1,
    turn: state.turn === 1 ? 2 : 1,
    winner: action === "win" ? state.turn : null,
  }),
  chooseMove: () => "place",
  spectatorState: (state) => ({ ...state, hint: null }),
};
let server: Server;
let base: string;
let time: number;
beforeEach(async () => {
  time = 1_000_000_000;
  server = createServer(
    createLocalEditionMiddleware(rules, { now: () => time }),
  );
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Expected a TCP server.");
  base = `http://127.0.0.1:${address.port}`;
});
afterEach(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
});

async function player() {
  const response = await fetch(`${base}/state`);
  const cookie = response.headers.get("Set-Cookie")?.split(";")[0];
  await response.json();
  if (!cookie) throw new Error("Expected an owner cookie.");
  return cookie;
}
const command = (
  cookie: string,
  input: unknown,
  headers: Record<string, string> = {},
) =>
  fetch(`${base}/command`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie, ...headers },
    body: JSON.stringify(input),
  });
async function start(cookie: string, mode = "solo") {
  const response = await command(cookie, {
    kind: "start",
    commandId: "start-0001",
    mode,
  });
  expect(response.status).toBe(200);
  return (await response.json()) as EditionSnapshot<State>;
}
const visibility = (
  cookie: string,
  game: EditionSnapshot<State>,
  enabled = true,
  commandId = "allow-0001",
) =>
  command(cookie, {
    kind: "spectators",
    enabled,
    commandId,
    expectedId: game.id,
    expectedRevision: game.state.revision,
  });
const watch = (id: string) => fetch(`${base}/watch/${id}`);
const live = async () => (await fetch(`${base}/live`)).json();

describe("local spectator HTTP authority", () => {
  it.each(["solo", "duel"])(
    "publishes %s only after opt-in with a safe independent host label",
    async (mode) => {
      const owner = await player();
      const game = await start(owner, mode);
      expect((await watch(game.id)).status).toBe(404);
      expect(await live()).toEqual({ games: [] });
      expect((await visibility(owner, game)).status).toBe(200);
      expect(await live()).toEqual({
        games: [
          {
            id: game.id,
            mode,
            hostName: "Local_player_1",
            updatedAt: time,
            revision: 0,
          },
        ],
      });
      const response = await watch(game.id);
      expect(response.headers.get("Set-Cookie")).toBeNull();
      const snapshot = (await response.json()) as EditionWatchSnapshot<State>;
      expect(snapshot.state.hint).toBeNull();
      expect(snapshot).not.toHaveProperty("lastCommand");
      expect(JSON.stringify(snapshot)).not.toContain(owner.split("=")[1]);
      expect(snapshot.hostName).toBe("Local_player_1");
    },
  );

  it("keeps both owner sessions isolated from watcher mutations", async () => {
    const owner = await player();
    const viewer = await player();
    const game = await start(owner);
    const personal = await start(viewer);
    await visibility(owner, game);
    expect((await watch(game.id)).status).toBe(200);
    expect((await visibility(viewer, game, false)).status).toBe(409);
    expect(
      (
        await command(viewer, {
          kind: "move",
          commandId: "forge-0001",
          expectedId: game.id,
          expectedRevision: 0,
          action: "win",
          owner: owner.split("=")[1],
        })
      ).status,
    ).toBe(409);
    expect(
      await (
        await fetch(`${base}/state`, { headers: { Cookie: viewer } })
      ).json(),
    ).toEqual(personal);
    const restored = (await (
      await fetch(`${base}/state`, { headers: { Cookie: owner } })
    ).json()) as EditionSnapshot<State>;
    expect(restored.state).toEqual(game.state);
    expect(restored.spectatorsEnabled).toBe(true);
  });

  it("shows fresh moves and final state, and permits revocation after completion", async () => {
    const owner = await player();
    const game = await start(owner);
    await visibility(owner, game);
    time++;
    const moved = (await (
      await command(owner, {
        kind: "move",
        commandId: "move-0001",
        expectedId: game.id,
        expectedRevision: 0,
        action: "win",
      })
    ).json()) as EditionSnapshot<State>;
    expect(moved.state.revision).toBe(1);
    expect(moved.state.winner).toBe(1);
    expect(
      ((await (await watch(game.id)).json()) as EditionWatchSnapshot<State>)
        .state.winner,
    ).toBe(1);
    expect(await live()).toEqual({ games: [] });
    await visibility(owner, moved, false, "revoke-0001");
    expect((await watch(game.id)).status).toBe(404);
  });

  it("invalidates a watch when the host restarts instead of following the replacement", async () => {
    const owner = await player();
    const game = await start(owner);
    await visibility(owner, game);
    const next = (await (
      await command(owner, {
        kind: "start",
        commandId: "start-0002",
        mode: "solo",
        expectedId: game.id,
        expectedRevision: 0,
      })
    ).json()) as EditionSnapshot<State>;
    expect(next.spectatorsEnabled).toBe(false);
    expect((await watch(game.id)).status).toBe(404);
    expect((await watch(next.id)).status).toBe(404);
    expect(await live()).toEqual({ games: [] });
  });

  it("does not keep games active through viewer or owner GETs or command retries", async () => {
    const owner = await player();
    const game = await start(owner);
    await visibility(owner, game);
    time += 10 * 60 * 1000;
    await fetch(`${base}/state`, { headers: { Cookie: owner } });
    expect((await visibility(owner, game)).status).toBe(200);
    expect(await live()).toEqual({ games: [] });
    const snapshot = (await (
      await watch(game.id)
    ).json()) as EditionWatchSnapshot<State>;
    expect(snapshot.updatedAt).toBe(time - 10 * 60 * 1000);
    time += 24 * 60 * 60 * 1000;
    expect((await watch(game.id)).status).toBe(404);
  });

  it("does not allocate owner slots for anonymous spectators or evict playing sessions", async () => {
    const owner = await player();
    const game = await start(owner);
    await visibility(owner, game);
    for (let i = 0; i < 105; i++) {
      const response = await fetch(`${base}/live`);
      expect(response.headers.get("Set-Cookie")).toBeNull();
      expect(
        ((await response.json()) as { games: LiveEditionGame[] }).games,
      ).toHaveLength(1);
    }
    expect(
      (
        (await (
          await fetch(`${base}/state`, { headers: { Cookie: owner } })
        ).json()) as EditionSnapshot<State>
      ).id,
    ).toBe(game.id);
  });

  it("rejects cross-origin commands and malformed or encoded bodies before mutation", async () => {
    const owner = await player();
    const game = await start(owner);
    expect(
      (await command(owner, {}, { Origin: "https://untrusted.invalid" }))
        .status,
    ).toBe(403);
    expect(
      (await command(owner, {}, { "Content-Type": "text/plain" })).status,
    ).toBe(415);
    expect(
      (await command(owner, {}, { "Content-Encoding": "gzip" })).status,
    ).toBe(415);
    expect((await command(owner, { input: "x".repeat(8193) })).status).toBe(
      413,
    );
    const invalid = await fetch(`${base}/command`, {
      method: "POST",
      headers: { Cookie: owner, "Content-Type": "application/json" },
      body: "{",
    });
    expect(invalid.status).toBe(400);
    expect(
      await (
        await fetch(`${base}/state`, { headers: { Cookie: owner } })
      ).json(),
    ).toEqual(game);
  });

  it("hides malformed and unknown game identifiers", async () => {
    for (const id of [
      "not-a-game",
      "12d566fb-97af-4c7f-a1e6-b07c6d440111",
      "x".repeat(100),
    ])
      expect((await watch(id)).status).toBe(404);
  });
});
