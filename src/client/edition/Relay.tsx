import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  PUZZLES,
  SIZE,
  SQUARE_BY_ID,
  type RelayState,
} from "../../shared/edition-game";
import { coordinate } from "../../shared/edition-geometry";
import { useEdition } from "./use-edition";

const points = Array.from({ length: SIZE * SIZE }, (_, point) => point);
const location = (point: number) => ({
  x: 50 + (point % SIZE) * 100,
  y: 50 + Math.floor(point / SIZE) * 100,
});
const progressKey = "euclid-relay-completed-v1";

function readProgress(): number[] {
  try {
    const saved: unknown = JSON.parse(
      localStorage.getItem(progressKey) ?? "[]",
    );
    return Array.isArray(saved)
      ? [
          ...new Set(
            saved.filter(
              (level): level is number =>
                typeof level === "number" &&
                Number.isInteger(level) &&
                level >= 0 &&
                level < PUZZLES.length,
            ),
          ),
        ]
      : [];
  } catch {
    return [];
  }
}

function Modal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
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
      className="relay-dialog"
      ref={ref}
      aria-labelledby="dialog-title"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <div className="dialog-header">
        <h2 id="dialog-title">{title}</h2>
        <button onClick={onClose}>Close</button>
      </div>
      {children}
    </dialog>
  );
}

function Rules({ onClose }: { onClose: () => void }) {
  return (
    <Modal title="Pass the possibility forward." onClose={onClose}>
      <p>
        Relay is a collection of eight quiet puzzles. There is no opponent and
        no clock. Every point belongs to you.
      </p>
      <ol>
        <li>
          <strong>Read the goal.</strong> Complete the required number of new
          squares with a single move. Completing them on separate moves does not
          add up to the goal.
        </li>
        <li>
          <strong>Look at every angle.</strong> Squares can be small, large,
          straight or tilted. Only the four corners matter. Other points inside
          do not interfere.
        </li>
        <li>
          <strong>Build the setup.</strong> Later puzzles allow extra
          placements. Keep a shared corner empty until it can complete enough
          squares at once.
        </li>
        <li>
          <strong>Place deliberately.</strong> Select an empty point, then
          choose Place point. Keyboard: arrows explore the board; Enter or Space
          places the focused empty point.
        </li>
        <li>
          <strong>Explore freely.</strong> Hints cost no placements. Undo works
          even after a win or when moves run out. If no solution remains, a hint
          says to undo. Restart restores the original puzzle.
        </li>
      </ol>
      <p className="muted">
        Solved markers are saved on this browser. They are not a ranking, and
        hints never reduce your result. Your active puzzle is kept by the
        server.
      </p>
      <button className="primary" onClick={onClose}>
        Find the connection
      </button>
    </Modal>
  );
}

function PuzzleBoard({
  game,
  selected,
  busy,
  onSelect,
  onPlace,
}: {
  game: RelayState | null;
  selected: number | null;
  busy: boolean;
  onSelect: (point: number) => void;
  onPlace: (point: number) => void;
}) {
  const [cursor, setCursor] = useState(0);
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const acceptAfter = useRef(0);
  useLayoutEffect(() => {
    acceptAfter.current = performance.now();
  }, [game?.revision, busy]);
  const playable = !!game && game.winner === null && !busy;
  const last = game?.placements.at(-1);
  const hint = game?.hint?.point;
  return (
    <div
      className="puzzle-board"
      role="group"
      aria-label="Six by six puzzle board"
    >
      <svg viewBox="0 0 600 600" className="board-art" aria-hidden="true">
        <g className="board-grid">
          {Array.from({ length: SIZE }, (_, index) => (
            <g key={index}>
              <line
                x1={50 + index * 100}
                y1="50"
                x2={50 + index * 100}
                y2="550"
              />
              <line
                x1="50"
                y1={50 + index * 100}
                x2="550"
                y2={50 + index * 100}
              />
            </g>
          ))}
        </g>
        {game?.completed.map((id) => {
          const square = SQUARE_BY_ID.get(id);
          return square ? (
            <polygon
              key={id}
              className={`square ${game.lastSquares.includes(id) ? "latest-square" : ""}`}
              points={square.corners
                .map((point) => {
                  const p = location(point);
                  return `${p.x},${p.y}`;
                })
                .join(" ")}
            />
          ) : null;
        })}
        {last !== undefined && game && game.lastSquares.length > 0 && (
          <g className="connection-rays">
            {Array.from({ length: 24 }, (_, index) => {
              const angle = (index * Math.PI) / 12;
              const center = location(last);
              return (
                <line
                  key={index}
                  x1={center.x + Math.cos(angle) * 16}
                  y1={center.y + Math.sin(angle) * 16}
                  x2={center.x + Math.cos(angle) * 46}
                  y2={center.y + Math.sin(angle) * 46}
                />
              );
            })}
          </g>
        )}
      </svg>
      {points.map((point) => {
        const occupied = game?.cells[point] === 1;
        const placed = game?.placements.includes(point);
        const p = location(point);
        return (
          <button
            className={`board-point ${occupied ? "occupied" : "empty"} ${placed ? "placed" : ""} ${selected === point ? "selected-point" : ""} ${hint === point ? "hint-point" : ""} ${last === point ? "last-point" : ""}`}
            key={point}
            ref={(element) => {
              refs.current[point] = element;
            }}
            style={{ left: `${p.x / 6}%`, top: `${p.y / 6}%` }}
            tabIndex={cursor === point ? 0 : -1}
            aria-label={`${coordinate(point)}, ${occupied ? (placed ? "your placed point" : "starting point") : "empty"}${selected === point ? ", selected" : ""}${hint === point ? ", suggested point" : ""}`}
            aria-disabled={!playable || occupied}
            aria-pressed={selected === point}
            onFocus={() => setCursor(point)}
            onClick={(event) => {
              if (
                playable &&
                !occupied &&
                event.timeStamp >= acceptAfter.current
              )
                onSelect(point);
            }}
            onKeyDown={(event) => {
              const delta =
                event.key === "ArrowUp"
                  ? -SIZE
                  : event.key === "ArrowDown"
                    ? SIZE
                    : event.key === "ArrowLeft"
                      ? -1
                      : event.key === "ArrowRight"
                        ? 1
                        : null;
              if (delta !== null) {
                event.preventDefault();
                const next = point + delta;
                if (
                  next < 0 ||
                  next >= SIZE * SIZE ||
                  (Math.abs(delta) === 1 &&
                    Math.floor(next / SIZE) !== Math.floor(point / SIZE))
                )
                  return;
                setCursor(next);
                refs.current[next]?.focus();
                if (playable && game?.cells[next] === 0) onSelect(next);
              } else if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                if (
                  !event.repeat &&
                  event.timeStamp >= acceptAfter.current &&
                  playable &&
                  !occupied
                )
                  onPlace(point);
              }
            }}
          >
            <span className="point-core" />
            <span className="coordinate-label" aria-hidden="true">
              {coordinate(point)}
            </span>
          </button>
        );
      })}
    </div>
  );
}

