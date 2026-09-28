import { useCallback, useEffect, useRef, useState } from "react";
import type { ChallengePeriod } from "../shared/challenge-spotlights";
import type {
  CompetitionResult,
  CompetitionStateResponse,
  CompetitionStandingsResponse,
} from "../shared/competitions";
import { errorMessage } from "../shared/error-message";
import {
  competitionCommand,
  requestCompetitionState,
  requestCompetitionStandings,
} from "./competition-api";
import {
  competitionAvailabilityText,
  competitionLabel,
  formatCompetitionDate,
} from "./competition-display";
import { useCompetitionClock } from "./use-competition-availability";
import { formatChallengeTime } from "./challenge-time";
import { ChallengeTimer } from "./ChallengeTimer";
import { ChallengeBoard } from "./ui/ChallengeBoard";
import { Dialog } from "./ui/Dialog";
import { PageShell } from "./ui/PageShell";
import "./competition-screen.css";

function ResultLine({ result }: { result: CompetitionResult }) {
  return (
    <span>
      {result.moves} {result.moves === 1 ? "move" : "moves"} ·{" "}
      {formatChallengeTime(result.elapsedMs)}
    </span>
  );
}

/** Daily and weekly use the same authoritative, resumable competition flow. */
export function CompetitionScreen({
  period,
  username,
  onLeave,
}: {
  period: ChallengePeriod;
  username: string;
  onLeave: () => void;
}) {
  const [state, setState] = useState<CompetitionStateResponse | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [uncertain, setUncertain] = useState(false);
  const [confirmRetry, setConfirmRetry] = useState(false);
  const [standings, setStandings] =
    useState<CompetitionStandingsResponse | null>(null);
  const [standingsError, setStandingsError] = useState("");
  const [standingsBusy, setStandingsBusy] = useState(false);
  const [offset, setOffset] = useState(0);
  const stateRef = useRef(state);
  const pending = useRef(false);
  const mounted = useRef(false);
  const requestVersion = useRef(0);
  const now = useCompetitionClock(state?.serverNow);
  const competition = state?.competition;
  const snapshot = state?.snapshot;
  const expired = !!competition && now >= competition.endsAt;
  const open =
    competition?.enabled === true && competition.status === "open" && !expired;
  const signedIn = state?.authenticated ?? username.trim().length > 0;

  useEffect(() => {
    setConfirmRetry(false);
  }, [open, signedIn, snapshot?.attemptId]);

  const adopt = useCallback((next: CompetitionStateResponse) => {
    const old = stateRef.current;
    if (
      old?.competition.instanceId &&
      old.competition.instanceId !== next.competition.instanceId
    ) {
      setNotice(
        old.competition.endsAt <= next.serverNow
          ? "The previous challenge has ended. The current challenge is shown below."
          : "Moderators replaced this challenge. Previous entries no longer count; start the new puzzle to participate.",
      );
      setConfirmRetry(false);
      setOffset(0);
    }
    stateRef.current = next;
    setState(next);
    setUncertain(false);
  }, []);

  const refresh = useCallback(
    async (foreground = false) => {
      if (pending.current) return;
      const version = ++requestVersion.current;
      if (foreground) setBusy(true);
      try {
        const next = await requestCompetitionState(period);
        if (mounted.current && version === requestVersion.current) {
          adopt(next);
          if (foreground) setError("");
        }
      } catch (failure) {
        if (mounted.current && version === requestVersion.current) {
          setError(errorMessage(failure, "Could not load this challenge."));
          if (foreground) setUncertain(true);
        }
      } finally {
        if (
          mounted.current &&
          version === requestVersion.current &&
          !pending.current
        )
          setBusy(false);
      }
    },
    [adopt, period],
  );

  useEffect(() => {
    mounted.current = true;
    void refresh(true);
    const timer = window.setInterval(() => {
      if (document.visibilityState !== "hidden") void refresh();
    }, 15000);
    const visible = () => {
      if (document.visibilityState !== "hidden") void refresh();
    };
    document.addEventListener("visibilitychange", visible);
    return () => {
      mounted.current = false;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [refresh]);

  const scheduledStartReached =
    competition?.status === "scheduled" && now >= competition.opensAt;
  useEffect(() => {
    if (expired || scheduledStartReached) void refresh();
  }, [expired, scheduledStartReached, refresh]);

  const showStandings =
    competition?.enabled === true && competition.showStandings;
  useEffect(() => {
    if (!showStandings || !competition?.instanceId) return;
    const abort = new AbortController();
    setStandingsBusy(true);
    setStandingsError("");
    void requestCompetitionStandings(period, offset, abort.signal)
      .then((next) => {
        if (!abort.signal.aborted) setStandings(next);
      })
      .catch((failure: unknown) => {
        if (!abort.signal.aborted)
          setStandingsError(errorMessage(failure, "Could not load standings."));
      })
      .finally(() => {
        if (!abort.signal.aborted) setStandingsBusy(false);
      });
    return () => abort.abort();
  }, [
    showStandings,
    competition?.instanceId,
    state?.serverNow,
    offset,
    period,
  ]);

  async function mutate(action: "start" | "retry" | "move", point?: number) {
    const current = stateRef.current;
    if (!current || !open || !signedIn || pending.current || busy || uncertain)
      return;
    pending.current = true;
    ++requestVersion.current;
    setBusy(true);
    setError("");
    setConfirmRetry(false);
    try {
      const next = await requestCompetitionState(period, action, {
        ...competitionCommand(current, action),
        ...(point === undefined ? {} : { point }),
      });
      if (mounted.current) {
        adopt(next);
        setNotice("");
      }
    } catch (failure) {
      if (!mounted.current) return;
      setError(errorMessage(failure, "The challenge request failed."));
      // A reply can be lost after a commit. Reconcile before accepting input.
      setUncertain(true);
      try {
        const next = await requestCompetitionState(period);
        if (mounted.current) adopt(next);
      } catch {
        /* A visible Refresh action recovers without replaying a move. */
      }
    } finally {
      pending.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  const standingsCurrent =
    standings?.instanceId === competition?.instanceId &&
    standings?.offset === offset;
  return (
    <PageShell
      title={competitionLabel(period)}
      titleId="competition-title"
      narrow={false}
      className="competition-screen"
      back={{ label: "Back to Euclid", onClick: onLeave }}
    >
      <p className="muted">
        One puzzle for this subreddit · Unlimited retries · Independent of
        ratings
      </p>
      {!state ? (
        <section className="panel">
          <p role="status">
            {busy ? "Loading challenge…" : "Challenge unavailable."}
          </p>
        </section>
      ) : !competition?.enabled || competition.status === "disabled" ? (
        <section className="panel">
          <h2>Challenge disabled</h2>
          <p>Subreddit moderators have disabled this challenge.</p>
        </section>
      ) : (
        <>
          <section
            className="panel competition-period"
            aria-label="Challenge period"
          >
            <p role="timer" aria-live="off">
              {competitionAvailabilityText(competition, now)}
            </p>
            <p className="field__hint">
              {competition.status === "scheduled" ? "Opens" : "Opened"}{" "}
              {formatCompetitionDate(competition.opensAt)}
              <br />
              Closes {formatCompetitionDate(competition.endsAt)}
            </p>
          </section>
          {notice && (
            <p className="notice" role="status">
              {notice}
            </p>
          )}
          <div className="competition-layout">
            <section
              className="panel competition-play"
              aria-label="Challenge play"
            >
              {!open ? (
                <>
                  <h2>
                    {competition.status === "scheduled"
                      ? "Next challenge scheduled"
                      : expired
                        ? "Challenge closed"
                        : "Puzzle unavailable"}
                  </h2>
                  <p>
                    {competition.status === "scheduled"
                      ? "Return at the opening time to begin. The timer starts only when you select Start."
                      : expired
                        ? "This period has ended. No more placements will be accepted."
                        : "A certified puzzle is not available. Please check back later."}
                  </p>
                </>
              ) : !signedIn ? (
                <>
                  <h2>Sign in to play</h2>
                  <p>
                    Sign in to Reddit to start this challenge and save your
                    result.
                  </p>
                </>
              ) : !snapshot ? (
                <>
                  <h2>Ready for the challenge?</h2>
                  <p>
                    Start reveals the board and begins your timer. Timing
                    continues if you leave or reconnect. Complete the target
                    squares using as few placements as possible.
                  </p>
                  <button
                    type="button"
                    className="btn btn--primary"
                    disabled={busy || uncertain}
                    onClick={() => void mutate("start")}
                  >
                    {busy ? "Opening…" : "Start challenge"}
                  </button>
                </>
              ) : (
                <>
                  <div className="challenge-status__head">
                    <h2>
                      {snapshot.complete
                        ? "Puzzle complete"
                        : "Complete the squares"}
                    </h2>
                    <ChallengeTimer snapshot={snapshot} />
                  </div>
                  <ul className="challenge-stats">
                    <li>
                      Squares: {snapshot.completedSquares.length} /{" "}
                      {snapshot.puzzle.targetSquares}
                    </li>
                    <li>Pieces placed: {snapshot.placements.length}</li>
                    <li>Minimum: {snapshot.puzzle.minimumMoves}</li>
                  </ul>
                  <ChallengeBoard
                    puzzle={snapshot.puzzle}
                    placements={snapshot.placements}
                    completedSquares={snapshot.completedSquares}
                    revision={`${snapshot.attemptId}:${snapshot.revision}`}
                    enabled={
                      !busy && !uncertain && !confirmRetry && !snapshot.complete
                    }
                    onPlace={(point) => void mutate("move", point)}
                  />
                  <p className="field__hint">
                    Arrow keys move focus; Enter or Space places a piece. No
                    undo or hints. Fewest moves wins, then shortest time, then
                    first achieved.
                  </p>
                  <button
                    type="button"
                    className="btn"
                    disabled={busy || uncertain}
                    onClick={() =>
                      snapshot.placements.length && !snapshot.complete
                        ? setConfirmRetry(true)
                        : void mutate("retry")
                    }
                  >
                    Retry same puzzle
                  </button>
                </>
              )}
              {state.personalBest && (
                <p className="competition-best">
                  <strong>Your best:</strong>{" "}
                  <ResultLine result={state.personalBest} />
                  {showStandings &&
                  !(standingsCurrent && standings?.visible === false) &&
                  state.personalRank !== null
                    ? ` · Rank ${state.personalRank}`
                    : ""}
                </p>
              )}
            </section>
            <section
              className="panel competition-standings"
              aria-labelledby="competition-standings-title"
            >
              <h2 id="competition-standings-title">Live standings</h2>
              {!showStandings ||
              (standingsCurrent && standings?.visible === false) ? (
                <p>
                  Live standings are hidden by subreddit moderators. Your own
                  result remains available.
                </p>
              ) : (
                <>
                  {standingsError ? (
                    <p className="notice notice--attention" role="alert">
                      {standingsError}
                    </p>
                  ) : null}
                  {standingsBusy && (
                    <p className="field__hint" role="status">
                      Refreshing standings…
                    </p>
                  )}
                  {standingsCurrent &&
                  standings?.visible &&
                  standings.standings.length ? (
                    <ol
                      className="competition-results"
                      start={offset + 1}
                      aria-label="Challenge standings"
                    >
                      {standings.standings.map((result) => (
                        <li key={`${result.rank}:${result.username}`}>
                          <span className="competition-results__rank">
                            {result.rank}
                          </span>
                          <div>
                            <strong>u/{result.username}</strong>
                            <br />
                            <ResultLine result={result} />
                          </div>
                        </li>
                      ))}
                    </ol>
                  ) : !standingsBusy && !standingsError ? (
                    <p>No completed entries yet.</p>
                  ) : null}
                  <div className="competition-pagination">
                    <button
                      className="btn btn--sm"
                      type="button"
                      disabled={standingsBusy || offset === 0}
                      onClick={() => setOffset(Math.max(0, offset - 20))}
                    >
                      Previous page
                    </button>
                    <button
                      className="btn btn--sm"
                      type="button"
                      disabled={
                        standingsBusy ||
                        !standingsCurrent ||
                        !standings?.hasMore
                      }
                      onClick={() => setOffset(offset + 20)}
                    >
                      Next page
                    </button>
                  </div>
                </>
              )}
            </section>
          </div>
          {state.latestResult && !state.latestResult.superseded && (
            <section
              className="panel competition-final"
              aria-labelledby="competition-final-title"
            >
              <h2 id="competition-final-title">Latest finalized result</h2>
              <p className="field__hint">
                Period ended {formatCompetitionDate(state.latestResult.endsAt)}
              </p>
              {state.latestResult.winner ? (
                <p>
                  <strong>u/{state.latestResult.winner.username}</strong> won
                  with{" "}
                  <ResultLine
                    result={{
                      ...state.latestResult.winner,
                      achievedAt: state.latestResult.endsAt,
                    }}
                  />
                  .
                </p>
              ) : (
                <p>No completed entries in this period.</p>
              )}
            </section>
          )}
        </>
      )}
      {error && (
        <p className="notice notice--attention" role="alert">
          {error}
        </p>
      )}
      {(error || uncertain || !state) && (
        <button
          type="button"
          className="btn"
          disabled={busy}
          onClick={() => void refresh(true)}
        >
          Refresh challenge
        </button>
      )}
      {confirmRetry && (
        <Dialog
          labelledBy="competition-retry-title"
          onDismiss={() => setConfirmRetry(false)}
        >
          <h2 id="competition-retry-title">Start a fresh attempt?</h2>
          <p>
            Your placements will be cleared and the timer will restart on the
            same puzzle. Your best completed result is kept.
          </p>
          <div className="dialog__actions">
            <button
              className="btn"
              type="button"
              onClick={() => setConfirmRetry(false)}
            >
              Keep playing
            </button>
            <button
              className="btn btn--primary"
              type="button"
              onClick={() => void mutate("retry")}
            >
              Restart attempt
            </button>
          </div>
        </Dialog>
      )}
    </PageShell>
  );
}
