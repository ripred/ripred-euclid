import type { SoloMode } from "../shared/game/rules";
import {
  shouldLockHomeNavigation,
  type CompetitiveRecordPresentation,
  type H2HHomePresentation,
  type SoloContinuationPresentation,
} from "./home-ui";
import { HowToPlay } from "./how-to-play";
import { BoardMacro, BrandMark, TokenCluster, Wordmark } from "./ui/Brand";
import { Icon, type IconName } from "./ui/Icon";
import { PieceGlyph } from "./ui/BoardDiagram";
import "./home-screen.css";

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
  /** The selected solo path; Ranked uses fixed server rules. */
  soloMode?: SoloMode;
  onSoloModeChange?: ((mode: SoloMode) => void) | undefined;
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
      <Icon name="arrow" size={18} />
    </button>
  );
}

function CompetitiveRecordCard({
  record,
  loading,
  owner,
}: {
  record: CompetitiveRecordPresentation;
  loading: boolean;
  owner: 1 | 2;
}) {
  return (
    <article
      className={`home-record${record.available || loading ? "" : " home-record--unavailable"}`}
      aria-label={`${record.label} record`}
      aria-busy={loading || undefined}
    >
      <h3>
        <PieceGlyph owner={owner} size={16} />
        {record.label}
      </h3>
      <dl>
        <div className="home-record__rating">
          <dt>Rating</dt>
          <dd className="num">{loading ? "…" : record.rating}</dd>
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

const STRONG_BUTTON =
  "btn btn--blue euclid-home__secondary-button euclid-home__secondary-button--strong";

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
  const cardClassName = `panel home-card home-match home-match--${h2h.state}`;

  if (h2h.state === "queued") {
    return (
      <article className={cardClassName}>
        <div className="home-card__copy" role="status" aria-live="polite">
          <p className="eyebrow home-match__state">
            <span className="home-match__radar" aria-hidden="true" />
            Matchmaking
          </p>
          <h2>{h2h.title}</h2>
          <p>{h2h.detail}</p>
        </div>
        <button
          type="button"
          className="btn euclid-home__secondary-button"
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
        <div className="home-card__copy">
          <p className="eyebrow home-match__state">
            {!h2h.ended ? (
              <span className="badge badge--live">Live</span>
            ) : null}
            {h2h.ended ? "Completed match" : "Match in progress"}
          </p>
          <h2>{h2h.title}</h2>
          <p>{h2h.detail}</p>
          <p className="home-card__score num">{h2h.score}</p>
        </div>
        <HomeActionButton
          className={STRONG_BUTTON}
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
      <TokenCluster owner={2} className="home-card__tokens" />
      <div className="home-card__copy">
        <p className="eyebrow">Live multiplayer</p>
        <h2>{h2h.title}</h2>
        <p>{h2h.detail}</p>
      </div>
      <HomeActionButton
        className={STRONG_BUTTON}
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
      className="screen euclid-home euclid-home--status"
      aria-labelledby="euclid-status-brand"
    >
      <div className="home-status">
        <header>
          <Wordmark id="euclid-status-brand" size="md" />
        </header>
        <section
          className={`panel home-status__card${error ? " home-status__card--error" : ""}`}
        >
          <div
            className="home-status__message"
            role={error ? "alert" : "status"}
            aria-live={error ? "assertive" : "polite"}
          >
            {busy ? (
              <span className="home-status__spinner" aria-hidden="true">
                <BrandMark size={44} />
              </span>
            ) : null}
            <div>
              <h2>{heading}</h2>
              <p>{detail}</p>
            </div>
          </div>
          {actions.length > 0 && (
            <div className="home-status__actions">
              {actions.map((action) => (
                <button
                  key={action.label}
                  type="button"
                  className={
                    action.primary
                      ? "btn btn--primary euclid-home__secondary-button euclid-home__secondary-button--strong"
                      : "btn euclid-home__secondary-button"
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

const UTILITIES: readonly {
  label: string;
  icon: IconName;
  action: "onWatchGames" | "onLeaderboard" | "onOptions" | "onRules";
}[] = [
  { label: "Live games", icon: "watch", action: "onWatchGames" },
  { label: "Leaderboard", icon: "trophy", action: "onLeaderboard" },
  { label: "Options", icon: "sliders", action: "onOptions" },
  { label: "Rules", icon: "help", action: "onRules" },
];

/**
 * Presentational home dashboard. All game state and actions remain owned by the
 * caller so this view cannot infer or mutate authoritative match state.
 */
export function HomeScreen(props: HomeScreenProps) {
  const {
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
    soloMode,
    onSoloModeChange,
    onPlayEuclid,
    onPlayRedditor,
    onContinueSolo,
    onContinueH2H,
    onCancelSearch,
    onOptions,
  } = props;
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
  const soloStartDisabled =
    actionPending || matchmaking || loading.presence || loading.solo;

  return (
    <main className="screen euclid-home" aria-labelledby="euclid-home-title">
      <BoardMacro className="home-hero__art" />
      <div className="home">
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
        <header className="home-hero">
          <Wordmark id="euclid-home-title" size="lg" />
          <p className="home-hero__user" title={formatUsername(username)}>
            {formatUsername(username)}
          </p>
          <p className="home-hero__tagline">
            A minute to learn. A lifetime to master.
          </p>
        </header>

        {(anythingLoading || status || error) && (
          <div className="home-notices">
            {anythingLoading && (
              <p
                id="euclid-home-loading-description"
                className="notice home-notice--loading"
                role="status"
              >
                <span className="busy-dot" aria-hidden="true" />
                Refreshing your games and records…
              </p>
            )}
            {status && (
              <p className="notice" role="status" aria-live="polite">
                {status}
              </p>
            )}
            {error && (
              <p className="notice notice--attention" role="alert">
                {error}
              </p>
            )}
          </div>
        )}

        <section className="home-grid" aria-label="Choose a game">
          <div className="home-grid__play">
            {loading.solo ? (
              <article
                className="panel home-card home-continue home-continue--pending"
                aria-busy="true"
              >
                <div className="home-card__copy">
                  <p className="eyebrow">Saved game</p>
                  <h2>Checking for a saved game…</h2>
                  <p>Your current Ranked game will appear here.</p>
                </div>
              </article>
            ) : soloContinuation ? (
              <article className="panel home-card home-continue">
                <div className="home-card__copy">
                  <p className="eyebrow">Saved game</p>
                  <h2>{soloContinuation.title}</h2>
                  <p>{soloContinuation.detail}</p>
                  <p className="home-card__score num">
                    {soloContinuation.score}
                  </p>
                  <p className="home-card__rules">{soloContinuation.rules}</p>
                </div>
                <HomeActionButton
                  className="btn btn--primary euclid-home__continue-button"
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

            <article className="panel home-card home-solo">
              <TokenCluster owner={1} className="home-card__tokens" />
              <div className="home-solo__head">
                <div className="home-card__copy">
                  <p className="eyebrow">Solo · against Euclid</p>
                  <h2>Play Euclid</h2>
                </div>
                {soloMode && onSoloModeChange ? (
                  <div
                    className="seg home-solo__mode"
                    role="radiogroup"
                    aria-label="Solo game type"
                  >
                    {(["practice", "ranked"] as const).map((choice) => (
                      <button
                        key={choice}
                        type="button"
                        role="radio"
                        aria-checked={soloMode === choice}
                        disabled={navigationLocked}
                        onClick={() => onSoloModeChange(choice)}
                      >
                        {choice === "ranked" ? "Ranked" : "Practice"}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
              <p className="home-solo__detail">{playEuclidSubtitle}</p>
              <div className="home-solo__actions">
                <button
                  type="button"
                  className="btn btn--primary btn--lg euclid-home__primary-action"
                  disabled={soloStartDisabled}
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
                  <span className="euclid-home__primary-title">
                    {busyAction === "solo" ? "Opening game…" : "Play Euclid"}
                  </span>
                  <Icon name="arrow" />
                </button>
                <button
                  type="button"
                  className="btn btn--ghost home-solo__settings"
                  disabled={
                    navigationLocked || loading.presence || loading.solo
                  }
                  aria-describedby={lockDescriptionId}
                  onClick={onOptions}
                >
                  <Icon name="sliders" size={18} />
                  <span>Change difficulty</span>
                </button>
              </div>
            </article>

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
          </div>

          <aside
            className="panel home-records"
            aria-labelledby="home-records-title"
          >
            <div className="home-card__copy">
              <p className="eyebrow">Competitive profile</p>
              <h2 id="home-records-title">Your records</h2>
              <p>Solo and multiplayer ratings are tracked separately.</p>
            </div>
            <div className="home-records__list">
              {records.map((record, index) => (
                <CompetitiveRecordCard
                  key={record.label}
                  record={record}
                  owner={index === 0 ? 1 : 2}
                  loading={loading.records}
                />
              ))}
            </div>
          </aside>
        </section>

        <section className="home-learn" aria-labelledby="home-learn-title">
          <div className="home-learn__head">
            <h2 id="home-learn-title">Learn in a minute</h2>
            <p className="muted">
              Three ideas carry the whole game. Mastering them takes a lifetime.
            </p>
          </div>
          <HowToPlay layout="strip" />
        </section>

        <nav className="home-nav" aria-label="More Euclid options">
          <ul>
            {UTILITIES.map((item) => (
              <li key={item.label}>
                <button
                  type="button"
                  className="home-nav__item"
                  disabled={navigationLocked}
                  aria-describedby={lockDescriptionId}
                  onClick={props[item.action]}
                >
                  <Icon name={item.icon} />
                  <span>{item.label}</span>
                </button>
              </li>
            ))}
          </ul>
        </nav>
      </div>
    </main>
  );
}
