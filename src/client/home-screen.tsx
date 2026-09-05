import {
  shouldLockHomeNavigation,
  type CompetitiveRecordPresentation,
  type H2HHomePresentation,
  type SoloContinuationPresentation,
} from "./home-ui";

export type HomeBusyAction =
  | "solo"
  | "h2h"
  | "solo-continuation"
  | "h2h-continuation";

export interface HomeLoadingState {
  presence: boolean;
  solo: boolean;
  records: boolean;
}

export interface HomeScreenProps {
  username: string;
  playEuclidSubtitle: string;
  records: readonly [
    CompetitiveRecordPresentation,
    CompetitiveRecordPresentation,
  ];
  soloContinuation: SoloContinuationPresentation | null;
  h2h: H2HHomePresentation;
  loading: HomeLoadingState;
  presenceReconciliationPending?: boolean;
  busyAction?: HomeBusyAction | null;
  status?: string;
  error?: string;
  onPlayEuclid: () => void;
  onPlayRedditor: () => void;
  onContinueSolo: () => void;
  onContinueH2H: () => void;
  onCancelSearch: () => void;
  onWatchGames: () => void;
  onLeaderboard: () => void;
  onOptions: () => void;
  onRules: () => void;
}

interface HomeActionButtonProps {
  label: string;
  busyLabel: string;
  disabled: boolean;
  busy: boolean;
  className: string;
  describedBy?: string | undefined;
  onClick: () => void;
}

function HomeActionButton({
  label,
  busyLabel,
  disabled,
  busy,
  className,
  describedBy,
  onClick,
}: HomeActionButtonProps) {
  return (
    <button
      type="button"
      className={className}
      disabled={disabled}
      aria-busy={busy || undefined}
      aria-describedby={describedBy}
      onClick={onClick}
    >
      <span>{busy ? busyLabel : label}</span>
      <span className="euclid-home__button-arrow" aria-hidden="true">
        →
      </span>
    </button>
  );
}

function CompetitiveRecordCard({
  record,
  loading,
}: {
  record: CompetitiveRecordPresentation;
  loading: boolean;
}) {
  return (
    <article
      className={`euclid-home__record${record.available || loading ? "" : " euclid-home__record--unavailable"}`}
      aria-label={`${record.label} record`}
      aria-busy={loading || undefined}
    >
      <h3>{record.label}</h3>
      <dl>
        <div className="euclid-home__record-rating">
          <dt>Rating</dt>
          <dd>{loading ? "…" : record.rating}</dd>
        </div>
        <div>
          <dt>Record</dt>
          <dd>{loading ? "Loading record…" : record.record}</dd>
        </div>
        <div>
          <dt>Activity</dt>
          <dd>{loading ? "Checking recent games" : record.games}</dd>
        </div>
      </dl>
    </article>
  );
}

interface RedditorMatchCardProps {
  h2h: H2HHomePresentation;
  actionPending: boolean;
  h2hBusy: boolean;
  continuationBusy: boolean;
  presenceLoading: boolean;
  lockDescriptionId?: string | undefined;
  onPlayRedditor: () => void;
  onContinueH2H: () => void;
  onCancelSearch: () => void;
}

function RedditorMatchCard({
  h2h,
  actionPending,
  h2hBusy,
  continuationBusy,
  presenceLoading,
  lockDescriptionId,
  onPlayRedditor,
  onContinueH2H,
  onCancelSearch,
}: RedditorMatchCardProps) {
  const cardClassName = `euclid-home__match-card euclid-home__match-card--${h2h.state}`;

  if (h2h.state === "queued") {
    return (
      <article className={cardClassName}>
        <div
          className="euclid-home__match-status"
          role="status"
          aria-live="polite"
        >
          <div className="euclid-home__match-heading">
            <span className="euclid-home__queue-indicator" aria-hidden="true" />
            <span className="euclid-home__state-label">Matchmaking</span>
          </div>
          <h2>{h2h.title}</h2>
          <p>{h2h.detail}</p>
        </div>
        <button
          type="button"
          className="euclid-home__secondary-button"
          disabled={actionPending}
          aria-busy={h2hBusy || undefined}
          aria-describedby={lockDescriptionId}
          onClick={onCancelSearch}
        >
          {h2hBusy ? "Cancelling…" : h2h.actionLabel}
        </button>
      </article>
    );
  }

  if (h2h.state === "active") {
    return (
      <article className={cardClassName}>
        <div className="euclid-home__match-heading">
          <span className="euclid-home__state-dot" aria-hidden="true" />
          <span className="euclid-home__state-label">
            {h2h.ended ? "Completed match" : "Match in progress"}
          </span>
        </div>
        <h2>{h2h.title}</h2>
        <p>{h2h.detail}</p>
        <p className="euclid-home__match-score">{h2h.score}</p>
        <HomeActionButton
          className="euclid-home__secondary-button euclid-home__secondary-button--strong"
          label={h2h.actionLabel}
          busyLabel={presenceLoading ? "Checking status…" : "Opening match…"}
          disabled={actionPending || presenceLoading}
          busy={continuationBusy || presenceLoading}
          describedBy={lockDescriptionId}
          onClick={onContinueH2H}
        />
      </article>
    );
  }

  return (
    <article className={cardClassName}>
      <div className="euclid-home__match-heading">
        <span className="euclid-home__state-label">Live multiplayer</span>
      </div>
      <h2>{h2h.title}</h2>
      <p>{h2h.detail}</p>
      <HomeActionButton
        className="euclid-home__secondary-button euclid-home__secondary-button--strong"
        label={h2h.actionLabel}
        busyLabel={presenceLoading ? "Checking status…" : "Joining queue…"}
        disabled={actionPending || presenceLoading}
        busy={h2hBusy || presenceLoading}
        describedBy={lockDescriptionId}
        onClick={onPlayRedditor}
      />
    </article>
  );
}

