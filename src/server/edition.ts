import { Router, json, type ErrorRequestHandler } from "express";
import { randomUUID } from "node:crypto";
import { context, redis } from "@devvit/web/server";
import { edition } from "../shared/edition-game";
import {
  editionErrorResponse,
  editionSnapshot,
  reconcileEditionSession,
  runEditionCommand,
  type EditionSession,
} from "../shared/edition-session";
import { redisCas } from "./redis-cas";
import { createEditionLiveStore, editionOwnerKey } from "./edition-live-store";
import { editionHostName } from "../shared/edition-live";

export const editionRouter = Router();
type State = ReturnType<typeof edition.create>;
const key = (userId: string) => editionOwnerKey(edition.id, userId);
const live = createEditionLiveStore(edition, redis);

editionRouter.use((_request, response, next) => {
  response.set("Cache-Control", "no-store");
  next();
});
editionRouter.get("/live", async (_request, response) => {
  try {
    response.json({ games: await live.list(Date.now()) });
  } catch {
    response
      .status(503)
      .json({ error: "Unable to load live games. Please try again." });
  }
});
editionRouter.get("/watch/:id", async (request, response) => {
  try {
    const snapshot = await live.watch(request.params.id, Date.now());
    if (!snapshot) {
      response
        .status(404)
        .json({ error: "This game is no longer available to watch." });
      return;
    }
    response.json(snapshot);
  } catch {
    response
      .status(503)
      .json({ error: "Unable to load this game. Please try again." });
  }
});

editionRouter.use((_request, response, next) => {
  if (!context.userId) {
    response.status(401).json({ error: "Sign in to Reddit to play." });
    return;
  }
  next();
});
editionRouter.use((request, response, next) => {
  if (request.method === "POST" && !request.is("application/json")) {
    response.status(415).json({ error: "Send a JSON move intent." });
    return;
  }
  next();
});
// Authenticate and enforce the edition's small body limit before legacy parsers.
editionRouter.use(json({ limit: "8kb", inflate: false }));
editionRouter.get("/state", async (_request, response) => {
  try {
    // A saved-rule correction must not overwrite a move from another request.
    const snapshot = await redisCas(redis, key(context.userId!), (raw) => {
      const current = raw ? (JSON.parse(raw) as EditionSession<State>) : null;
      const next = reconcileEditionSession(edition, current);
      const result = editionSnapshot(next);
      return next === current
        ? { action: "no-change", result }
        : { action: "set", value: JSON.stringify(next), result };
    });
    response.json(snapshot);
  } catch {
    response
      .status(503)
      .json({ error: "Unable to load your game. Please reconnect." });
  }
});
editionRouter.post("/command", async (request, response) => {
  const newId = randomUUID();
  const userId = context.userId!;
  const hostName = editionHostName(context.username);
  try {
    const next = await redisCas(redis, key(userId), (raw) => {
      const current = raw ? (JSON.parse(raw) as EditionSession<State>) : null;
      const result = runEditionCommand(edition, current, request.body, newId, {
        hostName,
        updatedAt: Math.max(Date.now(), current?.activity?.updatedAt ?? 0),
      });
      return {
        action: "set",
        value: JSON.stringify(result),
        result,
      };
    });
    // Publication can be retried after a transient index failure. It must never
    // roll back an accepted move or substitute for canonical visibility checks.
    try {
      await live.publish(userId, next, Date.now());
    } catch {
      console.warn("Live-game discovery could not be updated.");
    }
    response.json(editionSnapshot(next));
  } catch (error) {
    const failure = editionErrorResponse(error);
    response.status(failure.status).json({ error: failure.error });
  }
});
editionRouter.use((_request, response) => {
  response.status(404).json({ error: "Unknown game endpoint." });
});
const parserError: ErrorRequestHandler = (
  error: unknown,
  _request,
  response,
  _next,
) => {
  const type =
    error && typeof error === "object" && "type" in error ? error.type : null;
  const status =
    type === "entity.too.large"
      ? 413
      : type === "encoding.unsupported" || type === "charset.unsupported"
        ? 415
        : 400;
  response.status(status).json({
    error:
      status === 413
        ? "Command is too large."
        : status === 415
          ? "Send an uncompressed UTF-8 JSON command."
          : "Invalid JSON command.",
  });
};
editionRouter.use(parserError);
