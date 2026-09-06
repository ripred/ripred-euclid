import { Router, json, type ErrorRequestHandler } from "express";
import { randomUUID } from "node:crypto";
import { context, redis } from "@devvit/web/server";
import { edition } from "../shared/edition-game";
import {
  editionErrorResponse,
  editionSnapshot,
  runEditionCommand,
  type EditionSession,
} from "../shared/edition-session";
import { redisCas } from "./redis-cas";

export const editionRouter = Router();
type State = ReturnType<typeof edition.create>;
const key = (userId: string) => `euclid:edition:${edition.id}:v1:${userId}`;

editionRouter.use((_request, response, next) => {
  response.set("Cache-Control", "no-store");
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
    const raw = await redis.get(key(context.userId!));
    response.json(
      editionSnapshot(raw ? (JSON.parse(raw) as EditionSession<State>) : null),
    );
  } catch {
    response
      .status(503)
      .json({ error: "Unable to load your game. Please reconnect." });
  }
});
editionRouter.post("/command", async (request, response) => {
  const newId = randomUUID();
  try {
    const next = await redisCas(redis, key(context.userId!), (raw) => {
      const current = raw ? (JSON.parse(raw) as EditionSession<State>) : null;
      const result = runEditionCommand(edition, current, request.body, newId);
      return {
        action: "set",
        value: JSON.stringify(result),
        result: editionSnapshot(result),
      };
    });
    response.json(next);
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
  response
    .status(status)
    .json({
      error:
        status === 413
          ? "Command is too large."
          : status === 415
            ? "Send an uncompressed UTF-8 JSON command."
            : "Invalid JSON command.",
    });
};
editionRouter.use(parserError);
