import { afterEach, describe, expect, it, vi } from "vitest";
import {
  readPracticeDifficulty,
  savePracticeDifficulty,
} from "./solo-preferences";

afterEach(() => vi.unstubAllGlobals());

describe("practice difficulty preference", () => {
  it("restores a saved choice and rejects stale values", () => {
    const values = new Map<string, string>();
    vi.stubGlobal("window", {
      localStorage: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value),
      },
    });
    expect(readPracticeDifficulty()).toBe("beginner");
    savePracticeDifficulty("defensive");
    expect(readPracticeDifficulty()).toBe("defensive");
    for (const key of values.keys()) values.set(key, "invalid");
    expect(readPracticeDifficulty()).toBe("beginner");
  });

  it("works when browser storage is blocked", () => {
    vi.stubGlobal("window", {
      get localStorage() {
        throw new Error("Blocked");
      },
    });
    expect(readPracticeDifficulty()).toBe("beginner");
    expect(() => savePracticeDifficulty("brutal")).not.toThrow();
  });
});
