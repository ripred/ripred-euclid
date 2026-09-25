import { afterEach, describe, expect, it, vi } from "vitest";

import { readStored, removeStored, STORAGE_KEYS, writeStored } from "./storage";

afterEach(() => vi.unstubAllGlobals());

const asNumber = (value: unknown) => (typeof value === "number" ? value : null);

function memoryStorage() {
  const values = new Map<string, string>();
  vi.stubGlobal("window", {
    localStorage: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    },
  });
  return values;
}

describe("local storage", () => {
  it("round-trips JSON through a validator", () => {
    const values = memoryStorage();
    writeStored(STORAGE_KEYS.records, 7);
    expect(values.get(STORAGE_KEYS.records)).toBe("7");
    expect(readStored(STORAGE_KEYS.records, asNumber, 0)).toBe(7);
    removeStored(STORAGE_KEYS.records);
    expect(readStored(STORAGE_KEYS.records, asNumber, 0)).toBe(0);
  });

  it("falls back on corrupt or invalid data", () => {
    const values = memoryStorage();
    values.set(STORAGE_KEYS.records, "{not json");
    expect(readStored(STORAGE_KEYS.records, asNumber, 3)).toBe(3);
    values.set(STORAGE_KEYS.records, '"text"');
    expect(readStored(STORAGE_KEYS.records, asNumber, 3)).toBe(3);
  });

  it("keeps working when storage is blocked or full", () => {
    vi.stubGlobal("window", {
      get localStorage() {
        throw new Error("Blocked");
      },
    });
    expect(readStored(STORAGE_KEYS.game, asNumber, 1)).toBe(1);
    expect(() => writeStored(STORAGE_KEYS.game, 2)).not.toThrow();
    expect(() => removeStored(STORAGE_KEYS.game)).not.toThrow();

    vi.stubGlobal("window", {
      localStorage: {
        getItem: () => null,
        setItem: () => {
          throw new Error("Quota exceeded");
        },
      },
    });
    expect(() => writeStored(STORAGE_KEYS.game, 2)).not.toThrow();
  });
});
