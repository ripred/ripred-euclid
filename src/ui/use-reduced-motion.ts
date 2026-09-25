import { useEffect, useState } from "react";

/** Tracks the viewer's reduced-motion preference. */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const media = window.matchMedia
      ? window.matchMedia("(prefers-reduced-motion: reduce)")
      : null;
    const sync = () => setReduced(Boolean(media?.matches));
    sync();
    if (!media) return;
    if (typeof media.addEventListener === "function")
      media.addEventListener("change", sync);
    else if (typeof media.addListener === "function") media.addListener(sync);
    return () => {
      if (typeof media.removeEventListener === "function")
        media.removeEventListener("change", sync);
      else if (typeof media.removeListener === "function")
        media.removeListener(sync);
    };
  }, []);
  return reduced;
}
