import { defineConfig } from "vite";
import tailwind from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { edition } from "../shared/edition-game";
import { createLocalEditionMiddleware } from "./edition-local";

function localEdition() {
  const handle = createLocalEditionMiddleware(edition);
  return {
    name: "local-edition",
    configureServer(server: import("vite").ViteDevServer) {
      server.middlewares.use("/api/edition", handle);
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
