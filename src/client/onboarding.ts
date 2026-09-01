export const PREVIEW_ONBOARDING_KEY = "euclid_launch_onboarding_seen";
export const FULL_TUTORIAL_KEY = "euclid_first_play";

interface OnboardingStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

type OnboardingStorageProvider = () => OnboardingStorage;

function getBrowserOnboardingStorage(): OnboardingStorage {
  return window.localStorage;
}

export interface TutorialCompletionState {
  previewDemoCompleted: boolean;
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
): boolean {
  const isGameMode = mode === "ai" || mode === "multiplayer";
  return (
    isGameMode &&
    !completion.previewDemoCompleted &&
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
