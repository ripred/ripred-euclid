import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    env: { VITE_COLOR_SCHEME: "red-blue" },
    // Type checking emits JavaScript into dist/types; only run source tests.
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    setupFiles: ["./tools/vitest-telemetry.mjs"],
  },
});