function formatUsername(username: string): string {
  const trimmed = username.trim().replace(/^u\//i, "");
  return trimmed ? `u/${trimmed}` : "Redditor";
}

function EuclidBrand({ titleId }: { titleId: string }) {
  return (
    <div className="euclid-home__brand">
      <span className="euclid-home__brand-mark" aria-hidden="true">
        <span />
        <span />
        <span />
        <span />
      </span>
      <div>
        <p className="euclid-home__eyebrow">A game of completed squares</p>
        <h1 id={titleId}>Euclid</h1>
      </div>
    </div>
  );
}

export interface HomeStatusAction {
  label: string;
  onClick: () => void;
  primary?: boolean;
  disabled?: boolean;
  busy?: boolean;
}

export interface HomeStatusScreenProps {
  heading: string;
  detail: string;
  busy?: boolean;
  error?: boolean;
  actions?: readonly HomeStatusAction[];
}

/** A cohesive loading/error surface for initialization and game transitions. */
export function HomeStatusScreen({
  heading,
  detail,
  busy = false,
  error = false,
  actions = [],
}: HomeStatusScreenProps) {
  return (
    <main
      className="euclid-home euclid-home--status"
      aria-labelledby="euclid-status-brand"
    >
      <div className="euclid-home__frame euclid-home__status-frame">
        <header className="euclid-home__header">
          <EuclidBrand titleId="euclid-status-brand" />
        </header>
        <section
          className={`euclid-home__status-card${error ? " euclid-home__status-card--error" : ""}`}
        >
          <div
            className="euclid-home__status-message"
            role={error ? "alert" : "status"}
            aria-live={error ? "assertive" : "polite"}
          >
            {busy && (
              <span className="euclid-home__loading-dot" aria-hidden="true" />
            )}
            <div>
              <h2>{heading}</h2>
              <p>{detail}</p>
            </div>
          </div>
          {actions.length > 0 && (
            <div className="euclid-home__status-actions">
              {actions.map((action) => (
                <button
                  key={action.label}
                  type="button"
                  className={
                    action.primary
                      ? "euclid-home__secondary-button euclid-home__secondary-button--strong"
                      : "euclid-home__secondary-button"
                  }
                  disabled={action.disabled}
                  aria-busy={action.busy || undefined}
                  onClick={action.onClick}
                >
                  {action.label}
                </button>
              ))}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}

/**
 * Presentational home dashboard. All game state and actions remain owned by the
 * caller so this view cannot infer or mutate authoritative match state.
 */
export function HomeScreen({
  username,
  playEuclidSubtitle,
  records,
  soloContinuation,
  h2h,
  loading,
  presenceReconciliationPending = false,
  busyAction = null,
  status = "",
  error = "",
  onPlayEuclid,
  onPlayRedditor,
  onContinueSolo,
  onContinueH2H,
  onCancelSearch,
  onWatchGames,
  onLeaderboard,
  onOptions,
  onRules,
}: HomeScreenProps) {
  const actionPending = busyAction !== null;
  const matchmaking = h2h.state === "queued";
  const navigationLocked = shouldLockHomeNavigation(
    actionPending,
    h2h.state,
    presenceReconciliationPending,
  );
  const anythingLoading = loading.presence || loading.solo || loading.records;
  const lockDescriptionId = navigationLocked
    ? "euclid-home-action-lock-description"
    : undefined;
  const utilityActions = [
    { label: "Live games", onClick: onWatchGames },
    { label: "Leaderboard", onClick: onLeaderboard },
    { label: "Options", onClick: onOptions },
    { label: "Rules", onClick: onRules },
  ] as const;

  return (
    <main className="euclid-home" aria-labelledby="euclid-home-title">
      <div className="euclid-home__frame">
        {navigationLocked && (
          <p
            id="euclid-home-action-lock-description"
            className="euclid-sr-only"
          >
            {presenceReconciliationPending
              ? "Unavailable while matchmaking status is being confirmed."
              : matchmaking && !actionPending
                ? "Unavailable while searching for a Redditor match. Cancel the search to choose another activity."
                : "Unavailable while another game action is in progress."}
          </p>
        )}
        <header className="euclid-home__header">
          <EuclidBrand titleId="euclid-home-title" />
          <p className="euclid-home__username" title={formatUsername(username)}>
            <span aria-hidden="true">●</span>
            {formatUsername(username)}
          </p>
        </header>

        {(anythingLoading || status || error) && (
          <div className="euclid-home__notices">
            {anythingLoading && (
              <p
                id="euclid-home-loading-description"
                className="euclid-home__notice"
                role="status"
              >
                <span className="euclid-home__loading-dot" aria-hidden="true" />
                Refreshing your games and records…
              </p>
            )}
            {status && (
              <p
                className="euclid-home__notice"
                role="status"
                aria-live="polite"
              >
                {status}
              </p>
            )}
            {error && (
              <p
                className="euclid-home__notice euclid-home__notice--error"
                role="alert"
              >
                {error}
              </p>
            )}
          </div>
        )}

        <section className="euclid-home__dashboard" aria-label="Choose a game">
          <div className="euclid-home__play-column">
            <button
              type="button"
              className="euclid-home__primary-action"
              disabled={
                actionPending || matchmaking || loading.presence || loading.solo
              }
              aria-busy={
                busyAction === "solo" ||
                loading.presence ||
                loading.solo ||
                undefined
              }
              aria-describedby={
                loading.presence || loading.solo
                  ? "euclid-home-loading-description"
                  : lockDescriptionId
              }
              onClick={onPlayEuclid}
            >
              <span className="euclid-home__primary-kicker">Solo play</span>
              <span className="euclid-home__primary-title">
                {busyAction === "solo" ? "Opening game…" : "Play Euclid"}
              </span>
              <span className="euclid-home__primary-detail">
                {playEuclidSubtitle}
              </span>
              <span className="euclid-home__primary-arrow" aria-hidden="true">
                →
              </span>
            </button>

            <RedditorMatchCard
              h2h={h2h}
              actionPending={actionPending}
              h2hBusy={busyAction === "h2h"}
              continuationBusy={busyAction === "h2h-continuation"}
              presenceLoading={loading.presence}
              lockDescriptionId={
                loading.presence
                  ? "euclid-home-loading-description"
                  : actionPending
                    ? lockDescriptionId
                    : undefined
              }
              onPlayRedditor={onPlayRedditor}
              onContinueH2H={onContinueH2H}
              onCancelSearch={onCancelSearch}
            />

            {loading.solo ? (
              <article className="euclid-home__continue-card" aria-busy="true">
                <div className="euclid-home__continue-copy">
                  <span className="euclid-home__state-label">Saved game</span>
                  <h2>Checking for a saved game…</h2>
                  <p>Your current Ranked game will appear here.</p>
                </div>
              </article>
            ) : soloContinuation ? (
              <article className="euclid-home__continue-card">
                <div className="euclid-home__continue-copy">
                  <span className="euclid-home__state-label">Saved game</span>
                  <h2>{soloContinuation.title}</h2>
                  <p>{soloContinuation.detail}</p>
                  <p className="euclid-home__continue-score">
                    {soloContinuation.score}
                  </p>
                  <p className="euclid-home__continue-rules">
                    {soloContinuation.rules}
                  </p>
                </div>
                <HomeActionButton
                  className="euclid-home__continue-button"
                  label={soloContinuation.actionLabel}
                  busyLabel={
                    loading.presence ? "Checking status…" : "Opening game…"
                  }
                  disabled={actionPending || matchmaking || loading.presence}
                  busy={busyAction === "solo-continuation" || loading.presence}
                  describedBy={
                    loading.presence
                      ? "euclid-home-loading-description"
                      : lockDescriptionId
                  }
                  onClick={onContinueSolo}
                />
              </article>
            ) : null}
          </div>

          <aside
            className="euclid-home__records"
            aria-labelledby="home-records-title"
          >
            <div className="euclid-home__section-heading">
              <p className="euclid-home__eyebrow">Competitive profile</p>
              <h2 id="home-records-title">Your records</h2>
              <p>Solo and multiplayer ratings are tracked separately.</p>
            </div>
            <div className="euclid-home__record-list">
              {records.map((record) => (
                <CompetitiveRecordCard
                  key={record.label}
                  record={record}
                  loading={loading.records}
                />
              ))}
            </div>
          </aside>
        </section>

        <nav
          className="euclid-home__utilities"
          aria-label="More Euclid options"
        >
          <ul>
            {utilityActions.map((action) => (
              <li key={action.label}>
                <button
                  type="button"
                  disabled={navigationLocked}
                  aria-describedby={lockDescriptionId}
                  onClick={action.onClick}
                >
                  {action.label}
                </button>
              </li>
            ))}
          </ul>
        </nav>
      </div>
    </main>
  );
}
