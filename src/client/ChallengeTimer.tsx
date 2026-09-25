import { useEffect, useState } from "react";
import type { ChallengeSnapshot } from "../shared/challenge";

import { formatChallengeTime } from "./challenge-time";

/** Interpolate a server reading with a monotonic clock; tab inactivity still counts. */
export function ChallengeTimer({ snapshot }: { snapshot: ChallengeSnapshot }) {
  const [reading, setReading] = useState({
    snapshot,
    elapsed: snapshot.elapsedMs,
  });
  useEffect(() => {
    const anchor = performance.now();
    const update = () =>
      setReading({
        snapshot,
        elapsed:
          snapshot.elapsedMs +
          (snapshot.complete ? 0 : performance.now() - anchor),
      });
    update();
    if (snapshot.complete) return;
    const timer = window.setInterval(update, 100);
    return () => window.clearInterval(timer);
  }, [snapshot]);
  return (
    <p className="challenge-timer" role="timer" aria-live="off">
      {snapshot.complete ? "Solved in" : "Elapsed"}{" "}
      <strong>
        {formatChallengeTime(
          reading.snapshot === snapshot ? reading.elapsed : snapshot.elapsedMs,
        )}
      </strong>
    </p>
  );
}
