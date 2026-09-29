import { useMemo, type ReactNode } from "react";

import type {
  H2HLiveGameSummary,
  SerializableBoard,
} from "../shared/types/api";
import { ReplayBoardCard, type ReplayTheme } from "./share-replay";
import { PageShell } from "./ui/PageShell";
import { buildWatchDemo } from "./watch-demo";
import { rulesSummary } from "./format";
import "./watch-view.css";

type WatchAction = {
  label: string;
  onClick: () => void;
  primary?: boolean;
  disabled?: boolean;
};

function WatchControls({
  actions,
  initialFocus = false,
}: {
  actions: WatchAction[];
  initialFocus?: boolean;
}) {
  // Only modal results request focus; lobby and replay controls must not steal
  // it. Skip disabled actions so the dialog always receives a usable target.
  const focusIndex = initialFocus
    ? actions.findIndex((action) => !action.disabled)
    : -1;
  return (
    <div className="watch-controls">
      {actions.map(({ label, onClick, primary, disabled }, index) => (
        <button
          key={label}
          type="button"
          autoFocus={index === focusIndex}
          className={primary ? "btn btn--primary" : "btn"}
          onClick={onClick}
          disabled={disabled}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function WatchPage({
  title,
  theme,
  onBack,
  children,
}: {
  title: string;
  theme: ReplayTheme;
  onBack: () => void;
  children: ReactNode;
}) {
  return (
    <PageShell
      title={
        <>
          <span className="euclid-sr-only">Euclid — </span>
          {title}
        </>
      }
      titleId="watch-title"
      back={{ label: "Back to game menu", onClick: onBack }}
      className="watch-page"
      data-theme={theme}
      tabIndex={0}
    >
      <div className="watch-page__content">{children}</div>
    </PageShell>
  );
}

function LastActivity({ timestamp }: { timestamp: number }) {
  const date = new Date(timestamp);
  const hasTimestamp = timestamp > 0 && Number.isFinite(date.getTime());
  return (
    <p className="watch-page__muted watch-match__activity">
      Last activity:{" "}
      {hasTimestamp ? (
        <time dateTime={date.toISOString()} title={date.toLocaleString()}>
          {date.toLocaleTimeString()}
        </time>
      ) : (
        "unknown"
      )}
    </p>
  );
}

function LiveMatch({
  game,
  onWatch,
}: {
  game: H2HLiveGameSummary;
  onWatch: (gameId: string) => void;
}) {
  // Names are display data; only the canonical ordered IDs pair them to scores.
  const names = game.playerIds.map(
    (id, index) => game.names[id] || `Player ${index + 1}`,
  );
  return (
    <li className="panel watch-match">
      <div className="watch-match__head">
        <span className="badge badge--live">Live</span>
        <h3>
          {names[0]} vs {names[1]}
        </h3>
      </div>
      <dl className="watch-match__scores">
        {names.map((name, index) => (
          <div
            key={game.playerIds[index]}
            className={`watch-match__player watch-match__player--${index + 1}`}
          >
            <dt>{name}</dt>
            <dd>{game.scores[index] ?? 0}</dd>
          </div>
        ))}
      </dl>
      <p className="watch-page__muted">
        Redditor match ·{" "}
        {game.variant === "tide"
          ? rulesSummary(game)
          : `First to ${game.winScore}`}
      </p>
      <LastActivity timestamp={game.lastSaved} />
      <WatchControls
        actions={[
          {
            label: "Watch",
            onClick: () => onWatch(game.gameId),
            primary: true,
          },
        ]}
      />
    </li>
  );
}

export function WatchLobby({
  games,
  loading,
  error,
  onRefresh,
  onWatch,
  onDemo,
  onBack,
  theme = "dark",
}: {
  games: H2HLiveGameSummary[];
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
  onWatch: (gameId: string) => void;
  onDemo: () => void;
  onBack: () => void;
  theme?: ReplayTheme;
}) {
  // A loading/error response must not advertise the previous list as live.
  const showGames = !loading && !error && games.length > 0;
  const actions: WatchAction[] = [
    {
      label: error ? "Retry" : "Refresh",
      onClick: onRefresh,
      disabled: loading,
    },
    ...(!showGames && !loading
      ? [{ label: "Watch demo", onClick: onDemo }]
      : []),
  ];

  return (
    <WatchPage title="Watch live" theme={theme} onBack={onBack}>
      <p className="watch-page__muted">
        Watch other Redditors place dots and complete squares. You are a
        spectator: watching does not join the match or change its board.
      </p>
      {loading ? (
        <p role="status">Finding live games…</p>
      ) : error ? (
        <div role="alert" className="panel watch-page__panel">
          <h2>Could not load live games</h2>
          <p>{error}</p>
          <p className="watch-page__muted">
            Try again, watch the demo, or return to the game menu.
          </p>
        </div>
      ) : showGames ? (
        <section aria-labelledby="watch-live-count">
          <h2 id="watch-live-count">
            {games.length} live {games.length === 1 ? "game" : "games"}
          </h2>
          <ul className="watch-matches">
            {games.map((game) => (
              <LiveMatch key={game.gameId} game={game} onWatch={onWatch} />
            ))}
          </ul>
        </section>
      ) : (
        <div className="panel watch-page__panel" role="status">
          <h2>No live games right now</h2>
          <p className="watch-page__muted">
            Watch the recorded teaching demo to see how squares score, or return
            to the game menu.
          </p>
        </div>
      )}
      <WatchControls actions={actions} />
    </WatchPage>
  );
}

type WatchActionsProps = {
  initialFocus?: boolean;
  onReplay?: (() => void) | undefined;
  onDemo?: (() => void) | undefined;
  onAnother: () => void;
  /** Result dialogs need their own exit; standalone pages use the header. */
  onBack?: () => void;
};

export function WatchActions({
  initialFocus = false,
  onReplay,
  onDemo,
  onAnother,
  onBack,
}: WatchActionsProps) {
  const recordingAction = onReplay
    ? { label: "Replay", onClick: onReplay }
    : onDemo
      ? { label: "Watch demo", onClick: onDemo }
      : null;
  return (
    <WatchControls
      initialFocus={initialFocus}
      actions={[
        ...(recordingAction ? [recordingAction] : []),
        { label: "Another live game", onClick: onAnother },
        ...(onBack
          ? [{ label: "Back to game menu", onClick: onBack, primary: true }]
          : []),
      ]}
    />
  );
}

export function WatchUnavailable({
  onAnother,
  onDemo,
  onBack,
  theme = "dark",
}: Pick<WatchActionsProps, "onAnother" | "onDemo"> & {
  onBack: () => void;
  theme?: ReplayTheme;
}) {
  return (
    <WatchPage title="Game unavailable" theme={theme} onBack={onBack}>
      <p>This game is no longer available to watch.</p>
      <p className="watch-page__muted">
        There is no confirmed final board to replay. Choose another live game,
        watch the teaching demo, or return to the game menu.
      </p>
      <WatchActions onAnother={onAnother} onDemo={onDemo} />
    </WatchPage>
  );
}

export function WatchReplay({
  board,
  theme,
  headline,
  onAnother,
  onBack,
}: {
  board: SerializableBoard | null;
  theme: ReplayTheme;
  headline?: string | undefined;
  onAnother: () => void;
  onBack: () => void;
}) {
  const replayBoard = useMemo(() => board ?? buildWatchDemo(), [board]);
  const isDemo = board === null;
  return (
    <WatchPage
      title={isDemo ? "Watch demo" : "Match replay"}
      theme={theme}
      onBack={onBack}
    >
      {isDemo ? (
        <p className="watch-page__muted">
          Recorded teaching demo — not a live match. Follow the dots to see
          straight, tilted, and multiple squares score.
        </p>
      ) : (
        <>
          {headline ? <h2>{headline}</h2> : null}
          <p className="watch-page__muted">
            Recorded replay of the match you watched. This does not affect the
            result.
          </p>
        </>
      )}
      <WatchActions onAnother={onAnother} />
      <ReplayBoardCard
        board={replayBoard}
        theme={theme}
        kind={isDemo ? "demo" : "replay"}
        compact
      />
    </WatchPage>
  );
}
