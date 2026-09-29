import { vi } from "vitest";

// Tests of our controllers inject their own recording transport. Tests of the
// official SDK explicitly unmock it and replace its underlying plugin/fetch.
vi.mock(
  "@devvit/analytics/client/reddit",
  () => import("./local-devvit/analytics-client-shim.mjs"),
);
vi.mock(
  "@devvit/analytics/server/reddit",
  () => import("./local-devvit/analytics-server-shim.mjs"),
);
