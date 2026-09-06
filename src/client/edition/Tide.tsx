import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { coordinate } from "../../shared/edition-geometry";
import type { TideState } from "../../shared/edition-game";
import type { PlayMode } from "../../shared/edition-contract";
import { useEdition } from "./use-edition";
import "./style.css";

const SIZE = 6;
const position = (point: number) => ({
  x: 70 + (point % SIZE) * 100,
  y: 70 + Math.floor(point / SIZE) * 100,
});
const ownerName = (player: number, mode: PlayMode) =>
  player === 1
    ? mode === "duel"
      ? "Coral"
      : "You"
    : mode === "duel"
      ? "Teal"
      : "Undertow";

export function Tide() {
  const { game, loading, busy, error, mode, start, move, reload } =
    useEdition<TideState>();
  const [selected, setSelected] = useState<number | null>(null);
  const [focus, setFocus] = useState(14);
  const [chosenMode, setChosenMode] = useState<PlayMode>("solo");
  const [target, setTarget] = useState(60);
  const [dialog, setDialog] = useState<"rules" | "new" | null>(null);
  const [fresh, setFresh] = useState<string[]>([]);
  const previous = useRef<number | null>(null);
  const humanEpoch = useRef(0);
  const grid = useRef<HTMLDivElement>(null);
  const modal = useRef<HTMLDialogElement>(null);
  const playable = Boolean(
    game &&
      game.winner === null &&
      !busy &&
      !loading &&
      (mode !== "solo" || game.turn === 1),
  );

  useEffect(() => {
    setSelected(null);
    humanEpoch.current = performance.now();
    if (game && previous.current !== null && game.revision > previous.current) {
      setFresh(
        game.history.slice(previous.current).flatMap((event) => event.squares),
      );
    }
    previous.current = game?.revision ?? null;
    const timeout = window.setTimeout(() => setFresh([]), 1400);
    return () => window.clearTimeout(timeout);
  }, [game]);
  useEffect(() => {
    if (!busy) humanEpoch.current = performance.now();
  }, [busy]);
  useEffect(() => {
    if (dialog && !modal.current?.open) modal.current?.showModal();
    if (!dialog) modal.current?.close();
  }, [dialog]);

  const selectPoint = (point: number) => {
    setFocus(point);
    if (playable && game?.board[point] === 0) setSelected(point);
  };
  const place = () => {
    if (!playable || selected === null) return;
    const point = selected;
    setSelected(null);
    void move({ point });
  };
  const navigate = (event: KeyboardEvent<HTMLButtonElement>, point: number) => {
    if (
      ![
        "ArrowLeft",
        "ArrowRight",
        "ArrowUp",
        "ArrowDown",
        "Home",
        "End",
        "Enter",
        " ",
      ].includes(event.key)
    )
      return;
    event.preventDefault();
    if (event.repeat || event.timeStamp < humanEpoch.current || busy) return;
    if (event.key === "Enter" || event.key === " ") {
      selectPoint(point);
      return;
    }
    const row = Math.floor(point / SIZE),
      col = point % SIZE;
    const next =
      event.key === "ArrowLeft"
        ? row * SIZE + Math.max(0, col - 1)
        : event.key === "ArrowRight"
          ? row * SIZE + Math.min(5, col + 1)
          : event.key === "ArrowUp"
            ? Math.max(0, row - 1) * SIZE + col
            : event.key === "ArrowDown"
              ? Math.min(5, row + 1) * SIZE + col
              : event.key === "Home"
                ? row * SIZE
                : row * SIZE + 5;
    setFocus(next);
    grid.current
      ?.querySelector<HTMLButtonElement>(`[data-point="${next}"]`)
      ?.focus();
  };
  const begin = async () => {
    if (await start({ target }, chosenMode)) {
      previous.current = null;
      setFresh([]);
      setDialog(null);
    }
  };
  const activeMode = game ? mode : chosenMode;
  const scores = game?.scores ?? [0, 0];
  const finished = game?.winner !== null && game !== null;
  const status = loading
    ? "Gathering the stones…"
    : busy
      ? "Setting the stone…"
      : finished
        ? game.winner === 0
          ? "An even tide."
          : `${ownerName(game.winner!, activeMode)} ${game.winner === 1 && mode === "solo" ? "win" : "wins"}!`
        : game
          ? `${ownerName(game.turn, activeMode)}${game.turn === 1 && mode === "solo" ? "r" : "’s"} turn`
          : "Ready for the tide?";
  const recent = game?.history.slice(mode === "solo" ? -2 : -1) ?? [];

  return (
    <div className="tide-shell">
      <header className="masthead">
        <div className="wordmark">
          <h1>Tide</h1>
          <span>A Euclid game</span>
        </div>
        <nav aria-label="Game controls">
          <button onClick={() => setDialog("rules")}>How to play</button>
          <button disabled={busy || loading} onClick={() => setDialog("new")}>
            New game
          </button>
        </nav>
      </header>
      {error && (
        <div className="connection-error" role="alert">
          {error}{" "}
          <button onClick={() => void reload()} disabled={busy}>
            Reconnect
          </button>
        </div>
      )}
      <main className="game-layout">
        <section
          className="playfield"
          aria-label="Tide board and placement controls"
        >
          <div
            className="board-wrap"
            ref={grid}
            role="group"
            aria-label="Six by six board. Arrow keys navigate, Enter selects, then use Place stone."
          >
            <svg className="board-art" viewBox="0 0 640 640" aria-hidden="true">
              <defs>
                <radialGradient id="shore">
                  <stop offset="0" stopColor="#fcfaf5" />
                  <stop offset="1" stopColor="#f8f8f3" />
                </radialGradient>
              </defs>
              {[0, 1, 2, 3, 4].map((i) => (
                <rect
                  key={i}
                  x={30 - i * 6}
                  y={30 - i * 6}
                  width={580 + i * 12}
                  height={580 + i * 12}
                  rx={42 + i * 9}
                  fill="none"
                  stroke="#cfdfd8"
                  strokeOpacity={0.5 - i * 0.065}
                />
              ))}
              <rect
                x="45"
                y="45"
                width="550"
                height="550"
                rx="4"
                fill="url(#shore)"
                stroke="#c4ccc2"
              />
              {Array.from({ length: 6 }, (_, i) => (
                <g key={i}>
                  <path
                    d={`M70 ${70 + i * 100}H570 M${70 + i * 100} 70V570`}
                    stroke="#c3cec5"
                    strokeWidth="1"
                  />
                  <text x={70 + i * 100} y="24" textAnchor="middle">
                    {String.fromCharCode(65 + i)}
                  </text>
                  <text x="23" y={77 + i * 100} textAnchor="middle">
                    {i + 1}
                  </text>
                </g>
              ))}
              {game?.squares.map((square) => (
                <polygon
                  key={square.id}
                  className={`${square.owner === 1 ? "coral-square" : "teal-square"} ${fresh.includes(square.id) ? "fresh-square" : ""}`}
                  points={square.corners
                    .map((point) => {
                      const p = position(point);
                      return `${p.x},${p.y}`;
                    })
                    .join(" ")}
                />
              ))}
              {Array.from({ length: 36 }, (_, point) => {
                const p = position(point);
                return (
                  <circle key={point} cx={p.x} cy={p.y} r="4" fill="#a1afa5" />
                );
              })}
            </svg>
            {Array.from({ length: 36 }, (_, point) => {
              const owner = game?.board[point] ?? 0,
                anchored = game?.anchored[point] ?? false;
              const turnsLeft =
                owner && game
                  ? Math.max(
                      0,
                      Math.ceil((game.expires[point]! - game.revision) / 2),
                    )
                  : 0;
              const p = position(point);
              const description = owner
                ? `${ownerName(owner, activeMode)}, ${anchored ? "anchored" : `${turnsLeft} turns until it washes away`}`
                : "empty";
              return (
                <button
                  key={point}
                  data-point={point}
                  tabIndex={focus === point ? 0 : -1}
                  aria-label={`${coordinate(point)}: ${description}`}
                  aria-pressed={selected === point}
                  aria-disabled={!playable || owner !== 0}
                  className={`board-point owner-${owner}${anchored ? " anchored" : ""}${selected === point ? " selected" : ""}${owner && !anchored && turnsLeft <= 1 ? " fading" : ""}`}
                  style={{ left: `${p.x / 6.4}%`, top: `${p.y / 6.4}%` }}
                  onFocus={() => setFocus(point)}
                  onClick={() => selectPoint(point)}
                  onKeyDown={(event) => navigate(event, point)}
                >
                  {owner !== 0 && (
                    <>
                      <span className="stone" />
                      {anchored ? (
                        <span className="anchor-center" />
                      ) : (
                        <svg
                          className="age-ring"
                          viewBox="0 0 48 48"
                          aria-hidden="true"
                        >
                          <circle
                            cx="24"
                            cy="24"
                            r="21"
                            pathLength="6"
                            strokeDasharray={`${turnsLeft} 6`}
                          />
                        </svg>
                      )}
                    </>
                  )}
                  {selected === point && <span className="selection-corners" />}
                </button>
              );
            })}
          </div>
          <div className="board-controls">
            <div className="mode-label">
              <span className="mode-dot" />
              {mode === "duel" && game ? "Pass & play" : "Against Undertow"}
            </div>
            <div className="placement">
              <button
                className="primary"
                disabled={!playable || selected === null}
                onClick={place}
              >
                Place stone
                {selected !== null ? (
                  <span className="coordinate">{coordinate(selected)}</span>
                ) : null}
              </button>
              <button
                className="cancel"
                disabled={selected === null || busy}
                onClick={() => setSelected(null)}
              >
                Cancel
              </button>
            </div>
          </div>
          <p className="board-caption">
            Scores stay. Completed squares anchor their corners.
          </p>
        </section>
        <aside className="game-rail">
          <h2>Ride the moment.</h2>
          <p className="intro">Build a square before your stones drift away.</p>
          <div className="scores" aria-label="Scores">
            {([1, 2] as const).map((player) => (
              <div key={player} className={`score player-${player}`}>
                <span>
                  <i className={`token token-${player}`} />
                  {ownerName(player, activeMode)}
                </span>
                <strong>{scores[player - 1]}</strong>
              </div>
            ))}
          </div>
          <div className="target-line">
            <span>First to {game?.target ?? target}</span>
          </div>
          <section
            className={`turn-status player-${game?.turn ?? 1}`}
            aria-live="polite"
          >
            <h3>{status}</h3>
            <p>
              {finished
                ? `Final score ${scores[0]}–${scores[1]}. ${game.revision >= game.moveLimit ? "Thirty rounds played." : "The shore is yours to inspect."}`
                : game
                  ? selected === null
                    ? "Choose an empty point."
                    : `${coordinate(selected)} is ready. Place your stone.`
                  : "Six turns to build something lasting."}
            </p>
            {!game && (
              <div className="start-options">
                <label>
                  Play style
                  <select
                    value={chosenMode}
                    disabled={busy || loading}
                    onChange={(e) => setChosenMode(e.target.value as PlayMode)}
                  >
                    <option value="solo">Against Undertow</option>
                    <option value="duel">Pass & play</option>
                  </select>
                </label>
                <button
                  className="primary"
                  disabled={busy || loading}
                  onClick={begin}
                >
                  Begin a game
                </button>
              </div>
            )}
            {finished && (
              <button
                className="primary"
                disabled={busy}
                onClick={() => setDialog("new")}
              >
                Play again
              </button>
            )}
          </section>
          <section className="last-move">
            <h3>Last move</h3>
            {recent.length ? (
              recent.map((event, index) => (
                <p
                  key={game!.revision - recent.length + index}
                  className={`player-${event.player}`}
                >
                  <strong>
                    {event.points
                      ? `+${event.points}`
                      : coordinate(event.point)}
                  </strong>{" "}
                  · {ownerName(event.player, activeMode)}
                  {event.squares.length
                    ? ` anchored ${event.squares.length === 1 ? "a square" : `${event.squares.length} squares`}`
                    : " placed a stone"}
                  {event.washed.length > 0 && (
                    <small>
                      {event.washed.length}{" "}
                      {event.washed.length === 1
                        ? "stone washed"
                        : "stones washed"}{" "}
                      away.
                    </small>
                  )}
                </p>
              ))
            ) : (
              <p className="quiet">The water is still.</p>
            )}
          </section>
          <section className="tide-legend">
            <p>Six turns. Then the tide takes it.</p>
            <div className="lifetimes" aria-hidden="true">
              {[6, 5, 4, 3, 2, 1].map((life) => (
                <span key={life} style={{ opacity: 0.24 + life * 0.12 }}>
                  <i />
                  {life}
                </span>
              ))}
            </div>
            <p className="legend-note">
              The ring drains with each round. A center mark means the stone is
              anchored.
            </p>
            {game && (
              <div className="round-track">
                <span>
                  Round{" "}
                  {Math.min(
                    30,
                    finished
                      ? Math.max(1, Math.ceil(game.revision / 2))
                      : Math.floor(game.revision / 2) + 1,
                  )}{" "}
                  / 30
                </span>
                <progress
                  max="60"
                  value={game.revision}
                  aria-label="Moves played"
                />
              </div>
            )}
          </section>
        </aside>
      </main>
      <footer>
        Unranked ·{" "}
        {game && mode === "duel"
          ? "Two players, one screen"
          : "Your moves are checked by the game server"}
      </footer>
      <dialog
        ref={modal}
        onCancel={() => setDialog(null)}
        onClose={() => setDialog(null)}
        aria-labelledby="dialog-title"
      >
        <div className="dialog-heading">
          <h2 id="dialog-title">
            {dialog === "rules" ? "A little give and take." : "A fresh tide."}
          </h2>
          <button aria-label="Close dialog" onClick={() => setDialog(null)}>
            Close
          </button>
        </div>
        {dialog === "rules" ? (
          <>
            <p>
              Take turns claiming an empty point. Four of your stones at the
              corners of a square score together. Squares can be tilted, nested,
              or different sizes; every new square counts.
            </p>
            <ol>
              <li>
                <strong>Six personal turns.</strong> A new stone stays for six
                rounds, including the round you placed it. It washes away before
                your seventh turn unless it has been anchored. Its ring shows
                the time left.
              </li>
              <li>
                <strong>Complete to keep.</strong> Completing a square anchors
                all four corners permanently. Anchored stones have a center
                mark. Your points never wash away.
              </li>
              <li>
                <strong>Score the footprint.</strong> Count the grid positions
                across the square’s enclosing box, including both edges, then
                square that number. A smallest square is worth 4; a one-step
                tilted square is worth 9. The goal is {game?.target ?? target}{" "}
                points.
              </li>
              <li>
                <strong>A definite finish.</strong> Reach the target first. At
                30 rounds, or when no empty points remain after the tide, the
                higher score wins. Equal scores are a draw.
              </li>
            </ol>
            <p>
              Coral uses solid diamonds. Teal uses rings. Select a point, then
              choose <strong>Place stone</strong>. Arrow keys move focus; Enter
              or Space selects. No clock runs while you think.
            </p>
            <button className="primary" onClick={() => setDialog(null)}>
              Back to the shore
            </button>
          </>
        ) : (
          <>
            <p>
              {game && game.winner === null
                ? "Starting again replaces the current game. Its score is not recorded in any ranking."
                : "Choose the pace and who shares the shore."}
            </p>
            <label>
              Play style
              <select
                value={chosenMode}
                onChange={(e) => setChosenMode(e.target.value as PlayMode)}
              >
                <option value="solo">Against Undertow</option>
                <option value="duel">Pass & play</option>
              </select>
            </label>
            <label>
              Target
              <select
                value={target}
                onChange={(e) => setTarget(Number(e.target.value))}
              >
                <option value="40">40 points · Short</option>
                <option value="60">60 points · Standard</option>
                <option value="90">90 points · Long</option>
              </select>
            </label>
            {error && (
              <p className="connection-error" role="alert">
                {error}
              </p>
            )}
            <div className="dialog-actions">
              <button className="cancel" onClick={() => setDialog(null)}>
                Keep this game
              </button>
              <button className="primary" disabled={busy} onClick={begin}>
                Start fresh
              </button>
            </div>
          </>
        )}
      </dialog>
    </div>
  );
}