export function Relay() {
  const { game, loading, busy, error, start, move, reload } =
    useEdition<RelayState>();
  const [selected, setSelected] = useState<number | null>(null);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [pendingLevel, setPendingLevel] = useState<number | null>(null);
  const [completed, setCompleted] = useState(readProgress);
  const booted = useRef(false);
  const level = game?.level ?? 0;
  const puzzle = PUZZLES[level] ?? PUZZLES[0]!;
  const remaining = puzzle.moves - (game?.placements.length ?? 0);
  const active = game?.winner === null;
  useEffect(() => {
    if (!loading && !error && !game && !booted.current) {
      booted.current = true;
      void start({ level: 0 }, "puzzle");
    }
  }, [error, game, loading, start]);
  useEffect(() => {
    if (game?.winner !== 1) return;
    setCompleted((previous) => {
      if (previous.includes(game.level)) return previous;
      const next = [...previous, game.level].sort((a, b) => a - b);
      try {
        localStorage.setItem(progressKey, JSON.stringify(next));
      } catch {
        /* Progress remains visible when browser storage is unavailable. */
      }
      return next;
    });
  }, [game]);
  useEffect(() => {
    setSelected(null);
  }, [game?.revision, game?.level]);

  async function begin(next: number) {
    setSelected(null);
    if (await start({ level: next }, "puzzle")) setPendingLevel(null);
  }
  function chooseLevel(next: number) {
    if (busy || loading) return;
    if (active && game.placements.length > 0) setPendingLevel(next);
    else void begin(next);
  }
  function place(point: number) {
    if (!active || busy || loading || game.cells[point] !== 0) return;
    setSelected(null);
    void move({ point });
  }

  const footer =
    game?.winner === 1
      ? "Connection found. Carry it forward."
      : game?.winner === 0
        ? "Another route is waiting. Undo and explore."
        : game?.hint
          ? game.hint.message
          : selected !== null
            ? `${coordinate(selected)} selected. Place it when you’re ready.`
            : "Find the shared corner.";

  return (
    <main className="relay-app">
      <header className="relay-header">
        <div className="brand-lockup">
          <div className="relay-wordmark">Relay</div>
          <span>A Euclid game</span>
        </div>
        <nav aria-label="Puzzle controls">
          <button onClick={() => setRulesOpen(true)}>How to play</button>
          <button disabled={busy || loading} onClick={() => chooseLevel(level)}>
            Restart puzzle
          </button>
        </nav>
      </header>
      <div className="relay-layout">
        <section className="board-region" aria-label="Puzzle">
          <PuzzleBoard
            game={game}
            selected={selected}
            busy={busy || loading}
            onSelect={setSelected}
            onPlace={place}
          />
          <p className="board-instruction">
            Select a point, then place it. Enter also places.
          </p>
        </section>
        <aside className="puzzle-rail">
          <h1>One point. Many squares.</h1>
          <section className="puzzle-story">
            <p className="puzzle-number">
              {String(level + 1).padStart(2, "0")} / 08
            </p>
            <h2>{puzzle.name}</h2>
            <p>
              Complete{" "}
              {puzzle.goal === 2 ? "two" : puzzle.goal === 3 ? "three" : "four"}{" "}
              squares with a single final move.
            </p>
          </section>
          <div className="puzzle-metrics">
            <div>
              <span>Moves left</span>
              <strong>{remaining}</strong>
            </div>
            <div>
              <span>Squares needed</span>
              <strong>{puzzle.goal}</strong>
            </div>
          </div>
          <div className="puzzle-actions">
            {!game ? (
              <button
                className="primary"
                disabled={busy || loading}
                onClick={() => {
                  void begin(level);
                }}
              >
                {busy || loading ? "Setting the board…" : "Start puzzle"}
              </button>
            ) : game.winner === 1 ? (
              <button
                className="primary"
                disabled={busy}
                onClick={() => chooseLevel((level + 1) % PUZZLES.length)}
              >
                {level === PUZZLES.length - 1
                  ? "Back to the collection"
                  : "Next puzzle"}
              </button>
            ) : game?.winner === 0 ? (
              <button
                className="primary"
                disabled={busy}
                onClick={() => {
                  void move({ type: "undo" });
                }}
              >
                Undo & try again
              </button>
            ) : (
              <button
                className="primary"
                disabled={busy || loading || selected === null || !game}
                onClick={() => {
                  if (selected !== null) place(selected);
                }}
              >
                {busy || loading ? "Setting the board…" : "Place point"}
              </button>
            )}
            <div className="secondary-actions">
              <button
                disabled={busy || loading || !active}
                onClick={() => {
                  void move({ type: "hint" });
                }}
              >
                Hint
              </button>
              <button
                disabled={busy || loading || !game?.placements.length}
                onClick={() => {
                  void move({ type: "undo" });
                }}
              >
                Undo
              </button>
            </div>
            <div
              className={`move-feedback ${game?.winner === 1 ? "success" : ""}`}
              role="status"
              aria-live="polite"
              aria-atomic="true"
            >
              {game?.winner === 1
                ? `${game.lastSquares.length} squares. One beautiful finish.`
                : game?.winner === 0
                  ? `That move made ${game.lastSquares.length} new ${game.lastSquares.length === 1 ? "square" : "squares"}. The goal is ${puzzle.goal} at once.`
                  : game?.lastSquares.length
                    ? `${game.lastSquares.length} new ${game.lastSquares.length === 1 ? "square" : "squares"}. Keep building toward ${puzzle.goal} at once.`
                    : `${remaining} ${remaining === 1 ? "move" : "moves"} to find the connection.`}
            </div>
            {error && (
              <div className="error-message" role="alert">
                <p>{error}</p>
                <button
                  disabled={busy}
                  onClick={() => {
                    void reload();
                  }}
                >
                  Reconnect
                </button>
              </div>
            )}
          </div>
        </aside>
      </div>
      <nav className="level-chooser" aria-label="Puzzle collection">
        {PUZZLES.map((item, index) => (
          <button
            key={item.name}
            className={index === level ? "current-level" : ""}
            disabled={busy || loading}
            aria-current={index === level ? "step" : undefined}
            aria-label={`Puzzle ${index + 1}: ${item.name}${completed.includes(index) ? ", solved" : ""}`}
            onClick={() => chooseLevel(index)}
          >
            <span>{String(index + 1).padStart(2, "0")}</span>
            {completed.includes(index) && (
              <span className="solved-mark" aria-hidden="true">
                ✓
              </span>
            )}
          </button>
        ))}
      </nav>
      <footer className="relay-footer">
        <p role="status" aria-live="polite">
          {footer}
        </p>
        <span>
          {completed.length} of 8 solved · No clock. No penalty for exploring.
        </span>
      </footer>
      {rulesOpen && <Rules onClose={() => setRulesOpen(false)} />}
      {pendingLevel !== null && (
        <Modal
          title={
            pendingLevel === level
              ? "A fresh starting point?"
              : "Try another connection?"
          }
          onClose={() => {
            if (!busy) setPendingLevel(null);
          }}
        >
          <p>
            {pendingLevel === level
              ? "Restarting restores the original points and your full move budget."
              : "Switching puzzles replaces your current unfinished attempt. Your solved markers stay saved."}
          </p>
          {error && (
            <p className="error-message" role="alert">
              {error}
            </p>
          )}
          <div className="dialog-actions">
            <button disabled={busy} onClick={() => setPendingLevel(null)}>
              Keep exploring
            </button>
            <button
              className="primary"
              disabled={busy}
              onClick={() => {
                void begin(pendingLevel);
              }}
            >
              {busy
                ? "Preparing…"
                : pendingLevel === level
                  ? "Restart puzzle"
                  : "Switch puzzle"}
            </button>
          </div>
        </Modal>
      )}
    </main>
  );
}
