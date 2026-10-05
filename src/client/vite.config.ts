import { defineConfig, loadEnv, type Plugin } from "vite";
import tailwind from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { parseColorScheme } from "./design/color-scheme";

const validateColorScheme: Plugin = {
  name: "validate-color-scheme",
  configResolved(config) {
    parseColorScheme(
      loadEnv(config.mode, config.envDir, "VITE_").VITE_COLOR_SCHEME,
    );
  },
};

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [validateColorScheme, react(), tailwind()],
  build: {
    emptyOutDir: true,
    outDir: "../../dist/client",
    sourcemap: true,
    rollupOptions: {
      input: {
        default: "preview.html",
        game: "index.html",
        challenge: "challenge.html",
        daily: "daily.html",
        weekly: "weekly.html",
        solo: "solo.html",
        reddit: "reddit.html",
        leaderboard: "leaderboard.html",
        watch: "watch.html",
      },
      output: {
        entryFileNames: "[name].js",
        chunkFileNames: "[name].js",
        assetFileNames: "[name][extname]",
        sourcemapFileNames: "[name].js.map",
      },
    },
  },
});
