import { useEffect, useRef, useState } from "react";
import {
  CHALLENGE_GEOMETRIES,
  DEFAULT_CHALLENGE_OPTIONS,
  readChallengeOptions,
  type ChallengeGeometry,
  type ChallengeOptions,
  type ChallengeSnapshot,
} from "../shared/challenge";
import { squareCatalog } from "../shared/game/geometry";
import { requestChallenge, challengeCommand } from "./challenge-api";
import { BoardDiagram } from "./ui/BoardDiagram";
import { BoardInput } from "./ui/BoardInput";
import { useBoardInput } from "./ui/use-board-input";
import {
  BOARD_BLEED,
  pointLabel,
  type BoardSquareShape,
} from "./ui/board-geometry";
import { PageShell } from "./ui/PageShell";
import { Dialog } from "./ui/Dialog";
import "./challenge-screen.css";
import { formatChallengeTime } from "./challenge-time";
import { ChallengeTimer } from "./ChallengeTimer";

type Action = "generate" | "restart" | "leave";
const coordinates = (index: number) =>
  pointLabel(index % 8, Math.floor(index / 8));

export function ChallengeScreen({ onLeave }: { onLeave: () => void }) {
  const [moves, setMoves] = useState("2");
  const [goal, setGoal] = useState("3");
  const [blocks, setBlocks] = useState("0");
  const [geometry, setGeometry] = useState<ChallengeGeometry>(
    DEFAULT_CHALLENGE_OPTIONS.geometry,
  );
  const [shared, setShared] = useState(true);
  const [multiple, setMultiple] = useState(false);
  const [seed, setSeed] = useState("");
  const [manual, setManual] = useState<number[]>([]);
  const [editing, setEditing] = useState(false);
  const [snapshot, setSnapshot] = useState<ChallengeSnapshot | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [uncertain, setUncertain] = useState(false);
  const [confirmation, setConfirmation] = useState<Action | null>(null);
  const [width, setWidth] = useState(480);
  const container = useRef<HTMLDivElement>(null);
  const grid = useRef<HTMLDivElement>(null);
  const pending = useRef(false);
  const live = useRef(true);

  useEffect(() => {
    live.current = true;
    const abort = new AbortController();
    // Re-entering never offers an unfinished attempt for resumption.
    void (async () => {
      try {
        const old = await requestChallenge("state", undefined, abort.signal);
        if (old)
          await requestChallenge(
            "abandon",
            challengeCommand(old),
            abort.signal,
          );
        if (!abort.signal.aborted) {
          setSnapshot(null);
          setBusy(false);
        }
      } catch (e) {
        if (!abort.signal.aborted) {
          setError(
            e instanceof Error ? e.message : "Unable to open playground.",
          );
          setUncertain(true);
          setBusy(false);
        }
      }
    })();
    return () => {
      live.current = false;
      abort.abort();
    };
  }, []);

  useEffect(() => {
    const element = container.current;
    if (!element) return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) setWidth(entry.contentRect.width);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const numeric = (text: string) => (/^\d+$/.test(text) ? Number(text) : NaN);
  let options: ChallengeOptions | null = null;
  let validation = "";
  try {
    options = readChallengeOptions({
      minimumMoves: numeric(moves),
      targetSquares: numeric(goal),
      geometry,
      sharedCorner: shared,
      blockedCount: numeric(blocks),
      blockedPoints: manual,
      multipleSolutions: multiple,
      seed,
    });
  } catch (e) {
    validation = e instanceof Error ? e.message : "Check the puzzle settings.";
  }

  async function recover() {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    try {
      const current = await requestChallenge("state");
      if (live.current) {
        setSnapshot(current);
        setUncertain(false);
        setError("");
      }
    } catch (e) {
      if (live.current)
        setError(
          e instanceof Error ? e.message : "Could not refresh the puzzle.",
        );
    } finally {
      pending.current = false;
      if (live.current) setBusy(false);
    }
  }

  async function mutate(
    action: "generate" | "restart" | "abandon" | "move",
    extra: Record<string, unknown> = {},
  ) {
    if (pending.current || busy || uncertain) return;
    pending.current = true;
    setBusy(true);
    setError("");
    try {
      const next = await requestChallenge(action, {
        ...challengeCommand(snapshot),
        ...extra,
      });
      if (!live.current) return;
      setSnapshot(next);
      if (action === "generate" || action === "restart") setEditing(false);
      if (action === "abandon") onLeave();
    } catch (e) {
      if (!live.current) return;
      setError(e instanceof Error ? e.message : "The request failed.");
      // A reply may be lost after a commit. Never guess which board is current.
      try {
        const current = await requestChallenge("state");
        if (live.current) setSnapshot(current);
      } catch {
        if (live.current) setUncertain(true);
      }
    } finally {
      pending.current = false;
      if (live.current) setBusy(false);
    }
  }

  function act(action: Action) {
    if (action === "generate") {
      if (options) void mutate("generate", { options });
    } else if (action === "restart") void mutate("restart");
    else void mutate("abandon");
  }
  function ask(action: Action) {
    if (snapshot && snapshot.placements.length > 0 && !snapshot.complete)
      setConfirmation(action);
    else act(action);
  }

  const displayedBlocked = editing
    ? manual
    : (snapshot?.puzzle.blocked ?? manual);
  const cells = Array<number>(64).fill(0);
  if (!editing && snapshot)
    for (const point of [...snapshot.puzzle.initial, ...snapshot.placements])
      cells[point] = 1;
  const cellSize = Math.max(
    16,
    Math.min(68, Math.floor(Math.max(0, width - 20) / 8)),
  );
  const squares: BoardSquareShape[] =
    editing || !snapshot
      ? []
      : squareCatalog(8)
          .filter((s) => snapshot.completedSquares.includes(s.id))
          .map((s) => ({
            key: s.id,
            owner: 1,
            tone: "history",
            corners: s.corners.map((p) => ({ x: p % 8, y: Math.floor(p / 8) })),
          }));
  const input = useBoardInput({
    width: 8,
    height: 8,
    cellSize,
    gridRef: grid,
    enabled:
      !busy &&
      !uncertain &&
      !confirmation &&
      (editing || (!!snapshot && !snapshot.complete)),
    revision: `${snapshot?.attemptId}:${snapshot?.revision}:${editing}:${manual.join(",")}`,
    isOpen: (point) =>
      editing || (cells[point] === 0 && !displayedBlocked.includes(point)),
    onPlace: (point) => {
      if (editing) {
        const next = manual.includes(point)
          ? manual.filter((p) => p !== point)
          : [...manual, point];
        if (next.length > 60) {
          setError("At least four points must remain available.");
          return;
        }
        setManual(next);
        if (!Number.isFinite(numeric(blocks)) || numeric(blocks) < next.length)
          setBlocks(String(next.length));
      } else void mutate("move", { point });
    },
  });
  const markers =
    input.aimIndex !== null && !editing
      ? [
          {
            x: input.aimIndex % 8,
            y: Math.floor(input.aimIndex / 8),
            owner: 1 as const,
            kind: "pending" as const,
          },
        ]
      : [];

  return (
    <PageShell
      title="Challenge playground"
      titleId="challenge-title"
      narrow={false}
      back={{
        label: "Leave playground",
        onClick: () => (uncertain ? onLeave() : ask("leave")),
        disabled: busy,
      }}
    >
      <p className="muted">
        Private moderator testing · 8×8 board · No ratings or public entries
      </p>
      <div className="challenge-layout">
        <form
          className="panel challenge-controls"
          onSubmit={(e) => {
            e.preventDefault();
            ask("generate");
          }}
        >
          <fieldset disabled={busy || uncertain || !!confirmation}>
            <legend className="panel__title">Next puzzle</legend>
            <div className="challenge-actions">
              <button
                type="button"
                className="btn btn--sm"
                onClick={() => {
                  setMoves("2");
                  setGoal("3");
                  setGeometry("mixed");
                }}
              >
                Daily starting point
              </button>
              <button
                type="button"
                className="btn btn--sm"
                onClick={() => {
                  setMoves("3");
                  setGoal("4");
                  setGeometry("oblique");
                }}
              >
                Weekly starting point
              </button>
            </div>
            <p className="field__hint">
              Daily: 2–3 mixed squares in 2–4 moves. Weekly: 3–4 oblique squares
              in 2–4 moves.
            </p>
            <label className="field">
              <span className="field__label">Minimum moves</span>
              <input
                className="input num"
                inputMode="numeric"
                value={moves}
                onChange={(e) => setMoves(e.target.value)}
                aria-describedby="challenge-minimum-help"
              />
            </label>
            <p className="field__hint" id="challenge-minimum-help">
              1–4. The verified optimum, not a limit on your attempt.
            </p>
            <label className="field">
              <span className="field__label">Target squares</span>
              <input
                className="input num"
                inputMode="numeric"
                value={goal}
                onChange={(e) => setGoal(e.target.value)}
              />
            </label>
            <label className="field">
              <span className="field__label">Geometry</span>
              <select
                className="select"
                value={geometry}
                onChange={(e) =>
                  setGeometry(e.target.value as ChallengeGeometry)
                }
              >
                {CHALLENGE_GEOMETRIES.map((g) => (
                  <option key={g} value={g}>
                    {g[0]!.toUpperCase() + g.slice(1)}
                  </option>
                ))}
              </select>
            </label>
            <p className="field__hint">
              Tilted includes diamonds. Oblique excludes aligned squares and 45°
              diamonds. Any valid square counts when playing.
            </p>
            <label className="switch">
              <input
                type="checkbox"
                checked={shared}
                onChange={(e) => setShared(e.target.checked)}
              />
              <span>Require shared corner</span>
            </label>
            <label className="switch">
              <input
                type="checkbox"
                checked={multiple}
                onChange={(e) => setMultiple(e.target.checked)}
              />
              <span>Require multiple optimal solutions</span>
            </label>
            <label className="field">
              <span className="field__label">Total blocked spots</span>
              <input
                className="input num"
                inputMode="numeric"
                value={blocks}
                onChange={(e) => setBlocks(e.target.value)}
              />
            </label>
            <p className="field__hint">
              {manual.length} manually marked. Additional blocks are chosen
              automatically, up to the total (0–60).
            </p>
            <div className="challenge-actions">
              <button
                className="btn btn--sm"
                type="button"
                aria-pressed={editing}
                onClick={() => setEditing(!editing)}
              >
                {editing ? "Done editing blocked spots" : "Edit blocked spots"}
              </button>
              {manual.length > 0 && (
                <button
                  className="btn btn--ghost btn--sm"
                  type="button"
                  onClick={() => setManual([])}
                >
                  Clear manual blocks
                </button>
              )}
            </div>
            <label className="field">
              <span className="field__label">Seed (optional)</span>
              <input
                className="input"
                value={seed}
                maxLength={80}
                onChange={(e) => setSeed(e.target.value)}
                placeholder="Blank generates a fresh puzzle"
              />
            </label>
            {validation && (
              <p className="notice notice--attention" role="alert">
                {validation}
              </p>
            )}
            <button
              className="btn btn--primary"
              type="submit"
              disabled={!options}
            >
              Generate
            </button>
          </fieldset>
        </form>
        <section className="panel challenge-play" aria-label="Puzzle play">
          <div className="challenge-status" role="status" aria-live="polite">
            <div className="challenge-status__head">
              <h2 className="panel__title">
                {editing
                  ? "Edit blocked spots"
                  : snapshot
                    ? snapshot.complete
                      ? "Puzzle complete"
                      : "Complete the squares"
                    : "No puzzle yet"}
              </h2>
              {snapshot && !editing && <ChallengeTimer snapshot={snapshot} />}
            </div>
            {editing ? (
              <p className="field__hint">
                Mark forbidden spots for the next puzzle. Your current attempt
                is unchanged.
              </p>
            ) : snapshot ? (
              <ul className="challenge-stats">
                <li>
                  Squares: {snapshot.completedSquares.length} /{" "}
                  {snapshot.puzzle.targetSquares}
                </li>
                <li>Pieces placed: {snapshot.placements.length}</li>
                <li>Minimum: {snapshot.puzzle.minimumMoves}</li>
                {snapshot.bestMoves !== null && (
                  <li className="challenge-stats__best">
                    Best completed attempt: {snapshot.bestMoves} moves
                    {snapshot.bestElapsedMs !== null &&
                      ` · ${formatChallengeTime(snapshot.bestElapsedMs)}`}
                  </li>
                )}
              </ul>
            ) : (
              <p className="field__hint">
                Configure a puzzle and select Generate.
              </p>
            )}
            {busy && <p className="field__hint">Working…</p>}
            {input.aimIndex !== null && (
              <p className="field__hint">
                Tap {coordinates(input.aimIndex)} again to{" "}
                {editing ? "toggle its block" : "place"}.
              </p>
            )}
          </div>
          <div ref={container} className="challenge-board-container">
            <div
              className="challenge-board"
              style={{ width: cellSize * 8, height: cellSize * 8 }}
            >
              <div
                className="challenge-board-art"
                style={{
                  left: -BOARD_BLEED.left * cellSize,
                  top: -BOARD_BLEED.top * cellSize,
                  right: -BOARD_BLEED.right * cellSize,
                  bottom: -BOARD_BLEED.bottom * cellSize,
                }}
              >
                <BoardDiagram
                  width={8}
                  height={8}
                  cells={cells}
                  squares={squares}
                  blockedPoints={displayedBlocked}
                  markers={markers}
                  arrivingIndex={
                    editing ? null : (snapshot?.placements.at(-1) ?? null)
                  }
                />
              </div>
              <BoardInput
                width={8}
                height={8}
                cellSize={cellSize}
                controls={input}
                label={
                  editing
                    ? "Blocked spot editor, 8 by 8"
                    : "Challenge board, 8 by 8"
                }
                describeCell={(p) =>
                  `${coordinates(p)}, ${displayedBlocked.includes(p) ? "blocked" : cells[p] ? "occupied" : "empty"}${editing ? ", activate to toggle block" : ""}`
                }
              />
            </div>
          </div>
          <p className="field__hint">
            Use arrow keys to move and Enter or Space to place. Placements
            cannot be undone. You may use more than the minimum, or restart the
            same puzzle. Fewest pieces wins; equal move counts are ranked by
            fastest time. Timing starts when the attempt opens and continues
            until completion.
          </p>
          {error && (
            <p className="notice notice--attention" role="alert">
              {error}
            </p>
          )}
          <div className="challenge-actions">
            {uncertain && (
              <button
                className="btn"
                disabled={busy}
                onClick={() => void recover()}
              >
                Refresh puzzle state
              </button>
            )}
            <button
              className="btn"
              disabled={!snapshot || busy || uncertain}
              onClick={() => ask("restart")}
            >
              Restart puzzle
            </button>
          </div>
        </section>
      </div>
      {confirmation && (
        <Dialog
          labelledBy="challenge-confirm-title"
          onDismiss={() => setConfirmation(null)}
        >
          <h2 id="challenge-confirm-title">Discard this unfinished attempt?</h2>
          <p>
            {confirmation === "restart"
              ? "Your best completed result remains. This puzzle will start again with no placements."
              : "Your current placements will be discarded."}
          </p>
          <div className="challenge-actions">
            <button
              autoFocus
              className="btn btn--ghost"
              onClick={() => setConfirmation(null)}
            >
              Keep playing
            </button>
            <button
              className="btn"
              onClick={() => {
                const action = confirmation;
                setConfirmation(null);
                act(action);
              }}
            >
              Discard and continue
            </button>
          </div>
        </Dialog>
      )}
    </PageShell>
  );
}
