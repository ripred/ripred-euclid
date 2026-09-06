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
  relayPuzzle,
  type RelayState,
} from "../../shared/edition-game";
import {
  RELAY_GENERATOR_LIMITS,
  type RelayGeneratorOptions,
  type RelayDifficulty,
} from "../../shared/relay-generator";
import { coordinate } from "../../shared/edition-geometry";
import { useEdition } from "./use-edition";
import { selectedRelayPoint, type RelaySelection } from "./relay-selection";

const points = Array.from({ length: SIZE * SIZE }, (_, point) => point);
const location = (point: number) => ({
  x: 50 + (point % SIZE) * 100,
  y: 50 + Math.floor(point / SIZE) * 100,
});
const progressKey = "euclid-relay-completed-v1";
type GeneratorSettings = Omit<RelayGeneratorOptions, "seed"> & {
  seed?: string | undefined;
};
type PuzzleChoice = { level: number } | { generator: GeneratorSettings };
const defaultGenerator: GeneratorSettings = {
  moves: 2,
  goal: 2,
  difficulty: "standard",
};
const moveCounts = Array.from(
  {
    length:
      RELAY_GENERATOR_LIMITS.maxMoves - RELAY_GENERATOR_LIMITS.minMoves + 1,
  },
  (_, index) => index + RELAY_GENERATOR_LIMITS.minMoves,
);
const squareCounts = Array.from(
  {
    length: RELAY_GENERATOR_LIMITS.maxGoal - RELAY_GENERATOR_LIMITS.minGoal + 1,
  },
  (_, index) => index + RELAY_GENERATOR_LIMITS.minGoal,
);

