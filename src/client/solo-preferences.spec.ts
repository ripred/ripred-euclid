import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_PRACTICE_PREFERENCES,
  readPracticePreferences,
  savePracticePreferences,
} from "./solo-preferences";

afterEach(() => vi.unstubAllGlobals());

function stubStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  vi.stubGlobal("window", {
    localStorage: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    },
  });
  return values;
}

describe("practice setup preference", () => {
  it("restores a saved setup", () => {
    stubStorage();
    expect(readPracticePreferences()).toEqual(DEFAULT_PRACTICE_PREFERENCES);
    const setup = { difficulty: "defensive", assist: true } as const;
    savePracticePreferences(setup);
    expect(readPracticePreferences()).toEqual(setup);
  });

  it("keeps valid fields when others are stale", () => {
    stubStorage({
      euclid_practice_setup: JSON.stringify({
        difficulty: "invalid",
        assist: true,
      }),
    });
    expect(readPracticePreferences()).toEqual({
      ...DEFAULT_PRACTICE_PREFERENCES,
      assist: true,
    });
  });

  it("falls back to defaults for unreadable records", () => {
    stubStorage({ euclid_practice_setup: "{not json" });
    expect(readPracticePreferences()).toEqual(DEFAULT_PRACTICE_PREFERENCES);
    stubStorage({ euclid_practice_setup: "null" });
    expect(readPracticePreferences()).toEqual(DEFAULT_PRACTICE_PREFERENCES);
  });

  it("works when browser storage is blocked", () => {
    vi.stubGlobal("window", {
      get localStorage() {
        throw new Error("Blocked");
      },
    });
    expect(readPracticePreferences()).toEqual(DEFAULT_PRACTICE_PREFERENCES);
    expect(() =>
      savePracticePreferences(DEFAULT_PRACTICE_PREFERENCES),
    ).not.toThrow();
  });
});
