import { useEffect, useRef, useState } from "react";
import {
  CHALLENGE_GEOMETRIES,
  DEFAULT_CHALLENGE_OPTIONS,
  readChallengeOptions,
  type ChallengeGeometry,
  type ChallengeOptions,
  type ChallengeSnapshot,
} from "../shared/challenge";
import { requestChallenge, challengeCommand } from "./challenge-api";
import { ChallengeBoard } from "./ui/ChallengeBoard";
import { ChallengeTemplateControls } from "./challenge-template-controls";
import { PageShell } from "./ui/PageShell";
import { Dialog } from "./ui/Dialog";
import "./challenge-screen.css";
import { formatChallengeTime } from "./challenge-time";
import { ChallengeTimer } from "./ChallengeTimer";
import { Switch } from "./ui/Switch";

type Action = "generate" | "restart" | "leave";

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
  const [templateBusy, setTemplateBusy] = useState(false);
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

  function place(point: number) {
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
  }

  return (
    <PageShell
      title="Challenge playground"
      titleId="challenge-title"
      narrow={false}
      back={{
        label: "Leave playground",
        onClick: () => (uncertain ? onLeave() : ask("leave")),
        disabled: busy || templateBusy,
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
          <fieldset
            disabled={busy || templateBusy || uncertain || !!confirmation}
          >
            <legend className="panel__title">Next puzzle</legend>
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
            <Switch
              label="Require shared corner"
              checked={shared}
              onChange={setShared}
            />
            <Switch
              label="Require multiple optimal solutions"
              checked={multiple}
              onChange={setMultiple}
            />
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
          <ChallengeTemplateControls
            options={options}
            disabled={busy || uncertain || !!confirmation}
            onBusyChange={setTemplateBusy}
            onLoad={(template) => {
              setMoves(String(template.minimumMoves));
              setGoal(String(template.targetSquares));
              setBlocks(String(template.blockedCount));
              setGeometry(template.geometry);
              setShared(template.sharedCorner);
              setMultiple(template.multipleSolutions);
              setManual([...template.blockedPoints]);
              setSeed("");
              setEditing(template.blockedPoints.length > 0);
            }}
          />
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
          </div>
          <ChallengeBoard
            puzzle={snapshot?.puzzle ?? null}
            placements={snapshot?.placements ?? []}
            completedSquares={snapshot?.completedSquares ?? []}
            blockedPoints={
              editing ? manual : (snapshot?.puzzle.blocked ?? manual)
            }
            revision={`${snapshot?.attemptId}:${snapshot?.revision}:${editing}:${manual.join(",")}`}
            enabled={
              !busy &&
              !templateBusy &&
              !uncertain &&
              !confirmation &&
              (editing || (!!snapshot && !snapshot.complete))
            }
            onPlace={place}
            editing={editing}
            label={
              editing
                ? "Blocked spot editor, 8 by 8"
                : "Challenge board, 8 by 8"
            }
          />
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
              disabled={!snapshot || busy || templateBusy || uncertain}
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
