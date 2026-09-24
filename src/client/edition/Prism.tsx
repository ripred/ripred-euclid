import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { coordinate, type PrismState } from "../../shared/edition-game";
import type { PlayMode } from "../../shared/edition-contract";
import { useEdition } from "./use-edition";
import { PrismBoard } from "./PrismBoard";
import { makeExhibit } from "./prism-exhibit";
import "./style.css";

const exhibit = makeExhibit();

function formatSquareCount(count: number): string {
  return `${count} ${count === 1 ? "square" : "squares"}`;
}

function PlayerMark({ player }: { player: 1 | 2 }) {
  return (
    <svg
      className={`player-mark player-${player}`}
      viewBox="0 0 32 32"
      aria-hidden="true"
    >
      {player === 1 ? (
        <path
          d="M16 3 29 16 16 29 3 16Z"
          fill="currentColor"
          fillOpacity=".2"
          stroke="currentColor"
          strokeWidth="2"
        />
      ) : (
        <circle
          cx="16"
          cy="16"
          r="12"
          fill="none"
          stroke="currentColor"
          strokeWidth="3"
        />
      )}
    </svg>
  );
}

function Modal({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose(): void;
  title: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (open && !dialog?.open) dialog?.showModal();
    if (!open && dialog?.open) dialog.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      className="prism-dialog"
      onCancel={onClose}
      onClose={onClose}
      aria-label={title}
    >
      <div className="dialog-heading">
        <h2>{title}</h2>
        <button
          className="close-dialog"
          onClick={onClose}
          aria-label="Close dialog"
        >
          ×
        </button>
      </div>
      {children}
    </dialog>
  );
}

function RulesDiagram() {
  return (
    <svg
      className="rules-diagram"
      viewBox="0 0 420 146"
      role="img"
      aria-label="An axis-aligned square spans three by three grid spots for nine points. A rotated square also spans three by three grid spots and scores nine points."
    >
      {[0, 1].map((side) => (
        <g key={side} transform={`translate(${35 + side * 225},15)`}>
          <path
            d={side === 0 ? "M0 0H90V90H0Z" : "M45 0 90 45 45 90 0 45Z"}
            fill="#ef8b78"
            fillOpacity=".12"
            stroke="#ef8b78"
            strokeWidth="1.3"
          />
          {Array.from({ length: 9 }, (_, index) => (
            <circle
              key={index}
              cx={(index % 3) * 45}
              cy={Math.floor(index / 3) * 45}
              r="3.2"
              fill="#e5e8d6"
            />
          ))}
          <text x="45" y="123" fill="#a8e0c0" textAnchor="middle">
            3 × 3 = 9 points
          </text>
        </g>
      ))}
    </svg>
  );
}

function GameOptions({
  target,
  setTarget,
  onStart,
  busy,
}: {
  target: 75 | 150;
  setTarget(value: 75 | 150): void;
  onStart(mode: PlayMode): void;
  busy: boolean;
}) {
  const selectId = useId();
  return (
    <div className="game-options">
      <label htmlFor={selectId}>Game length</label>
      <select
        id={selectId}
        value={target}
        onChange={(event) => setTarget(event.target.value === "75" ? 75 : 150)}
        disabled={busy}
      >
        <option value="150">Classic · first to 150</option>
        <option value="75">Short · first to 75</option>
      </select>
      <button
        className="primary-button"
        disabled={busy}
        onClick={() => onStart("solo")}
      >
        {busy ? "Preparing…" : "Against Euclid"}
        <span aria-hidden="true">↗</span>
      </button>
      <button
        className="secondary-button"
        disabled={busy}
        onClick={() => onStart("duel")}
      >
        Pass & play<span aria-hidden="true">↗</span>
      </button>
      <p className="small-print">
        Unranked games. Reload to resume your board. No effect on your Euclid
        rating.
      </p>
    </div>
  );
}

