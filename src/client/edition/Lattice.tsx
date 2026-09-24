import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import {
  createLattice,
  cubeProgress,
  pointAt,
  pointIndex,
  type LatticeState,
} from "../../shared/edition-game";
import type { PlayMode } from "../../shared/edition-contract";
import { useEdition } from "./use-edition";
import type { SceneModel } from "./lattice-scene";
import { CubeMark } from "./CubeMark";
import { LatticeBoard } from "./LatticeBoard";
import "./style.css";

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
      className="lattice-dialog"
      ref={ref}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      aria-labelledby="dialog-title"
    >
      <div className="dialog-top">
        <h2 id="dialog-title">{title}</h2>
        <button
          className="close-dialog"
          aria-label="Close dialog"
          onClick={onClose}
        >
          ×
        </button>
      </div>
      {children}
    </dialog>
  );
}

function LayerInspector({
  game,
  layer,
  selected,
  onLayer,
  onSelect,
  names,
  readOnly,
}: {
  game: LatticeState;
  layer: number;
  selected: number | null;
  onLayer: (layer: number) => void;
  onSelect: (index: number) => void;
  names: [string, string];
  readOnly: boolean;
}) {
  const grid = useRef<HTMLDivElement>(null);
  const coords = Array.from({ length: game.size }, (_, index) => index);
  const focusCell = (x: number, y: number) =>
    grid.current
      ?.querySelector<HTMLButtonElement>(`[data-coordinate="${x}:${y}"]`)
      ?.focus();
  const moveFocus = (
    event: KeyboardEvent<HTMLButtonElement>,
    x: number,
    y: number,
  ) => {
    const deltas: Record<string, [number, number]> = {
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
      ArrowUp: [0, -1],
      ArrowDown: [0, 1],
    };
    const delta = deltas[event.key];
    if (delta) {
      event.preventDefault();
      focusCell(
        Math.max(0, Math.min(game.size - 1, x + delta[0])),
        Math.max(0, Math.min(game.size - 1, y + delta[1])),
      );
    }
    if (event.key === "PageUp" || event.key === "PageDown") {
      event.preventDefault();
      onLayer(
        Math.max(
          0,
          Math.min(game.size - 1, layer + (event.key === "PageUp" ? 1 : -1)),
        ),
      );
    }
  };
  return (
    <section className="inspector" aria-labelledby="inspector-title">
      <h2 id="inspector-title">Layer inspector</h2>
      <div className="layer-selector">
        <span>Z</span>
        <div className="segment-buttons">
          {coords.map((z) => (
            <button
              key={z}
              aria-label={`Layer Z ${z + 1}`}
              aria-pressed={layer === z}
              className={layer === z ? "active" : ""}
              onClick={() => onLayer(z)}
            >
              {z + 1}
            </button>
          ))}
        </div>
      </div>
      <div
        className="layer-grid"
        ref={grid}
        style={{
          gridTemplateColumns: `22px repeat(${game.size}, minmax(0, 1fr))`,
        }}
        aria-label={`Layer Z ${layer + 1}. X goes across; Y goes down.`}
      >
        <span className="grid-axis">Y ↓</span>
        {coords.map((x) => (
          <span className="coordinate-label" key={`label-${x}`}>
            {x === 0 ? "X " : ""}
            {x + 1}
          </span>
        ))}
        {coords.flatMap((y) => [
          <span className="coordinate-label" key={`row-${y}`}>
            {y + 1}
          </span>,
          ...coords.map((x) => {
            const index = pointIndex({ x, y, z: layer }, game.size);
            const owner = game.board[index]!;
            const isSelected = index === selected;
            return (
              <button
                key={index}
                data-coordinate={`${x}:${y}`}
                className={`point-button owner-${owner}${isSelected ? " selected" : ""}`}
                aria-label={`X ${x + 1}, Y ${y + 1}, Z ${layer + 1}: ${owner === 0 ? "empty" : names[owner - 1]}`}
                aria-pressed={isSelected}
                onKeyDown={(event) => moveFocus(event, x, y)}
                onClick={() => onSelect(index)}
              >
                <span>{owner === 1 ? "●" : owner === 2 ? "◆" : ""}</span>
              </button>
            );
          }),
        ])}
      </div>
      <p className="inspector-help">
        {readOnly
          ? "Select a point here or in 3D to inspect it. This board is read-only."
          : "Select a point here or in 3D. Placement always asks for confirmation."}
      </p>
    </section>
  );
}

