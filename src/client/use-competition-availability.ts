import { useEffect, useState } from "react";
import type { CompetitionAvailabilityResponse } from "../shared/competitions";
import { errorMessage } from "../shared/error-message";
import { requestCompetitionAvailability } from "./competition-api";

/** One shared availability poller for splash and expanded-home navigation. */
export function useCompetitionAvailability(
  enabled: boolean,
  refreshKey?: unknown,
) {
  const [reading, setReading] = useState<{
    availability: CompetitionAvailabilityResponse;
    refreshKey: unknown;
  } | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!enabled) return;
    const abort = new AbortController();
    let pending = false;
    const refresh = async () => {
      if (pending || document.visibilityState === "hidden") return;
      pending = true;
      try {
        const next = await requestCompetitionAvailability(abort.signal);
        if (!abort.signal.aborted) {
          setReading({ availability: next, refreshKey });
          setError("");
        }
      } catch (failure) {
        if (!abort.signal.aborted)
          setError(errorMessage(failure, "Could not load challenges."));
      } finally {
        pending = false;
      }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 30000);
    const visible = () => {
      if (document.visibilityState !== "hidden") void refresh();
    };
    document.addEventListener("visibilitychange", visible);
    return () => {
      abort.abort();
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [enabled, refreshKey]);
  return {
    availability:
      enabled && reading && reading.refreshKey === refreshKey
        ? reading.availability
        : null,
    error: enabled ? error : "",
  };
}

/** Interpolate server time without trusting the user's wall clock. */
export function useCompetitionClock(serverNow: number | undefined): number {
  const [clock, setClock] = useState({
    source: serverNow,
    now: serverNow ?? 0,
  });
  useEffect(() => {
    if (serverNow === undefined) return;
    const anchor = performance.now();
    const tick = () =>
      setClock({
        source: serverNow,
        now: serverNow + performance.now() - anchor,
      });
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [serverNow]);
  return clock.source === serverNow ? clock.now : (serverNow ?? 0);
}
