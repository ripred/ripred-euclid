import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  LINK_BONUS,
  POINTS,
  TARGET,
  TRIANGLES,
  type WeaveState,
} from "../../shared/edition-game";
import type { PlayMode, Player } from "../../shared/edition-contract";
import { useEdition } from "./use-edition";
import { WeaveBoard } from "./WeaveBoard";

const playerName = (player: Player) => (player === 1 ? "Terracotta" : "Indigo");
function Dialog({
  children,
  title,
  onClose,
}: {
  children: ReactNode;
  title: string;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className="weave-dialog"
      aria-labelledby="dialog-title"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <div className="dialog-top">
        <h2 id="dialog-title">{title}</h2>
        <button onClick={onClose} aria-label="Close dialog">
          Close
        </button>
      </div>
      {children}
    </dialog>
  );
}

function Rules({ onClose }: { onClose: () => void }) {
  return (
    <Dialog title="Three points. One possibility." onClose={onClose}>
      <p className="dialog-intro">
        The familiar pleasure of finding a shape, with a new rhythm: triangles
        that connect.
      </p>
      <ol className="rules-list">
        <li>
          <strong>Take a point.</strong> Alternate claiming one empty point.
          Terracotta goes first. Your points stay yours.
        </li>
        <li>
          <strong>Find three equal sides.</strong> Every equilateral triangle
          with three of your points scores. Larger and tilted triangles count,
          too. Dots inside a triangle do not affect it.
        </li>
        <li>
          <strong>Score its area.</strong> One smallest triangle is worth 1.
          Double its side and it is worth 4; triple it, 9. Area—not
          orientation—sets its value.
        </li>
        <li>
          <strong>Connect a weave.</strong> Two of your triangles sharing the
          same complete edge earn +{LINK_BONUS}. Each pair scores once, even if
          both triangles finish together. A shared point or part of an edge
          earns no link bonus.
        </li>
        <li>
          <strong>First to {TARGET}.</strong> Your move scores every triangle it
          completes. Reach {TARGET} to win immediately. If all 28 points fill
          first, the higher score wins; equal scores tie.
        </li>
      </ol>
      <div
        className="area-examples"
        aria-label="Triangle area examples: side 1 scores 1; side 2 scores 4; side 3 scores 9"
      >
        {[1, 2, 3].map((size) => (
          <div key={size}>
            <svg viewBox="0 0 120 108" aria-hidden="true">
              <polygon
                points={`60,${96 - size * 17 * Math.sqrt(3)} ${60 - size * 17},96 ${60 + size * 17},96`}
              />
            </svg>
            <span>
              Side {size} <strong>+{size * size}</strong>
            </span>
          </div>
        ))}
      </div>
      <p className="quiet">
        Keyboard: Tab to the lattice, use arrow keys to explore, then Enter or
        Space to claim. A fresh press is required each turn.
      </p>
      <button className="primary full-width" onClick={onClose}>
        Back to the weave
      </button>
    </Dialog>
  );
}

function Scoreboard({
  game,
  ownerLabels,
}: {
  game: WeaveState | null;
  ownerLabels: [string, string];
}) {
  return (
    <div className="scores" aria-label="Scores">
      {([1, 2] as const).map((player) => {
        const score = game?.scores[player - 1] ?? 0;
        return (
          <div className={`score player-${player}`} key={player}>
            <div className="score-name">
              <span className={`piece piece-${player}`} aria-hidden="true" />
              {playerName(player)}
            </div>
            <div className="score-value">{score}</div>
            <div
              className="score-track"
              role="progressbar"
              aria-label={`${playerName(player)} progress to ${TARGET}`}
              aria-valuenow={Math.min(TARGET, score)}
              aria-valuemax={TARGET}
              aria-valuemin={0}
            >
              <span
                style={{ width: `${Math.min(100, (score / TARGET) * 100)}%` }}
              />
            </div>
            <span className="score-owner">{ownerLabels[player - 1]}</span>
          </div>
        );
      })}
    </div>
  );
}