export function Lattice() {
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
  } = useEdition<LatticeState>();
  const [size, setSize] = useState<3 | 4>(4);
  const [opening, setOpening] = useState<"foundation" | "empty">("foundation");
  const [computerStyle, setComputerStyle] = useState<"builder" | "tactician">(
    "builder",
  );
  const [layer, setLayer] = useState(1);
  const [selected, setSelected] = useState<number | null>(null);
  const [isolate, setIsolate] = useState(false);
  const [showCubes, setShowCubes] = useState(true);
  const [showTrace, setShowTrace] = useState(false);
  const [dialog, setDialog] = useState<"rules" | "restart" | null>(null);
  const [configuring, setConfiguring] = useState(false);
  const preview = useMemo(
    () => createLattice({ size, opening, computerStyle }),
    [size, opening, computerStyle],
  );
  const display = game && (!configuring || watching) ? game : preview;
  const setup = !watching && (game === null || configuring);
  const humanName = watching ? (hostName ?? "Redditor") : "You";
  const names: [string, string] =
    mode === "duel" && !setup ? ["Teal", "Vermilion"] : [humanName, "Euclid"];
  const personalTurn = !watching && mode !== "duel";
  const effectiveLayer = Math.min(layer, display.size - 1);
  const selection =
    selected !== null && selected < display.board.length ? selected : null;
  const owner = selection === null ? null : display.board[selection]!;
  const selectedPoint =
    selection === null ? null : pointAt(selection, display.size);
  const progress = useMemo(
    () => cubeProgress(display, display.turn),
    [display],
  );
  const bestCube = progress.find((item) => item.owned > 0);
  const trace = showTrace && bestCube ? bestCube.cube.id : null;
  const canPlay =
    !watching &&
    !setup &&
    !loading &&
    !busy &&
    display.winner === null &&
    (mode === "duel" || display.turn === 1);
  const selectPoint = (index: number) => {
    setSelected(index);
    setLayer(pointAt(index, display.size).z);
  };
  const onLayer = (value: number) => {
    setLayer(value);
    if (selectedPoint)
      setSelected(pointIndex({ ...selectedPoint, z: value }, display.size));
  };
  useEffect(() => {
    setSelected(null);
    setShowTrace(false);
  }, [game?.revision, game?.opening, game?.size]);
  const begin = async (nextMode: PlayMode) => {
    if (watching) return;
    setSelected(null);
    if (await start({ size, opening, computerStyle }, nextMode))
      setConfiguring(false);
  };
  const confirm = () => {
    if (!canPlay || selection === null || owner !== 0) return;
    // No keyboard buffer: a fresh confirmation is required for each server-confirmed turn.
    void move(pointAt(selection, display.size));
  };
  const moves = display.history.slice(-5).reverse();
  const last =
    display.history
      .slice(mode === "solo" ? -2 : -1)
      .find((entry) => entry.points > 0) ?? display.history.at(-1);
  const filled = display.board.filter(Boolean).length;
  const status = setup
    ? "Choose how to play"
    : display.winner !== null
      ? display.winner === 0
        ? "A perfect balance."
        : `${names[display.winner - 1]} ${display.winner === 1 && personalTurn ? "win" : "wins"}.`
      : busy
        ? "Confirming move…"
        : `${names[display.turn - 1]}${display.turn === 1 && personalTurn ? "r" : "’s"} move`;
  const model: SceneModel = {
    game: display,
    selected: selection,
    layer: effectiveLayer,
    isolate,
    showCubes,
    trace,
  };

  if (watching && !game)
    return (
      <main className="lattice-app">
        <p>Waiting for the broadcast…</p>
      </main>
    );

  return (
    <div className="lattice-app">
      <header className="site-header">
        <a href="#main" className="wordmark">
          Lattice<span>Euclid</span>
        </a>
        <nav aria-label="Game">
          <button onClick={() => setDialog("rules")}>Rules</button>
          <button
            disabled={watching || busy || loading}
            onClick={() => {
              if (watching) return;
              if (!setup && display.winner === null && display.revision > 0)
                setDialog("restart");
              else setConfiguring(true);
            }}
          >
            New game
          </button>
        </nav>
      </header>
      <main id="main" className="game-layout">
        <section className="playfield" aria-label="Lattice game">
          <div className="game-heading">
            <h1>Think in another dimension.</h1>
            <p>Claim eight corners. Complete a cube.</p>
          </div>
          <div className="score-strip" aria-label="Scores">
            {([1, 2] as const).map((player) => (
              <div
                key={player}
                className={`player-score player-${player}${display.turn === player && display.winner === null ? " current" : ""}`}
              >
                <i className={`legend-dot owner-${player}`} />
                <span>{names[player - 1]}</span>
                <strong>{display.scores[player - 1]}</strong>
              </div>
            ))}
            <span className="score-rule">Most points wins.</span>
          </div>
          <LatticeBoard model={model} onSelect={selectPoint} />
          <div className="view-options">
            <label>
              <input
                type="checkbox"
                checked={isolate}
                onChange={(event) => setIsolate(event.target.checked)}
              />
              Isolate selected layer
            </label>
            <label>
              <input
                type="checkbox"
                checked={showCubes}
                onChange={(event) => setShowCubes(event.target.checked)}
              />
              Completed cubes
            </label>
          </div>
        </section>
        <aside className="inspection-rail">
          <LayerInspector
            game={display}
            layer={effectiveLayer}
            selected={selection}
            onLayer={onLayer}
            onSelect={selectPoint}
            names={names}
            readOnly={watching}
          />
          <section
            className={`turn-panel player-${display.turn}`}
            aria-labelledby="turn-title"
          >
            <h2 id="turn-title" aria-live="polite">
              {loading ? "Connecting…" : status}
            </h2>
            {setup ? (
              <>
                <div className="setup-fields">
                  <label>
                    Size
                    <select
                      value={size}
                      onChange={(event) => {
                        setSize(Number(event.target.value) as 3 | 4);
                        setSelected(null);
                      }}
                    >
                      <option value={3}>3 × 3 × 3 · 27 points</option>
                      <option value={4}>4 × 4 × 4 · 64 points</option>
                    </select>
                  </label>
                  <label>
                    Opening
                    <select
                      value={opening}
                      onChange={(event) => {
                        setOpening(
                          event.target.value as "foundation" | "empty",
                        );
                        setSelected(null);
                      }}
                    >
                      <option value="foundation">Foundation opening</option>
                      <option value="empty">Empty lattice</option>
                    </select>
                  </label>
                </div>
                <label className="computer-style">
                  Computer style
                  <select
                    value={computerStyle}
                    onChange={(event) =>
                      setComputerStyle(
                        event.target.value as "builder" | "tactician",
                      )
                    }
                  >
                    <option value="builder">
                      Builder · learn by constructing
                    </option>
                    <option value="tactician">
                      Tactician · blocking and construction
                    </option>
                  </select>
                </label>
                <p className="setup-description">
                  {opening === "foundation"
                    ? "Four points each, on opposite faces. Build your first cube from there."
                    : "A completely empty board. Every corner is yours to discover."}
                </p>
                <button
                  className="primary-button"
                  disabled={loading || busy}
                  onClick={() => {
                    void begin("solo");
                  }}
                >
                  Play Euclid
                </button>
                <button
                  className="secondary-button"
                  disabled={loading || busy}
                  onClick={() => {
                    void begin("duel");
                  }}
                >
                  Play together <span>on this device</span>
                </button>
                {configuring && game && (
                  <button
                    className="text-button"
                    onClick={() => setConfiguring(false)}
                  >
                    Return to current game
                  </button>
                )}
              </>
            ) : display.winner !== null ? (
              <>
                <p className="result-score">
                  {display.scores[0]} <span>—</span> {display.scores[1]}
                </p>
                <p>
                  The lattice is complete. {display.cubes.length}{" "}
                  {display.cubes.length === 1 ? "cube" : "cubes"} claimed.
                </p>
                {!watching && (
                  <button
                    className="primary-button"
                    onClick={() => setConfiguring(true)}
                  >
                    Build another lattice
                  </button>
                )}
              </>
            ) : (
              <>
                <p className="selected-coordinates">
                  {selectedPoint
                    ? `X ${selectedPoint.x + 1} · Y ${selectedPoint.y + 1} · Z ${selectedPoint.z + 1}`
                    : watching
                      ? "Inspect a point"
                      : "Select an empty point"}
                </p>
                <p className="selection-state">
                  {owner === null
                    ? "Use the layer inspector for a precise view."
                    : owner === 0
                      ? watching
                        ? "Empty point"
                        : "Empty point · ready to claim"
                      : `Already claimed by ${names[owner - 1]}`}
                </p>
                {!watching && (
                  <button
                    className="primary-button"
                    disabled={!canPlay || owner !== 0}
                    onClick={confirm}
                    onKeyDown={(event) => {
                      if (event.repeat) event.preventDefault();
                    }}
                  >
                    Place point
                  </button>
                )}
                {last && (
                  <p className="last-move" aria-live="polite">
                    {last.points > 0
                      ? `${names[last.player - 1]} completed ${last.cubes.length} ${last.cubes.length === 1 ? "cube" : "cubes"}. +${last.points} ${last.points === 1 ? "point" : "points"}.`
                      : `${display.board.length - filled} empty points remain.`}
                  </p>
                )}
              </>
            )}
            {error && (
              <div className="connection-error" role="alert">
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
          </section>
          <section className="cube-guide">
            <h2>Eight corners. One cube.</h2>
            <p>
              A cube scores its volume.
              <br />
              Every size counts.
            </p>
            <div className="volume-guide" aria-label="Cube scores">
              <span>
                <CubeMark small />
                1³ = <b>1</b>
              </span>
              {display.size > 2 && (
                <span>
                  <CubeMark small />
                  2³ = <b>8</b>
                </span>
              )}
              {display.size > 3 && (
                <span>
                  <CubeMark small />
                  3³ = <b>27</b>
                </span>
              )}
            </div>
            <p className="small-print">Equal edges, aligned to the lattice.</p>
            {!setup && display.winner === null && (
              <>
                <button
                  className="trace-button"
                  aria-pressed={showTrace}
                  disabled={!bestCube || busy}
                  onClick={() => setShowTrace((value) => !value)}
                >
                  {showTrace
                    ? "Hide construction guide"
                    : "Trace a possible cube"}
                </button>
                {showTrace && bestCube && (
                  <p className="trace-detail">
                    {bestCube.owned}/8 corners · {bestCube.cube.volume}{" "}
                    {bestCube.cube.volume === 1 ? "point" : "points"}
                    <br />
                    Dashed edges are a plan, not a completed cube.
                  </p>
                )}
              </>
            )}
          </section>
          <section className="recent-moves">
            <h2>Recent moves</h2>
            {moves.length ? (
              <ol>
                {moves.map((entry, index) => (
                  <li key={display.history.length - index}>
                    <i className={`legend-dot owner-${entry.player}`} />
                    <span>{names[entry.player - 1]}</span>
                    <code>
                      {entry.x + 1}, {entry.y + 1}, {entry.z + 1}
                    </code>
                    <span className="move-points">
                      {entry.points > 0
                        ? `+${entry.points}`
                        : `#${display.history.length - index}`}
                    </span>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="small-print">
                {watching
                  ? "The first point starts the story."
                  : "Your first point starts the story."}
              </p>
            )}
          </section>
        </aside>
      </main>
      <footer className="game-footer">
        <span>
          {display.board.length} points <span className="footer-dot">·</span>{" "}
          {display.size} × {display.size} × {display.size}
        </span>
        <div className="legend">
          <span>
            <i className="legend-dot owner-0" />
            Empty
          </span>
          <span>
            <i className="legend-dot owner-1" />
            {names[0]}
          </span>
          <span>
            <i className="legend-dot owner-2" />
            {names[1]}
          </span>
        </div>
        <span className="opening-label">
          {display.opening === "foundation"
            ? "Foundation opening"
            : "Empty opening"}{" "}
          {mode !== "duel" && (
            <>
              ·{" "}
              {display.computerStyle === "tactician"
                ? "Tactician"
                : "Builder"}{" "}
            </>
          )}
          · Unranked
        </span>
      </footer>
      {dialog === "rules" && (
        <Modal
          title="A new dimension of Euclid."
          onClose={() => setDialog(null)}
        >
          <div className="rules-body">
            <p>
              Take turns claiming one empty point. Own all{" "}
              <strong>eight corners</strong> of a cube and its volume is added
              to your score. The cube may contain other points—only its corners
              count.
            </p>
            <ol>
              <li>
                <b>Think in three axes.</b> Every cube has equal X, Y and Z edge
                lengths. Rectangular boxes do not score.
              </li>
              <li>
                <b>Every size counts.</b> On this {display.size}-wide lattice,
                side lengths {display.size === 4 ? "1, 2 and 3" : "1 and 2"}{" "}
                score {display.size === 4 ? "1, 8 and 27" : "1 and 8"}. One
                point can finish several cubes; each scores once.
              </li>
              <li>
                <b>Keep looking inside.</b> Drag the 3D view, use the camera
                buttons, or isolate a Z layer. Completed cubes have edges only,
                never opaque faces.
              </li>
              <li>
                <b>Place deliberately.</b> Select a point, check X/Y/Z, then
                choose Place point. Selecting and rotating never make a move.
              </li>
              <li>
                <b>Fill the lattice.</b> Highest score wins when no points
                remain. Equal scores are a draw.
              </li>
            </ol>
            <h3>A head start, not a free cube</h3>
            <p>
              Foundation opening starts each player with four points on opposite
              faces. Choose Empty lattice for the original blank-board
              challenge. Both are unranked.
            </p>
            <h3>Computer styles</h3>
            <p>
              Builder focuses on making its own cubes. Tactician also blocks
              your plans; deliberate defensive play can produce a scoreless
              draw. The style affects the computer only, not the rules or a
              same-device opponent.
            </p>
            <h3>Keyboard controls</h3>
            <p>
              In the layer inspector, use arrows to move focus and Enter or
              Space to select. Page Up / Down changes layers. Tab to Place point
              to confirm. Focus the 3D view to rotate with arrows; + / − zoom
              and R resets.
            </p>
            <p>
              Trace a possible cube is a free construction guide available to
              either side. It is not a collectible item or a guaranteed winning
              plan.
            </p>
            <button className="primary-button" onClick={() => setDialog(null)}>
              Let’s build
            </button>
          </div>
        </Modal>
      )}
      {!watching && dialog === "restart" && (
        <Modal title="Start a new lattice?" onClose={() => setDialog(null)}>
          <p>
            Your current unranked game stays available until you start the next
            one. Starting replaces it.
          </p>
          <div className="dialog-actions">
            <button
              className="secondary-button"
              onClick={() => setDialog(null)}
            >
              Keep playing
            </button>
            <button
              className="primary-button"
              onClick={() => {
                setDialog(null);
                setConfiguring(true);
              }}
            >
              Choose new game
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
