import { defineConfig } from "vite";
import tailwind from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { edition } from "../shared/edition-game";
import {
  EditionError,
  editionErrorResponse,
  editionSnapshot,
  runEditionCommand,
  type EditionSession,
} from "../shared/edition-session";

/** Local-only authority; published games use the Redis-backed server route. */
function localEdition() {
  const sessions = new Map<
    string,
    {
      touched: number;
      game: EditionSession<ReturnType<typeof edition.create>> | null;
    }
  >();
  const cookieName = `euclid_${edition.id}`;
  async function handle(request: IncomingMessage, response: ServerResponse) {
    response.setHeader("Content-Type", "application/json");
    response.setHeader("Cache-Control", "no-store");
    if (
      request.headers.origin &&
      request.headers.origin !== `http://${request.headers.host}`
    )
      throw new EditionError("Cross-origin commands are not accepted.", 403);
    const saved = request.headers.cookie
      ?.split(";")
      .map((part) => part.trim())
      .find((part) => part.startsWith(`${cookieName}=`))
      ?.slice(cookieName.length + 1);
    const token = saved && /^[a-f0-9-]{36}$/.test(saved) ? saved : randomUUID();
    response.setHeader(
      "Set-Cookie",
      `${cookieName}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=86400`,
    );
    for (const [id, entry] of sessions)
      if (entry.touched < Date.now() - 86400000) sessions.delete(id);
    if (!sessions.has(token) && sessions.size >= 100) {
      const oldest = sessions.keys().next().value;
      if (oldest) sessions.delete(oldest);
    }
    const entry = sessions.get(token) ?? { touched: Date.now(), game: null };
    if (request.url?.split("?")[0] === "/state" && request.method === "GET") {
      entry.touched = Date.now();
      sessions.set(token, entry);
      response.end(JSON.stringify(editionSnapshot(entry.game)));
      return;
    }
    if (request.url !== "/command" || request.method !== "POST")
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
      // Decode once: a network chunk can end in the middle of a UTF-8 character.
      command = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
      throw new EditionError("Invalid JSON command.");
    }
    // Read again after awaiting the body: another request may have advanced the match.
    const current = sessions.get(token)?.game ?? null;
    const game = runEditionCommand(edition, current, command, randomUUID());
    sessions.set(token, { touched: Date.now(), game });
    response.end(JSON.stringify(editionSnapshot(game)));
  }
  return {
    name: "local-edition",
    configureServer(server: import("vite").ViteDevServer) {
      server.middlewares.use("/api/edition", (request, response) => {
        void handle(request, response).catch((error: unknown) => {
          const failure = editionErrorResponse(error);
          response.statusCode = failure.status;
          response.end(JSON.stringify({ error: failure.error }));
        });
      });
    },
  };
}

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react(), tailwind(), localEdition()],
  server: { host: "127.0.0.1", strictPort: true },
  build: {
    emptyOutDir: true,
    outDir: "../../dist/client",
    sourcemap: true,
    rollupOptions: {
      input: {
        default: "preview.html",
        game: "index.html",
      },
      output: {
        manualChunks(id) {
          // Three ships its reusable scene/math core separately from WebGL.
          if (id.includes("/three/build/three.core.js")) return "three-core";
          if (id.includes("/three/")) return "three-renderer";
        },
        entryFileNames: "[name].js",
        chunkFileNames: "[name].js",
        assetFileNames: "[name][extname]",
        sourcemapFileNames: "[name].js.map",
      },
    },
  },
});
