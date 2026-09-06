import { useMemo, type ReactNode } from "react";

import type {
  H2HLiveGameSummary,
  SerializableBoard,
} from "../shared/types/api";
import { ReplayBoardCard, type ReplayTheme } from "./share-replay";
import { buildWatchDemo } from "./watch-demo";
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
          className={primary ? "watch-controls__primary" : undefined}
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
  children,
}: {
  title: string;
  theme: ReplayTheme;
  children: ReactNode;
}) {
  return (
    <main className="watch-page" data-theme={theme} tabIndex={0}>
      <div className="watch-page__content">
        <h1>Euclid — {title}</h1>
        {children}
      </div>
    </main>
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
    <li className="watch-match">
      <h3>
        {names[0]} vs {names[1]}
      </h3>
      <dl className="watch-match__scores">
        {names.map((name, index) => (
          <div key={game.playerIds[index]}>
            <dt>{name}</dt>
            <dd>{game.scores[index] ?? 0}</dd>
          </div>
        ))}
      </dl>
      <p className="watch-page__muted">
        Redditor match · {game.width} × {game.height} · First to {game.winScore}
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
  onPlay,
  theme = "dark",
}: {
  games: H2HLiveGameSummary[];
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
  onWatch: (gameId: string) => void;
  onDemo: () => void;
  onPlay: () => void;
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
    { label: "Play", onClick: onPlay, primary: true },
  ];

  return (
    <WatchPage title="Watch Live" theme={theme}>
      <p className="watch-page__muted">
        Watch other Redditors place dots and complete squares. You are a
        spectator: watching does not join the match or change its board.
      </p>
      {loading ? (
        <p role="status">Finding live games…</p>
      ) : error ? (
        <div role="alert" className="watch-page__panel">
          <h2>Could not load live games</h2>
          <p>{error}</p>
          <p className="watch-page__muted">
            Try again, watch the demo, or start playing.
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
        <div className="watch-page__panel" role="status">
          <h2>No live games right now</h2>
          <p className="watch-page__muted">
            Watch the recorded teaching demo to see how squares score, or play a
            game yourself.
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
  onPlay: () => void;
};

export function WatchActions({
  initialFocus = false,
  onReplay,
  onDemo,
  onAnother,
  onPlay,
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
        { label: "Play", onClick: onPlay, primary: true },
      ]}
    />
  );
}

export function WatchUnavailable({
  onAnother,
  onDemo,
  onPlay,
  theme = "dark",
}: Omit<WatchActionsProps, "onReplay" | "initialFocus"> & {
  theme?: ReplayTheme;
}) {
  return (
    <WatchPage title="Game unavailable" theme={theme}>
      <p>This game is no longer available to watch.</p>
      <p className="watch-page__muted">
        There is no confirmed final board to replay. Choose another live game,
        watch the teaching demo, or play a game yourself.
      </p>
      <WatchActions onAnother={onAnother} onDemo={onDemo} onPlay={onPlay} />
    </WatchPage>
  );
}

export function WatchReplay({
  board,
  theme,
  headline,
  onAnother,
  onPlay,
}: {
  board: SerializableBoard | null;
  theme: ReplayTheme;
  headline?: string | undefined;
  onAnother: () => void;
  onPlay: () => void;
}) {
  const replayBoard = useMemo(() => board ?? buildWatchDemo(), [board]);
  const isDemo = board === null;
  return (
    <WatchPage title={isDemo ? "Watch demo" : "Match replay"} theme={theme}>
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
      <WatchActions onAnother={onAnother} onPlay={onPlay} />
      <ReplayBoardCard
        board={replayBoard}
        theme={theme}
        kind={isDemo ? "demo" : "replay"}
        compact
      />
    </WatchPage>
  );
}