function GeneratorDialog({
  initial,
  busy,
  error,
  replacing,
  onGenerate,
  onClose,
}: {
  initial: GeneratorSettings;
  busy: boolean;
  error: string | null;
  replacing: boolean;
  onGenerate: (settings: GeneratorSettings) => void;
  onClose: () => void;
}) {
  const [settings, setSettings] = useState<GeneratorSettings>({
    ...initial,
    seed: "",
  });
  return (
    <Modal title="A new connection" onClose={onClose}>
      <p>
        Choose your challenge. Each board is checked for a solution that needs
        the requested number of moves.
      </p>
      <form
        className="generator-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (!busy)
            onGenerate({
              ...settings,
              seed: settings.seed?.trim() || undefined,
            });
        }}
      >
        <fieldset disabled={busy}>
          <label>
            Moves
            <select
              value={settings.moves}
              onChange={(event) =>
                setSettings({ ...settings, moves: Number(event.target.value) })
              }
            >
              {moveCounts.map((number) => (
                <option key={number} value={number}>
                  {number}
                </option>
              ))}
            </select>
          </label>
          <label>
            Squares required
            <select
              value={settings.goal}
              onChange={(event) =>
                setSettings({ ...settings, goal: Number(event.target.value) })
              }
            >
              {squareCounts.map((number) => (
                <option key={number} value={number}>
                  {number}
                </option>
              ))}
            </select>
          </label>
          <label>
            Difficulty
            <select
              value={settings.difficulty}
              onChange={(event) =>
                setSettings({
                  ...settings,
                  difficulty: event.target.value as RelayDifficulty,
                })
              }
            >
              <option value="beginner">Beginner</option>
              <option value="standard">Standard</option>
              <option value="expert">Expert</option>
            </select>
          </label>
          <label className="generator-seed">
            Seed (optional)
            <input
              maxLength={RELAY_GENERATOR_LIMITS.maxSeedLength}
              value={settings.seed}
              onChange={(event) =>
                setSettings({ ...settings, seed: event.target.value })
              }
              placeholder="Leave blank for a new board"
            />
          </label>
        </fieldset>
        <p className="muted">
          Difficulty changes the square patterns, not the rules. The same
          settings and seed recreate the same board. Some combinations may not
          fit this 6×6 board.
        </p>
        {replacing && (
          <p>
            This replaces your unfinished attempt. Your introductory puzzle
            progress stays saved.
          </p>
        )}
        {error && (
          <p role="alert" className="error-message">
            {error}
          </p>
        )}
        <button className="primary" type="submit" disabled={busy}>
          {busy ? "Generating…" : "Generate puzzle"}
        </button>
      </form>
    </Modal>
  );
}

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
        Relay has eight introductory puzzles and a generator for more. There is
        no opponent and no clock. Every point belongs to you.
      </p>
      <ol>
        <li>
          <strong>Read the goal.</strong> Complete the required number of new
          squares within the move budget. Every completed square counts, whether
          you finish them together or on separate moves.
        </li>
        <li>
          <strong>Look at every angle.</strong> Squares can be small, large,
          straight or tilted. Only the four corners matter. Other points inside
          do not interfere.
        </li>
        <li>
          <strong>Build the setup.</strong> Later puzzles allow extra
          placements. Some points prepare squares for a later move; others
          complete one or more squares immediately. Either order counts.
        </li>
        <li>
          <strong>Place deliberately.</strong> Select an empty point, then
          choose Place point. Keyboard: arrows explore the board; Enter or Space
          places the focused empty point.
        </li>
        <li>
          <strong>Explore freely.</strong> Hints cost no placements. A hint
          selects a suggested point and outlines the squares its route can
          complete. Confirm with Place point, or select a different point. Undo
          works even after a win or when moves run out. If no solution remains,
          a hint says to undo. Restart restores the original puzzle.
        </li>
      </ol>
      <p className="muted">
        Open Introductory puzzles to revisit the first eight challenges. Their
        solved markers are saved on this browser, not a ranking. Generated
        puzzles continue beyond that collection. Hints never reduce your result.
        Your active puzzle is kept by the server.
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
  readOnly,
  onSelect,
  onPlace,
}: {
  game: RelayState | null;
  selected: number | null;
  busy: boolean;
  readOnly: boolean;
  onSelect: (point: number) => void;
  onPlace: (point: number) => void;
}) {
  const [cursor, setCursor] = useState(0);
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const acceptAfter = useRef(0);
  useLayoutEffect(() => {
    acceptAfter.current = performance.now();
  }, [game?.revision, busy]);
  const playable = !!game && game.winner === null && !busy && !readOnly;
  const last = game?.placements.at(-1);
  const hint =
    !readOnly && selected === game?.hint?.point ? game?.hint?.point : null;
  const hintSquares =
    !readOnly && selected === hint ? (game?.hint?.squares ?? []) : [];
  return (
    <div
      className="puzzle-board"
      role="group"
      aria-label={
        readOnly
          ? "Six by six puzzle board. Arrow keys inspect points. Read-only."
          : "Six by six puzzle board"
      }
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
        {hintSquares.map((id) => {
          const square = SQUARE_BY_ID.get(id);
          return square ? (
            <polygon
              key={`hint-${id}`}
              className="hint-square"
              points={square.corners
                .map((point) => {
                  const p = location(point);
                  return `${p.x},${p.y}`;
                })
                .join(" ")}
            />
          ) : null;
        })}
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
            aria-label={`${coordinate(point)}, ${occupied ? (placed ? (readOnly ? "placed point" : "your placed point") : "starting point") : "empty"}${selected === point ? ", selected" : ""}${hint === point ? ", suggested point" : ""}`}
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
  const {
    gameId,
    game,
    loading,
    busy,
    error,
    start,
    move,
    reload,
    watching,
    hostName,
  } = useEdition<RelayState>();
  const [selection, setSelection] = useState<RelaySelection | null>(null);
  const [pendingAction, setPendingAction] = useState<
    "start" | "place" | "hint" | "undo" | null
  >(null);
  const feedbackRef = useRef<HTMLDivElement>(null);
  const selected = watching
    ? null
    : selectedRelayPoint(game, gameId, selection);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [pendingPuzzle, setPendingPuzzle] = useState<PuzzleChoice | null>(null);
  const [generatorOpen, setGeneratorOpen] = useState(false);
  const [completed, setCompleted] = useState(readProgress);
  const booted = useRef(false);
  const level = game?.level ?? 0;
  const puzzle = game ? relayPuzzle(game) : PUZZLES[0]!;
  const generated = game?.generatedPuzzle?.generator;
  const showIntroProgress =
    !generated && !(level === PUZZLES.length - 1 && game?.winner === 1);
  const restartChoice: PuzzleChoice = generated
    ? { generator: generated }
    : { level };
  const remaining = puzzle.moves - (game?.placements.length ?? 0);
  const squaresLeft = Math.max(0, puzzle.goal - (game?.completed.length ?? 0));
  const active = game?.winner === null;
  const visibleHint =
    !watching &&
    game?.hint &&
    (game.hint.point === null || selected === game.hint.point)
      ? game.hint
      : null;
  const showingHint = visibleHint !== null;
  useEffect(() => {
    if (!watching && !loading && !error && !game && !booted.current) {
      booted.current = true;
      void start({ level: 0 }, "puzzle");
    }
  }, [error, game, loading, start, watching]);
  useEffect(() => {
    // Watching another player's success never completes a personal puzzle.
    if (watching || game?.winner !== 1 || game.generatedPuzzle) return;
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
  }, [game, watching]);
  useEffect(() => {
    // Keep guidance visible even when the controls are below the fold.
    if (!watching && (game?.hint?.message || game?.canFinish === false))
      feedbackRef.current?.scrollIntoView({ block: "nearest" });
  }, [gameId, game?.revision, game?.hint?.message, game?.canFinish, watching]);

  async function begin(next: PuzzleChoice) {
    if (watching || busy || loading) return;
    setPendingAction("start");
    try {
      if (await start(next, "puzzle")) {
        setSelection(null);
        setPendingPuzzle(null);
        setGeneratorOpen(false);
      }
    } finally {
      setPendingAction(null);
    }
  }
  async function act(action: { point: number } | { type: "hint" | "undo" }) {
    if (watching || busy || loading) return;
    setPendingAction("point" in action ? "place" : action.type);
    try {
      await move(action);
    } finally {
      setPendingAction(null);
    }
  }
  function select(point: number) {
    if (!watching && game && gameId)
      setSelection({ gameId, revision: game.revision, point });
  }
  function choosePuzzle(next: PuzzleChoice) {
    if (watching || busy || loading) return;
    if (active && game.placements.length > 0) setPendingPuzzle(next);
    else void begin(next);
  }
  function place(point: number) {
    if (watching || !active || busy || loading || game.cells[point] !== 0)
      return;
    void act({ point });
  }

  const footer =
    game?.winner === 1
      ? "Connection found. Carry it forward."
      : game?.winner === 0
        ? watching
          ? "The attempt ended. The board remains available to inspect."
          : "Another route is waiting. Undo and explore."
        : watching
          ? "Every square counts."
          : "Every square counts. Find your route.";

  const feedback =
    game?.winner === 1
      ? `${game.completed.length} ${game.completed.length === 1 ? "square" : "squares"} completed in ${game.placements.length} ${game.placements.length === 1 ? "move" : "moves"}. Puzzle solved.`
      : game?.winner === 0
        ? `${game.completed.length} of ${puzzle.goal} squares completed. No moves left.${watching ? "" : " Undo to try another route."}`
        : visibleHint
          ? visibleHint.message
          : game?.canFinish === false
            ? watching
              ? "The remaining moves cannot complete enough squares."
              : "The remaining moves cannot complete enough squares. Undo your last point to try another route."
            : game?.lastSquares.length
              ? `${game.lastSquares.length} new ${game.lastSquares.length === 1 ? "square" : "squares"}. ${squaresLeft} more to complete.`
              : `${squaresLeft} ${squaresLeft === 1 ? "square" : "squares"} to complete in ${remaining} ${remaining === 1 ? "move" : "moves"}.`;

  if (watching && !game)
    return (
      <main className="relay-app">
        <p>Waiting for the broadcast…</p>
      </main>
    );

  return (
    <main className="relay-app">
      <header className="relay-header">
        <div className="brand-lockup">
          <div className="relay-wordmark">Relay</div>
          <span>A Euclid game</span>
        </div>
        <nav aria-label="Puzzle controls">
          <button onClick={() => setRulesOpen(true)}>How to play</button>
          <button
            disabled={watching || busy || loading}
            onClick={() => choosePuzzle(restartChoice)}
          >
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
            readOnly={watching}
            onSelect={select}
            onPlace={place}
          />
          <p className="board-instruction">
            {watching
              ? "Read-only board · Arrow keys inspect points."
              : "Select a point, then place it. Enter also places."}
          </p>
        </section>
        <aside className="puzzle-rail">
          <h1>Few points. Many squares.</h1>
          <section className="puzzle-story">
            <p className="puzzle-number">
              {generated
                ? `Generated · ${generated.difficulty}`
                : `${String(level + 1).padStart(2, "0")} / 08`}
            </p>
            <h2>{puzzle.name}</h2>
            <p className="puzzle-goal">
              Complete {puzzle.goal} {puzzle.goal === 1 ? "square" : "squares"}{" "}
              in {puzzle.moves} {puzzle.moves === 1 ? "move" : "moves"} or
              fewer.
            </p>
            <p className="puzzle-description">{puzzle.description}</p>
            {generated && (
              <p className="puzzle-seed">
                Seed: <code>{generated.seed}</code>
              </p>
            )}
          </section>
          <div className="puzzle-metrics">
            <div>
              <span>Moves left</span>
              <strong>{remaining}</strong>
            </div>
            <div>
              <span>Squares left</span>
              <strong>{squaresLeft}</strong>
            </div>
          </div>
          <div className="puzzle-actions">
            <div
              ref={feedbackRef}
              className={`move-feedback ${showingHint ? "hint-guidance" : ""} ${game?.winner === 1 ? "success" : ""}`}
              role="status"
              aria-live="polite"
              aria-atomic="true"
            >
              <p>
                {watching ? `${hostName ?? "Redditor"}: ${feedback}` : feedback}
              </p>
              {active && selected !== null && (
                <p className="selection-feedback">
                  <strong>{coordinate(selected)} selected.</strong> Choose Place
                  point to confirm.
                </p>
              )}
              {showingHint && !!game?.hint?.squares?.length && (
                <p className="hint-legend">
                  Dashed outlines show the squares along this route, not
                  completed squares.
                </p>
              )}
            </div>
            {!watching && (
              <>
                {!game ? (
                  <button
                    className="primary"
                    disabled={busy || loading}
                    onClick={() => {
                      void begin(restartChoice);
                    }}
                  >
                    {busy || loading ? "Setting the board…" : "Start puzzle"}
                  </button>
                ) : game.winner === 1 ? (
                  <button
                    className="primary"
                    disabled={busy}
                    onClick={() =>
                      choosePuzzle(
                        generated || level === PUZZLES.length - 1
                          ? {
                              generator: generated
                                ? { ...generated, seed: undefined }
                                : defaultGenerator,
                            }
                          : { level: level + 1 },
                      )
                    }
                  >
                    {generated || level === PUZZLES.length - 1
                      ? "Next generated puzzle"
                      : "Next puzzle"}
                  </button>
                ) : game?.winner === 0 ? (
                  <button
                    className="primary"
                    disabled={busy}
                    onClick={() => {
                      void act({ type: "undo" });
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
                    {pendingAction === "place"
                      ? "Placing point…"
                      : "Place point"}
                  </button>
                )}
                <div className="secondary-actions">
                  <button
                    disabled={busy || loading || !active}
                    aria-busy={pendingAction === "hint"}
                    onClick={() => {
                      void act({ type: "hint" });
                    }}
                  >
                    {pendingAction === "hint" ? "Finding hint…" : "Hint"}
                  </button>
                  <button
                    disabled={busy || loading || !game?.placements.length}
                    aria-busy={pendingAction === "undo"}
                    onClick={() => {
                      void act({ type: "undo" });
                    }}
                  >
                    {pendingAction === "undo" ? "Undoing…" : "Undo"}
                  </button>
                </div>
              </>
            )}
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
      {!watching && (
        <div className="puzzle-navigation">
          {/* Reset the disclosure only when crossing the introductory boundary. */}
          <details
            className="intro-collection"
            key={showIntroProgress ? "intro" : "beyond-intro"}
            open={showIntroProgress}
          >
            <summary>Introductory puzzles</summary>
            <nav className="level-chooser" aria-label="Introductory puzzles">
              {PUZZLES.map((item, index) => (
                <button
                  key={item.name}
                  className={
                    !generated && index === level ? "current-level" : ""
                  }
                  disabled={busy || loading}
                  aria-current={
                    !generated && index === level ? "step" : undefined
                  }
                  aria-label={`Puzzle ${index + 1}: ${item.name}${completed.includes(index) ? ", solved" : ""}`}
                  onClick={() => choosePuzzle({ level: index })}
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
            <p className="intro-progress">
              {completed.length} of {PUZZLES.length} introductory puzzles solved
              on this browser.
            </p>
          </details>
          <button
            className="new-puzzle"
            disabled={busy || loading}
            onClick={() => setGeneratorOpen(true)}
          >
            New puzzle
          </button>
        </div>
      )}
      <footer className="relay-footer">
        <p role="status" aria-live="polite">
          {footer}
        </p>
      </footer>
      {rulesOpen && <Rules onClose={() => setRulesOpen(false)} />}
      {!watching && generatorOpen && (
        <GeneratorDialog
          initial={generated ?? defaultGenerator}
          busy={busy}
          error={error}
          replacing={!!active && !!game?.placements.length}
          onGenerate={(settings) => {
            void begin({ generator: settings });
          }}
          onClose={() => {
            if (!busy) setGeneratorOpen(false);
          }}
        />
      )}
      {!watching && pendingPuzzle !== null && (
        <Modal
          title="A fresh starting point?"
          onClose={() => {
            if (!busy) setPendingPuzzle(null);
          }}
        >
          <p>
            Starting or restarting a puzzle replaces your unfinished attempt.
            Your introductory puzzle progress stays saved.
          </p>
          {error && (
            <p className="error-message" role="alert">
              {error}
            </p>
          )}
          <div className="dialog-actions">
            <button disabled={busy} onClick={() => setPendingPuzzle(null)}>
              Keep exploring
            </button>
            <button
              className="primary"
              disabled={busy}
              onClick={() => {
                void begin(pendingPuzzle);
              }}
            >
              {busy ? "Preparing…" : "Start puzzle"}
            </button>
          </div>
        </Modal>
      )}
    </main>
  );
}
