import { useEffect, useState } from "react";
import { useReducedMotion } from "./ui/use-reduced-motion";

/* Leaderboard podium: the top three places, first in the middle. */
export const PODIUM_PLACES = [1, 2, 3] as const;
export const PODIUM_SIZE = PODIUM_PLACES.length;
/** Ratings count once all three players stand on their steps. */
export const PODIUM_COUNT_DELAY_MS = 1000;

/**
 * Times a shown slide's entrance. `cued` turns true once the art has landed,
 * so numbers count up only after the eye has somewhere to rest.
 */
export function useSceneCue(active: boolean, delayMs: number) {
  const reduced = useReducedMotion();
  const [cued, setCued] = useState(false);
  useEffect(() => {
    if (!active) return;
    setCued(false);
    const timer = window.setTimeout(() => setCued(true), reduced ? 0 : delayMs);
    return () => window.clearTimeout(timer);
  }, [active, reduced, delayMs]);
  return { live: active && !reduced, cued, reduced };
}

/** How each challenge is named and drawn on highlights and menu cards. */
export const CHALLENGE_COPY = {
  daily: {
    owner: 1,
    tone: "red",
    name: "Daily Challenge",
  },
  weekly: {
    owner: 2,
    tone: "blue",
    name: "Weekly Challenge",
  },
} as const;