function Lattice({
  game,
  available,
  onClaim,
}: {
  game: WeaveState | null;
  available: boolean;
  onClaim: (point: number) => void;
}) {
  const [cursor, setCursor] = useState(0);
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const acceptAfter = useRef(0);
  const revision = game?.revision ?? 0;
  const previousGame = useRef(game);
  const newFromRevision =
    previousGame.current && previousGame.current !== game
      ? previousGame.current.revision
      : revision;
  useEffect(() => {
    previousGame.current = game;
  }, [game]);
  useLayoutEffect(() => {
    acceptAfter.current = performance.now();
  }, [available, revision]);

  function navigate(point: number, key: string) {
    const origin = POINTS[point];
    if (!origin) return;
    const direction =
      key === "ArrowLeft"
        ? [-1, 0]
        : key === "ArrowRight"
          ? [1, 0]
          : key === "ArrowUp"
            ? [0, -1]
            : [0, 1];
    const next = POINTS.filter((candidate) => {
      const dx = candidate.x - origin.x;
      const dy = candidate.y - origin.y;
      return dx * (direction[0] ?? 0) + dy * (direction[1] ?? 0) > 0;
    }).sort((a, b) => {
      const value = (p: typeof a) => {
        const dx = p.x - origin.x;
        const dy = p.y - origin.y;
        const cross = Math.abs(
          dx * (direction[1] ?? 0) - dy * (direction[0] ?? 0),
        );
        return Math.hypot(dx, dy) + cross * 0.6;
      };
      return value(a) - value(b);
    })[0];
    if (next) {
      setCursor(next.id);
      buttons.current[next.id]?.focus();
    }
  }

  return (
    <WeaveBoard
      game={game}
      available={available}
      newFromRevision={newFromRevision}
      renderPoint={(point, owner, pointProps) => (
        <button
          key={point.id}
          {...pointProps}
          ref={(element) => {
            buttons.current[point.id] = element;
          }}
          tabIndex={point.id === cursor ? 0 : -1}
          aria-label={`Point ${point.label}, ${owner ? playerName(owner) : "empty"}${game?.lastMove?.point === point.id ? ", last move" : ""}`}
          aria-disabled={!available || owner !== 0}
          onFocus={() => setCursor(point.id)}
          onKeyDown={(event) => {
            if (event.key.startsWith("Arrow")) {
              event.preventDefault();
              navigate(point.id, event.key);
            } else if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              if (
                !event.repeat &&
                event.timeStamp >= acceptAfter.current &&
                available &&
                owner === 0
              )
                onClaim(point.id);
            }
          }}
          onClick={(event) => {
            if (
              event.timeStamp >= acceptAfter.current &&
              available &&
              owner === 0
            )
              onClaim(point.id);
          }}
        >
          {pointProps.children}
        </button>
      )}
    />
  );
}

function LastStitch({
  game,
  mode,
  humanStitchLabel,
  ownerLabels,
}: {
  game: WeaveState | null;
  mode: PlayMode;
  humanStitchLabel: string;
  ownerLabels: [string, string];
}) {
  const last = game?.lastMove;
  const name = (player: Player) =>
    mode === "duel" ? playerName(player) : ownerLabels[player - 1];
  const humanStitch =
    mode === "solo" && last?.player === 2 && game?.previousMove?.player === 1
      ? game.previousMove
      : null;
  return (
    <section className="last-stitch" aria-labelledby="stitch-title">
      <h3 id="stitch-title">The last stitch</h3>
      {humanStitch && humanStitch.points > 0 && (
        <p className="human-stitch">
          {humanStitchLabel}: {humanStitch.triangles.length}{" "}
          {humanStitch.triangles.length === 1 ? "triangle" : "triangles"} +
          {humanStitch.area}
          {humanStitch.links > 0
            ? ` / links +${humanStitch.links * LINK_BONUS}`
            : ""}
        </p>
      )}
      {last ? (
        <>
          <p className={`stitch-result player-${last.player}`}>
            {last.points > 0 ? (
              <>
                {last.triangles.length === 1
                  ? "Triangle"
                  : `${last.triangles.length} triangles`}{" "}
                +{last.area}
                {last.links > 0 && (
                  <>
                    {" "}
                    /{" "}
                    {last.links === 1
                      ? "Shared edge"
                      : `${last.links} shared edges`}{" "}
                    +{last.links * LINK_BONUS}
                  </>
                )}
              </>
            ) : (
              <>
                {name(last.player)} claimed {POINTS[last.point]?.label}.
              </>
            )}
          </p>
          {last.points > 0 && (
            <p className="quiet">
              {name(last.player)} added {last.points}{" "}
              {last.points === 1 ? "point" : "points"}.
            </p>
          )}
        </>
      ) : (
        <p className="stitch-result">A single point starts a pattern.</p>
      )}
      <p>
        A complete shared edge links two triangles belonging to the same player.
        Each link scores once.
      </p>
    </section>
  );
}

