import { journeyActivityKey } from "../shared/journeys";
import type { JourneyController } from "./journeys";
import { competitionJourneyObservation } from "./journeys-gameplay";
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
  COMPETITION_RANKING_GUIDANCE,
  competitionAvailabilityText,
  competitionLabel,
  formatCompetitionDate,
  formatCompetitionResult,
} from "./competition-display";
import { useCompetitionClock } from "./use-competition-availability";
import { challengeObjective } from "./challenge-display";
import { ChallengeTimer } from "./ChallengeTimer";
import { ChallengeBoard } from "./ui/ChallengeBoard";
import { Dialog } from "./ui/Dialog";
import { PageShell } from "./ui/PageShell";
import "./competition-screen.css";

function ResultLine({ result }: { result: CompetitionResult }) {
  return <span>{formatCompetitionResult(result)}</span>;
}

/** Daily and weekly use the same authoritative, resumable competition flow. */
export function CompetitionScreen({
  period,
  username,
  onLeave,
  journeys,
  intentionalEntry = false,
}: {
  period: ChallengePeriod;
  username: string;
  onLeave: () => void;
  journeys?: JourneyController;
  intentionalEntry?: boolean;
}) {
  const [state, setState] = useState<CompetitionStateResponse | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [uncertain, setUncertain] = useState(false);
  const [confirmRetry, setConfirmRetry] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const [standings, setStandings] =
    useState<CompetitionStandingsResponse | null>(null);
  const [standingsError, setStandingsError] = useState("");
  const [standingsBusy, setStandingsBusy] = useState(false);
  const [offset, setOffset] = useState(0);
  const stateRef = useRef(state);
  const lastJourneyState = useRef<CompetitionStateResponse | null>(null);
  const pending = useRef(false);
  const mounted = useRef(false);
  const requestVersion = useRef(0);
  const journeyEntryPending = useRef(intentionalEntry);
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

  const adopt = useCallback(
    (next: CompetitionStateResponse) => {
      const old = stateRef.current;
      // Disabled challenges hide their attempt. Keep the last visible identity
      // so a later replacement still closes the journey that actually ended.
      const tracked = lastJourneyState.current;
      const previous = tracked ? competitionJourneyObservation(tracked) : null;
      const observation = competitionJourneyObservation(next);
      const active = journeys?.activeActivity();
      const observingPrevious =
        !!previous &&
        !!active &&
        journeyActivityKey(previous.activity) === journeyActivityKey(active);
      const sameAttempt =
        !!previous &&
        !!observation &&
        journeyActivityKey(previous.activity) ===
          journeyActivityKey(observation.activity);
      if (observingPrevious && sameAttempt && observation.terminal)
        journeys?.observe(observation);
      else if (
        observingPrevious &&
        tracked?.snapshot &&
        !tracked.snapshot.complete
      ) {
        const replaced =
          !!next.competition.instanceId &&
          tracked.competition.instanceId !== next.competition.instanceId;
        const expired = tracked.competition.endsAt <= next.serverNow;
        const retried =
          !!observation &&
          !sameAttempt &&
          tracked.competition.instanceId === next.competition.instanceId;
        if (retried) journeys?.end("retry");
        else if (replaced || expired) journeys?.end("unavailable");
      }
      if (observation) {
        lastJourneyState.current = next;
        if (journeyEntryPending.current && !observation.terminal)
          journeys?.begin(observation.activity, "resume", observation);
        else journeys?.restore(observation.activity);
        journeys?.observe(observation);
      }
      journeyEntryPending.current = false;
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
    },
    [journeys],
  );

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

  async function mutate(
    action: "start" | "retry" | "move" | "abandon",
    point?: number,
  ) {
    const current = stateRef.current;
    if (
      !current ||
      (!open && action !== "abandon") ||
      !signedIn ||
      pending.current ||
      busy ||
      uncertain
    )
      return;
    pending.current = true;
    ++requestVersion.current;
    setBusy(true);
    setError("");
    setConfirmRetry(false);
    const command = competitionCommand(current, action);
    const trackAccepted = (next: CompetitionStateResponse) => {
      const previous = competitionJourneyObservation(current);
      const observation = competitionJourneyObservation(next);
      if (
        action === "abandon" &&
        !next.snapshot &&
        next.authenticated === true &&
        next.competition.instanceId === current.competition.instanceId
      )
        journeys?.end("abandoned", command);
      const retried =
        action === "retry" &&
        previous &&
        observation &&
        previous.activity.kind === "competition" &&
        observation.activity.kind === "competition" &&
        previous.activity.attemptId !== observation.activity.attemptId;
      if (retried) journeys?.end("retry", command);
      if (observation && (action === "start" || retried)) {
        const entry = retried
          ? "retry"
          : observation.moves > 0
            ? "resume"
            : "new";
        journeys?.begin(
          observation.activity,
          entry,
          entry === "resume" ? observation : undefined,
        );
      }
      if (
        action === "move" &&
        previous &&
        observation &&
        next.snapshot!.revision > current.snapshot!.revision
      )
        journeys?.begin(previous.activity, "resume", previous);
    };
    try {
      const next = await requestCompetitionState(period, action, {
        ...command,
        ...(point === undefined ? {} : { point }),
      });
      if (mounted.current) {
        trackAccepted(next);
        adopt(next);
        setNotice("");
        if (action === "abandon" && !next.snapshot) onLeave();
      }
    } catch (failure) {
      if (!mounted.current) return;
      setError(errorMessage(failure, "The challenge request failed."));
      // A reply can be lost after a commit. Reconcile before accepting input.
      setUncertain(true);
      try {
        const next = await requestCompetitionState(period);
        if (mounted.current) {
          trackAccepted(next);
          adopt(next);
          if (
            action === "abandon" &&
            next.authenticated === true &&
            !next.snapshot &&
            next.competition.instanceId === current.competition.instanceId
          )
            onLeave();
        }
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
      back={{
        label: "Back to Euclid",
        onClick: () => {
          journeys?.pause();
          onLeave();
        },
        disabled: pending.current,
      }}
    >
      <div className="competition-toolbar">
        <p role="timer" aria-live="off">
          {competition
            ? competitionAvailabilityText(competition, now)
            : "Loading challenge…"}
        </p>
        <button
          type="button"
          className="btn btn--sm"
          disabled={!state || busy}
          onClick={() => {
            setShowDetails(true);
            journeys?.interaction("standings", "opened");
          }}
        >
          Details &amp; standings
        </button>
      </div>
      {notice && (
        <p className="notice" role="status">
          {notice}
        </p>
      )}
      {!state ? (
        <section className="panel competition-idle">
          <p role="status">
            {busy ? "Loading challenge…" : "Challenge unavailable."}
          </p>
        </section>
      ) : !competition?.enabled || competition.status === "disabled" ? (
        <section className="panel competition-idle">
          <h2>Challenge disabled</h2>
          <p>Subreddit moderators have disabled this challenge.</p>
        </section>
      ) : (
        <section
          className={`panel competition-play${open && signedIn && snapshot ? " competition-play--active" : ""}`}
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
                Sign in to Reddit to start this challenge and save your result.
              </p>
            </>
          ) : !snapshot ? (
            <>
              <h2>Ready for the challenge?</h2>
              <p>
                Start reveals the board and begins your timer. Complete the
                target squares using as few placements as possible.
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
              <div className="competition-objective">
                <h2>{challengeObjective(snapshot.puzzle)}</h2>
                <div className="competition-progress" role="status">
                  <span>
                    {snapshot.complete
                      ? "Puzzle complete"
                      : `Squares completed: ${snapshot.completedSquares.length}`}{" "}
                    · Pieces placed: {snapshot.placements.length}
                  </span>
                  <ChallengeTimer snapshot={snapshot} />
                </div>
              </div>
              <div className="competition-board-slot">
                <ChallengeBoard
                  fitToSpace
                  puzzle={snapshot.puzzle}
                  placements={snapshot.placements}
                  completedSquares={snapshot.completedSquares}
                  revision={`${snapshot.attemptId}:${snapshot.revision}`}
                  enabled={
                    !busy &&
                    !uncertain &&
                    !confirmRetry &&
                    !showDetails &&
                    !snapshot.complete
                  }
                  onPlace={(point) => void mutate("move", point)}
                />
              </div>
              <div className="competition-actions">
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
                {!snapshot.complete && (
                  <button
                    type="button"
                    className="btn"
                    disabled={busy || uncertain}
                    onClick={() => void mutate("abandon")}
                  >
                    Abandon Challenge
                  </button>
                )}
              </div>
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
      {showDetails && state && competition && (
        <Dialog
          labelledBy="competition-details-title"
          onDismiss={() => setShowDetails(false)}
          className="competition-details"
        >
          <div className="competition-details__header">
            <h2 id="competition-details-title">
              {competitionLabel(period)} details
            </h2>
            <button
              type="button"
              className="btn btn--sm"
              autoFocus
              onClick={() => setShowDetails(false)}
            >
              Close details
            </button>
          </div>
          <section aria-label="Challenge period">
            <p className="field__hint">
              {competition.status === "scheduled" ? "Opens" : "Opened"}{" "}
              {formatCompetitionDate(competition.opensAt)}
              <br />
              Closes {formatCompetitionDate(competition.endsAt)}
            </p>
            <p>
              One puzzle for this subreddit · Unlimited retries · Independent of
              ratings
            </p>
            <p className="field__hint">
              Arrow keys move focus; Enter or Space places a piece. No undo or
              hints. The move target is the certified minimum, not a move limit.{" "}
              {COMPETITION_RANKING_GUIDANCE}
            </p>
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
                      standingsBusy || !standingsCurrent || !standings?.hasMore
                    }
                    onClick={() => setOffset(offset + 20)}
                  >
                    Next page
                  </button>
                </div>
              </>
            )}
          </section>
          {state.latestResult && !state.latestResult.superseded && (
            <section
              className="panel competition-final"
              aria-labelledby="competition-final-title"
            >
              <h2 id="competition-final-title">Latest finalized result</h2>
              {state.latestResult.winner?.preview && (
                <p className="field__hint">Test result</p>
              )}
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
        </Dialog>
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
