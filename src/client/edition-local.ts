import { randomUUID } from "node:crypto";
import { Buffer } from "node:buffer";
import type { IncomingMessage, ServerResponse } from "node:http";
import type {
  EditionDefinition,
  EditionState,
  LiveEditionGame,
} from "../shared/edition-contract";
import {
  editionLiveSummary,
  editionWatchSnapshot,
  isEditionGameId,
  LIVE_LIST_LIMIT,
  WATCH_RETENTION_MS,
} from "../shared/edition-live";
import {
  EditionError,
  editionErrorResponse,
  editionSnapshot,
  reconcileEditionSession,
  runEditionCommand,
  type EditionSession,
} from "../shared/edition-session";

/** Development-only authority; never imported by a browser entrypoint. */
export function createLocalEditionMiddleware<T extends EditionState>(
  definition: EditionDefinition<T>,
  options: { now?: () => number; createId?: () => string } = {},
) {
  const now = options.now ?? Date.now;
  const createId = options.createId ?? randomUUID;
  const sessions = new Map<
    string,
    { touched: number; hostName: string; game: EditionSession<T> | null }
  >();
  let nextHost = 1;
  const cookieName = `euclid_${definition.id}`;

  async function handle(request: IncomingMessage, response: ServerResponse) {
    if (
      request.headers.origin &&
      request.headers.origin !== `http://${request.headers.host}`
    )
      throw new EditionError("Cross-origin commands are not accepted.", 403);
    const time = now();
    for (const [token, entry] of sessions)
      if (entry.touched <= time - WATCH_RETENTION_MS) sessions.delete(token);
    const path = request.url?.split("?")[0];
    if (request.method === "GET" && path === "/live") {
      const games = [...sessions.values()]
        .map(({ game }) => {
          const session = reconcileEditionSession(definition, game);
          return editionLiveSummary(
            session
              ? editionWatchSnapshot(definition, session, session.id, time)
              : null,
            time,
          );
        })
        .filter((game): game is LiveEditionGame => game !== null)
        .sort(
          (left, right) =>
            right.updatedAt - left.updatedAt || left.id.localeCompare(right.id),
        )
        .slice(0, LIVE_LIST_LIMIT);
      response.end(JSON.stringify({ games }));
      return;
    }
    if (request.method === "GET" && path?.startsWith("/watch/")) {
      const id = path.slice("/watch/".length);
      const entry = isEditionGameId(id)
        ? [...sessions.values()].find(({ game }) => game?.id === id)
        : undefined;
      const session = reconcileEditionSession(definition, entry?.game ?? null);
      const snapshot = editionWatchSnapshot(definition, session, id, time);
      if (!snapshot)
        throw new EditionError(
          "This game is no longer available to watch.",
          404,
        );
      response.end(JSON.stringify(snapshot));
      return;
    }
    const saved = request.headers.cookie
      ?.split(";")
      .map((part) => part.trim())
      .find((part) => part.startsWith(`${cookieName}=`))
      ?.slice(cookieName.length + 1);
    const token = isEditionGameId(saved) ? saved : createId();
    response.setHeader(
      "Set-Cookie",
      `${cookieName}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=86400`,
    );
    if (!sessions.has(token) && sessions.size >= 100)
      throw new EditionError(
        "The local game server is full. Try again later.",
        503,
      );
    const entry = sessions.get(token) ?? {
      touched: time,
      hostName: `Local_player_${nextHost++}`,
      game: null,
    };
    if (path === "/state" && request.method === "GET") {
      entry.game = reconcileEditionSession(definition, entry.game);
      entry.touched = time;
      sessions.set(token, entry);
      response.end(JSON.stringify(editionSnapshot(entry.game)));
      return;
    }
    if (path !== "/command" || request.method !== "POST")
      throw new EditionError("Unknown game endpoint.", 404);
    if (
      !/^application\/json(?:\s*;\s*charset=(?:"utf-8"|utf-8))?\s*$/i.test(
        request.headers["content-type"] ?? "",
      )
    )
      throw new EditionError("Send a JSON move intent.", 415);
    if (
      request.headers["content-encoding"] &&
      request.headers["content-encoding"] !== "identity"
    )
      throw new EditionError("Send an uncompressed UTF-8 JSON command.", 415);
    const chunks: Buffer[] = [];
    let bytes = 0;
    for await (const chunk of request) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      bytes += buffer.length;
      if (bytes > 8192) throw new EditionError("Command is too large.", 413);
      chunks.push(buffer);
    }
    let command: unknown;
    try {
      command = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
      throw new EditionError("Invalid JSON command.");
    }
    // Re-read after the body: an overlapping command may have advanced the match.
    const latest = sessions.get(token) ?? entry;
    const current = latest.game;
    const updatedAt = Math.max(now(), current?.activity?.updatedAt ?? 0);
    const game = runEditionCommand(definition, current, command, createId(), {
      updatedAt,
      hostName: latest.hostName,
    });
    sessions.set(token, { ...latest, touched: now(), game });
    response.end(JSON.stringify(editionSnapshot(game)));
  }

  return (request: IncomingMessage, response: ServerResponse) => {
    response.setHeader("Content-Type", "application/json");
    response.setHeader("Cache-Control", "no-store");
    void handle(request, response).catch((error: unknown) => {
      const failure = editionErrorResponse(error);
      response.statusCode = failure.status;
      response.end(JSON.stringify({ error: failure.error }));
    });
  };
}