export function Prism() {
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
  } = useEdition<PrismState>();
  const [flat, setFlat] = useState(false);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [newOpen, setNewOpen] = useState(false);
  const [target, setTarget] = useState<75 | 150>(150);
  const inFlight = useRef(false);
  const busyRef = useRef(busy);
  busyRef.current = busy;
  const canPlay =
    !watching &&
    game !== null &&
    game.winner === null &&
    !busy &&
    !newOpen &&
    !rulesOpen &&
    (mode === "duel" || game.turn === 1);
  const playerNames: [string, string] =
    mode === "duel"
      ? ["Coral", "Mint"]
      : [watching ? (hostName ?? "Redditor") : "You", "Euclid"];
  const latest = game?.history.at(-1);
  const lastScoring = [...(game?.history ?? [])]
    .reverse()
    .find((entry) => entry.points > 0);
  const result =
    !game || game.winner === null
      ? ""
      : game.winner === 0
        ? "An even match."
        : !watching && mode === "solo" && game.winner === 1
          ? "You win."
          : `${playerNames[game.winner - 1]} wins.`;
  const status = !game
    ? "A different perspective."
    : result ||
      (busy || (mode === "solo" && game.turn === 2)
        ? "Euclid is considering…"
        : !watching && mode === "solo"
          ? "Your turn"
          : `${playerNames[game.turn - 1]}'s turn`);

  async function begin(nextMode: PlayMode): Promise<void> {
    if (watching || inFlight.current || busyRef.current) return;
    inFlight.current = true;
    try {
      if (await start({ target }, nextMode)) setNewOpen(false);
    } finally {
      inFlight.current = false;
    }
  }
  async function claim(index: number): Promise<void> {
    // This guard closes the same-frame double-click window before React rerenders.
    if (!canPlay || inFlight.current || busyRef.current) return;
    inFlight.current = true;
    try {
      await move({ index });
    } finally {
      inFlight.current = false;
    }
  }

  if (watching && !game)
    return (
      <main className="prism-app">
        <p>Waiting for the broadcast…</p>
      </main>
    );

  return (
    <main className="prism-app">
      <header className="masthead">
        <div className="wordmark">
          <h1>Prism</h1>
          <p>Euclid</p>
        </div>
        <nav aria-label="Game controls">
          <button onClick={() => setRulesOpen(true)}>How to play</button>
          <button
            disabled={watching || busy || loading}
            onClick={() => {
              if (!watching) setNewOpen(true);
            }}
          >
            New game
          </button>
        </nav>
      </header>
      <div className="game-layout">
        <section className="board-column" aria-label="Prism game">
          <PrismBoard
            game={game ?? exhibit}
            active={canPlay}
            readOnly={watching}
            flat={flat}
            onMove={(index) => {
              void claim(index);
            }}
          />
          <div className="board-caption">
            <button
              className={!flat ? "view-toggle selected" : "view-toggle"}
              aria-pressed={!flat}
              onClick={() => setFlat(false)}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="m3 15 7 4 11-8-7-4Z M3 18l7 4 11-8" />
              </svg>
              Tilt view
            </button>
            <p>
              {watching
                ? "Inspect the points and completed squares."
                : "Claim a point. Complete the square."}
            </p>
            <button
              className={flat ? "view-toggle selected" : "view-toggle"}
              aria-pressed={flat}
              onClick={() => setFlat(true)}
            >
              Flat view
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <rect x="4" y="4" width="16" height="16" rx="1" />
                <path d="M9 4v16m6-16v16M4 9h16M4 15h16" />
              </svg>
            </button>
          </div>
        </section>
        <aside className="score-rail" aria-label="Score and game status">
          <p
            className={`turn-status ${game?.turn === 2 ? "mint" : "coral"}`}
            role="status"
            aria-live="polite"
          >
            {loading ? "Opening the gallery…" : status}
          </p>
          {!game ? (
            <div className="welcome">
              <h2>
                See the square
                <br />
                before it exists.
              </h2>
              <p>
                One point at a time. Four corners become a square, at any angle.
              </p>
              <GameOptions
                target={target}
                setTarget={setTarget}
                busy={busy || loading}
                onStart={(nextMode) => {
                  void begin(nextMode);
                }}
              />
            </div>
          ) : (
            <>
              <div className="scores">
                {([1, 2] as const).map((player) => (
                  <section
                    className={`score-row player-${player}`}
                    key={player}
                    aria-label={`${playerNames[player - 1]}: ${game.scores[player - 1]} points`}
                  >
                    <div className="score-heading">
                      <PlayerMark player={player} />
                      <h2>{playerNames[player - 1]}</h2>
                      <strong>{game.scores[player - 1]}</strong>
                    </div>
                    <div
                      className="score-progress"
                      role="progressbar"
                      aria-label={`${playerNames[player - 1]} progress to target`}
                      aria-valuemin={0}
                      aria-valuemax={game.target}
                      aria-valuenow={Math.min(
                        game.target,
                        game.scores[player - 1]!,
                      )}
                    >
                      <span
                        style={{
                          width: `${Math.min(100, (game.scores[player - 1]! / game.target) * 100)}%`,
                        }}
                      />
                    </div>
                  </section>
                ))}
              </div>
              <p className="target-label">First to {game.target}</p>
              {game.winner !== null && (
                <div className="result-actions">
                  <p>
                    {game.winner === 0
                      ? "Neither side found an edge. Try a fresh board."
                      : `${formatSquareCount(game.completed.filter((square) => square.owner === game.winner).length)}. One well-earned victory.`}
                  </p>
                  {!watching && (
                    <button
                      className="primary-button"
                      onClick={() => setNewOpen(true)}
                    >
                      Play again<span aria-hidden="true">↗</span>
                    </button>
                  )}
                </div>
              )}
              <div className="last-move">
                <h3>Last move</h3>
                {latest ? (
                  <>
                    <p>
                      {playerNames[latest.player - 1]} ·{" "}
                      {coordinate(latest.index)}
                    </p>
                    <p
                      className={latest.points ? "scoring-copy" : "quiet-copy"}
                    >
                      {latest.squares
                        ? `${latest.squares === 1 ? "One square" : `${latest.squares} squares`}. +${latest.points} points.`
                        : "A new possibility."}
                    </p>
                  </>
                ) : (
                  <p>
                    {watching ? "The first point" : "Your first point"}
                    <br />
                    can go anywhere.
                  </p>
                )}
              </div>
              {lastScoring && latest?.index !== lastScoring.index && (
                <p className="last-capture">
                  Last capture · {playerNames[lastScoring.player - 1]}, +
                  {lastScoring.points}
                </p>
              )}
              <p className="board-count">
                {formatSquareCount(game.completed.length)} ·{" "}
                {64 - game.revision} open points
              </p>
            </>
          )}
          {error && (
            <div className="error-message" role="alert">
              <p>{error}</p>
              <button
                onClick={() => {
                  void reload();
                }}
              >
                Reconnect
              </button>
            </div>
          )}
        </aside>
      </div>
      <footer className="footer">
        <span>
          {game
            ? mode === "duel"
              ? "Pass & play"
              : "Against Euclid"
            : "Squares, seen differently."}
        </span>
        <p>8 × 8 · Grid Footprint</p>
        <span className="keyboard-note">
          {watching
            ? "Arrows to explore · Read-only board"
            : "Arrows to explore · Enter to claim"}
        </span>
      </footer>

      <Modal
        open={rulesOpen}
        onClose={() => setRulesOpen(false)}
        title="Four corners. Any angle."
      >
        <p className="dialog-intro">
          Take turns claiming an empty point. Own all four corners of a square
          and its points are yours.
        </p>
        <RulesDiagram />
        <ol className="rules-list">
          <li>
            <strong>Look beyond straight lines.</strong> Tilted squares count
            too. Other points inside a square do not matter.
          </li>
          <li>
            <strong>Count the grid footprint.</strong> The smallest upright box
            enclosing the square determines its score: width in grid spots,
            squared. A 3 × 3 footprint earns 9.
          </li>
          <li>
            <strong>One move can finish several squares.</strong> They all
            score, once each. Reach the target to win immediately. If the board
            fills first, the higher score wins; equal scores draw.
          </li>
        </ol>
        <p className="small-print">
          Coral uses diamonds. Mint uses rings. A thin halo marks the last move.
          Tilt and Flat change only your view, never the rules.
        </p>
        <button className="primary-button" onClick={() => setRulesOpen(false)}>
          I see it<span aria-hidden="true">↗</span>
        </button>
      </Modal>
      {!watching && (
        <Modal
          open={newOpen}
          onClose={() => setNewOpen(false)}
          title={
            game?.winner === null
              ? "A fresh perspective?"
              : "Make your next move."
          }
        >
          <p className="dialog-intro">
            {game?.winner === null
              ? "Starting a new game replaces this unfinished board."
              : "Play against Euclid or share the board with someone beside you."}
          </p>
          <GameOptions
            target={target}
            setTarget={setTarget}
            busy={busy}
            onStart={(nextMode) => {
              void begin(nextMode);
            }}
          />
          {error && (
            <p className="error-message" role="alert">
              {error}
            </p>
          )}
        </Modal>
      )}
    </main>
  );
}
