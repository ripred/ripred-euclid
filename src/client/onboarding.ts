export const FULL_TUTORIAL_KEY = "euclid_first_play";

interface OnboardingStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

type OnboardingStorageProvider = () => OnboardingStorage;

function getBrowserOnboardingStorage(): OnboardingStorage {
  return window.localStorage;
}

/**
 * Only finishing or dismissing the in-game tutorial counts. The splash's rules
 * slide replays on its own in the rotation, so reaching its end says nothing
 * about whether anyone watched it.
 */
export interface TutorialCompletionState {
  fullTutorialCompleted: boolean;
  completedThisSession: boolean;
}

export function hasStoredCompletion(
  key: string,
  getStorage: OnboardingStorageProvider = getBrowserOnboardingStorage,
): boolean {
  try {
    return getStorage().getItem(key) === "true";
  } catch {
    return false;
  }
}

export function storeCompletion(
  key: string,
  getStorage: OnboardingStorageProvider = getBrowserOnboardingStorage,
): boolean {
  try {
    getStorage().setItem(key, "true");
    return true;
  } catch {
    return false;
  }
}

export function shouldShowFullTutorial(
  mode: string | null,
  completion: TutorialCompletionState,
  spectating = false,
): boolean {
  // Watching uses the multiplayer renderer but must not block it with player onboarding.
  const isGameMode = mode === "ai" || mode === "multiplayer";
  return (
    isGameMode &&
    !spectating &&
    !completion.fullTutorialCompleted &&
    !completion.completedThisSession
  );
}

export function isFinalDemoStep(stepIndex: number, stepCount: number): boolean {
  return (
    Number.isInteger(stepIndex) &&
    Number.isInteger(stepCount) &&
    stepCount > 0 &&
    stepIndex === stepCount - 1
  );
}
