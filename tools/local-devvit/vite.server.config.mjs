import { fileURLToPath } from "node:url";
import { defineConfig, mergeConfig } from "vite";
import base from "../../src/server/vite.config";

// Bundles the real server against the local Devvit stand-in.
export default mergeConfig(
  base,
  defineConfig({
    resolve: {
      alias: {
        "@devvit/analytics/server/reddit": fileURLToPath(
          new URL("./analytics-server-shim.mjs", import.meta.url),
        ),
        "@devvit/web/server": fileURLToPath(
          new URL("./server-shim.mjs", import.meta.url),
        ),
      },
    },
    build: {
      outDir: "../../dist/local-server",
      emptyOutDir: false,
      sourcemap: false,
    },
  }),
);