export function Weave() {
  const {
    game,
    mode,
    loading,
    busy,
    error,
    start,
    move,
    reload,
    watching,
    hostName,
  } = useEdition<WeaveState>();
  const [rulesOpen, setRulesOpen] = useState(false);
  const [setupOpen, setSetupOpen] = useState(false);
  const [chosenMode, setChosenMode] = useState<PlayMode>("solo");
  const active = game !== null && game.winner === null;
  const canPlay =
    !watching &&
    active &&
    !busy &&
    !loading &&
    (mode === "duel" || game.turn === 1);
  const humanName = watching ? (hostName ?? "Redditor") : "You";
  const ownerLabels: [string, string] =
    mode === "duel" ? ["Player 1", "Player 2"] : [humanName, "Euclid"];
  const outcome = game?.winner;
  const heading = loading
    ? "Gathering threads…"
    : busy
      ? "A stitch in time…"
      : !game
        ? "Find your thread."
        : outcome === 0
          ? "Beautifully tied."
          : outcome === 1
            ? mode === "duel"
              ? "Terracotta wins."
              : watching
                ? `${humanName}’s weave wins.`
                : "Your weave wins."
            : outcome === 2
              ? mode === "duel"
                ? "Indigo wins."
                : "Euclid wins."
              : mode === "duel"
                ? `${playerName(game.turn)}’s thread.`
                : game.turn === 1
                  ? watching
                    ? `${humanName}’s thread.`
                    : "Your thread."
                  : "Euclid’s thread.";
  const instructions = !game
    ? "Twenty-eight points. Three equal sides. A new way to see the possibilities."
    : outcome !== null
      ? outcome === 0
        ? "The lattice is full. Both weaves finish with the same score."
        : `${mode === "duel" ? playerName(outcome ?? 1) : ownerLabels[(outcome ?? 1) - 1]} ${Math.max(...game.scores) >= TARGET ? `reached ${TARGET}` : "finished ahead on the full lattice"}. Every thread counted.`
      : watching
        ? "Inspect the points and completed triangles."
        : "Claim one empty point.";

  async function begin() {
    if (watching) return;
    if (await start(undefined, chosenMode)) setSetupOpen(false);
  }

  if (watching && !game)
    return (
      <main className="weave-app">
        <p>Waiting for the broadcast…</p>
      </main>
    );

  return (
    <main className="weave-app">
      <header className="weave-header">
        <div className="wordmark">Weave</div>
        <p>A game of connected triangles</p>
        <nav aria-label="Game">
          <button onClick={() => setRulesOpen(true)}>How to play</button>
          <button
            className="primary"
            onClick={() => {
              if (watching) return;
              setChosenMode(mode === "duel" ? "duel" : "solo");
              setSetupOpen(true);
            }}
            disabled={watching || busy || loading}
          >
            New game
          </button>
        </nav>
      </header>
      <div className="game-layout">
        <section className="board-region" aria-label="Game board">
          <Lattice
            game={game}
            available={canPlay}
            onClaim={(point) => {
              if (!watching) void move({ point });
            }}
          />
          <div className="board-legend">
            <span>
              <i className="piece piece-1" />
              Terracotta circular point
            </span>
            <em>versus</em>
            <span>
              <i className="piece piece-2" />
              Indigo diamond point
            </span>
          </div>
          <p className="board-caption">
            {watching
              ? "Read-only board · Arrow keys inspect points."
              : "Choose a point. Complete a triangle. Connect a weave."}
          </p>
        </section>
        <aside className="game-rail">
          <Scoreboard game={game} ownerLabels={ownerLabels} />
          <section
            className="turn-status"
            aria-live="polite"
            aria-atomic="true"
          >
            <h1>{heading}</h1>
            <p>{instructions}</p>
            {!game && !loading && (
              <button
                className="primary full-width"
                disabled={busy}
                onClick={() => {
                  setSetupOpen(true);
                }}
              >
                Begin a weave
              </button>
            )}
            {!watching && game && game.winner !== null && (
              <button
                className="primary full-width"
                disabled={busy}
                onClick={() => setSetupOpen(true)}
              >
                Weave again
              </button>
            )}
          </section>
          {error && (
            <section className="error-message" role="alert">
              <p>{error}</p>
              <button
                disabled={busy || loading}
                onClick={() => {
                  void reload();
                }}
              >
                Reconnect
              </button>
            </section>
          )}
          <LastStitch
            game={game}
            mode={mode}
            humanStitchLabel={
              watching ? `${humanName}’s stitch` : "Your stitch"
            }
            ownerLabels={ownerLabels}
          />
          <footer className="match-detail">
            <p>
              First to {TARGET} <span>·</span>{" "}
              {game ? game.cells.filter((cell) => cell === 0).length : 28}{" "}
              {game ? "points left" : "points"}
            </p>
            <span className="quiet">
              {mode === "duel"
                ? "Same-device two player"
                : `${humanName} versus Euclid`}{" "}
              · Unrated
            </span>
          </footer>
        </aside>
      </div>
      <footer className="page-footer">
        <span>Euclid / Weave edition</span>
        <span>Equal sides. Unexpected connections.</span>
      </footer>
      {rulesOpen && <Rules onClose={() => setRulesOpen(false)} />}
      {!watching && setupOpen && (
        <Dialog
          title={
            active ? "Start a fresh weave?" : "Who holds the other thread?"
          }
          onClose={() => {
            if (!busy) setSetupOpen(false);
          }}
        >
          <p className="dialog-intro">
            {active
              ? "Starting again replaces this unfinished game. Your current weave stays here if you cancel."
              : "Terracotta takes the first point. Play against Euclid or pass the board to a friend."}
          </p>
          <fieldset className="mode-choice" disabled={busy}>
            <legend>Choose your opponent</legend>
            <label className={chosenMode === "solo" ? "selected" : ""}>
              <input
                type="radio"
                name="mode"
                value="solo"
                checked={chosenMode === "solo"}
                onChange={() => setChosenMode("solo")}
              />
              <span>
                <strong>Play Euclid</strong>
                <small>A thoughtful computer opponent</small>
              </span>
            </label>
            <label className={chosenMode === "duel" ? "selected" : ""}>
              <input
                type="radio"
                name="mode"
                value="duel"
                checked={chosenMode === "duel"}
                onChange={() => setChosenMode("duel")}
              />
              <span>
                <strong>Play a friend</strong>
                <small>Take turns on this device</small>
              </span>
            </label>
          </fieldset>
          <p className="quiet">
            Seven rows · 28 points · First to {TARGET} · {TRIANGLES.length}{" "}
            possible triangles
          </p>
          {error && (
            <p className="error-message" role="alert">
              {error}
            </p>
          )}
          <div className="dialog-actions">
            <button disabled={busy} onClick={() => setSetupOpen(false)}>
              Cancel
            </button>
            <button
              className="primary"
              disabled={busy}
              onClick={() => {
                void begin();
              }}
            >
              {busy ? "Starting…" : "Start weaving"}
            </button>
          </div>
        </Dialog>
      )}
    </main>
  );
}
