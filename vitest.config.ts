import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Type checking emits JavaScript into dist/types; only run source tests.
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
  },
});
