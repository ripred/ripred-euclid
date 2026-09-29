import { randomUUID } from "node:crypto";
import http from "node:http";

const TOKEN_HEADER = "x-euclid-local-maintenance";
const LOOPBACK = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);

/** Only the process-owned scheduler may reach any internal server route. */
export function localInternalAccess(req, maintenance) {
  const pathname = new URL(req.url ?? "/", "http://localhost").pathname;
  let normalized;
  try {
    normalized = decodeURIComponent(pathname).toLowerCase();
  } catch {
    return false;
  }
  if (normalized !== "/internal" && !normalized.startsWith("/internal/"))
    return null;
  return pathname === maintenance.endpoint && maintenance.authorized(req);
}

/** Local counterpart of Devvit's every-minute internal scheduled endpoint. */
export function createLocalMaintenance({
  intervalMs = 60_000,
  timeoutMs = 120_000,
  reportError = (error) =>
    console.error("[local-devvit] challenge maintenance", error),
} = {}) {
  const endpoint = "/internal/competitions/maintenance";
  const token = randomUUID();
  return {
    endpoint,
    authorized(req) {
      return (
        req.method === "POST" &&
        LOOPBACK.has(req.socket.remoteAddress) &&
        req.headers[TOKEN_HEADER] === token
      );
    },
    attach(server) {
      let pending;
      let timer;
      let closing = false;
      const tick = () => {
        const address = server.address();
        if (closing || pending || !address || typeof address === "string")
          return;
        pending = http.request(
          {
            hostname: "127.0.0.1",
            port: address.port,
            path: endpoint,
            method: "POST",
            headers: {
              [TOKEN_HEADER]: token,
              "content-type": "application/json",
            },
            timeout: timeoutMs,
          },
          (response) => {
            response.resume();
            response.on("end", () => {
              if (response.statusCode < 200 || response.statusCode >= 300)
                reportError(
                  new Error(`Maintenance returned HTTP ${response.statusCode}`),
                );
            });
          },
        );
        pending.on("timeout", () =>
          pending?.destroy(new Error("Maintenance request timed out")),
        );
        pending.on("error", (error) => {
          if (!closing) reportError(error);
        });
        pending.on("close", () => {
          pending = undefined;
        });
        pending.end("{}");
      };
      server.once("listening", () => {
        tick();
        timer = setInterval(tick, intervalMs);
        timer.unref();
      });
      server.once("close", () => {
        closing = true;
        clearInterval(timer);
        pending?.destroy();
      });
    },
  };
}
