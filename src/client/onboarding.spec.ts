import { describe, expect, it, vi } from "vitest";

import {
  FULL_TUTORIAL_KEY,
  hasStoredCompletion,
  isFinalDemoStep,
  shouldShowFullTutorial,
  storeCompletion,
} from "./onboarding";

describe("onboarding completion storage", () => {
  it("recognizes only an explicit completed value", () => {
    const storage = (value: string | null) => () => ({
      getItem: () => value,
      setItem: vi.fn(),
    });

    expect(hasStoredCompletion("key", storage("true"))).toBe(true);
    expect(hasStoredCompletion("key", storage("false"))).toBe(false);
    expect(hasStoredCompletion("key", storage(null))).toBe(false);
  });

  it("persists completion and tolerates restricted browser storage", () => {
    const setItem = vi.fn();
    expect(
      storeCompletion(FULL_TUTORIAL_KEY, () => ({
        getItem: vi.fn(),
        setItem,
      })),
    ).toBe(true);
    expect(setItem).toHaveBeenCalledWith(FULL_TUTORIAL_KEY, "true");

    const restrictedStorage = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    };
    expect(
      hasStoredCompletion(FULL_TUTORIAL_KEY, () => restrictedStorage),
    ).toBe(false);
    expect(storeCompletion(FULL_TUTORIAL_KEY, () => restrictedStorage)).toBe(
      false,
    );
  });

  it("tolerates browsers that throw while acquiring localStorage", () => {
    const restrictedBrowser = {
      get localStorage(): never {
        throw new Error("storage access denied");
      },
    };
    const getStorage = () => restrictedBrowser.localStorage;

    expect(hasStoredCompletion(FULL_TUTORIAL_KEY, getStorage)).toBe(false);
    expect(storeCompletion(FULL_TUTORIAL_KEY, getStorage)).toBe(false);
  });
});

describe("full tutorial visibility", () => {
  const incomplete = {
    previewDemoCompleted: false,
    fullTutorialCompleted: false,
    completedThisSession: false,
  };

  it("shows only in a playable mode when neither onboarding path is complete", () => {
    expect(shouldShowFullTutorial("ai", incomplete)).toBe(true);
    expect(shouldShowFullTutorial("multiplayer", incomplete)).toBe(true);
    expect(shouldShowFullTutorial("rankings", incomplete)).toBe(false);
    expect(shouldShowFullTutorial(null, incomplete)).toBe(false);
  });

  it("stays hidden after either preview completion or explicit dismissal", () => {
    expect(
      shouldShowFullTutorial("ai", {
        ...incomplete,
        previewDemoCompleted: true,
      }),
    ).toBe(false);
    expect(
      shouldShowFullTutorial("ai", {
        ...incomplete,
        fullTutorialCompleted: true,
      }),
    ).toBe(false);
    expect(
      shouldShowFullTutorial("ai", {
        ...incomplete,
        completedThisSession: true,
      }),
    ).toBe(false);
  });

  it("keeps first-time spectators in the match without a player tutorial", () => {
    expect(shouldShowFullTutorial("multiplayer", incomplete, true)).toBe(false);
    expect(shouldShowFullTutorial("spectate", incomplete)).toBe(false);
    expect(shouldShowFullTutorial("watch-demo", incomplete)).toBe(false);
    expect(shouldShowFullTutorial("multiplayer", incomplete, false)).toBe(true);
  });
});

describe("preview demo completion", () => {
  it("marks only the final valid demo step as complete", () => {
    expect(isFinalDemoStep(0, 4)).toBe(false);
    expect(isFinalDemoStep(2, 4)).toBe(false);
    expect(isFinalDemoStep(3, 4)).toBe(true);
    expect(isFinalDemoStep(4, 4)).toBe(false);
    expect(isFinalDemoStep(0, 0)).toBe(false);
  });
});
