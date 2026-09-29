import { useEffect, useRef, useState } from "react";

/**
 * Counts toward a new value so a number reads as earned, not swapped. While
 * disabled, or for a jump larger than maxJump, the value is shown at once.
 */
export function useCountUp(
  value: number,
  {
    disabled = false,
    duration = 650,
    maxJump = Infinity,
  }: { disabled?: boolean; duration?: number; maxJump?: number } = {},
): number {
  const [shown, setShown] = useState(value);
  const shownRef = useRef(value);
  useEffect(() => {
    if (disabled || Math.abs(value - shownRef.current) > maxJump) {
      shownRef.current = value;
      setShown(value);
      return;
    }
    const from = shownRef.current;
    const started = performance.now();
    let frame = 0;
    const step = (now: number) => {
      const progress = Math.min(1, (now - started) / duration);
      const eased = 1 - (1 - progress) ** 3;
      const next = Math.round(from + (value - from) * eased);
      shownRef.current = next;
      setShown(next);
      if (progress < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [value, disabled, duration, maxJump]);
  return shown;
}
