import "./splash-options.css";
import { useEffect, useRef, useState, type MouseEvent } from "react";
import {
  validateSubredditSettings,
  type SubredditSettings,
} from "../shared/subreddit-settings";
import { errorMessage } from "../shared/error-message";
import { fetchJsonRecord, JsonRequestError } from "./fetch-json";
import {
  SQUARE_HINTS_COPY,
  readPracticePreferences,
  savePracticePreferences,
  type PracticePreferences,
} from "./solo-preferences";
import { readSoundPreference, saveSoundPreference } from "./sound/engine";
import { SplashHeader, SplashScene } from "./splash-carousel";
import { SHOWCASE } from "./splash-scene";
import { BoardDiagram } from "./ui/BoardDiagram";
import { pointIndex, squareHints } from "./ui/board-geometry";
import { DifficultySlider } from "./ui/DifficultySlider";
import { Switch } from "./ui/Switch";

/* What square hints show when a red piece is pressed in the showcase. */
const SHOWCASE_HINTS = squareHints(
  SHOWCASE.cells,
  SHOWCASE.width,
  SHOWCASE.height,
  pointIndex(SHOWCASE.pressed.x, SHOWCASE.pressed.y, SHOWCASE.width),
  1,
);

/**
 * Personal options stay on this device. Moderators also have a separate
 * tab for shared subreddit settings and the private challenge playground.
 */
export function SplashOptions({
  onClose,
  isModerator,
  settings,
  onSettingsChange,
  onPlayground,
  expansionError,
}: {
  onClose: () => void;
  isModerator: boolean;
  settings: SubredditSettings;
  onSettingsChange: (settings: SubredditSettings) => void;
  onPlayground: (event: MouseEvent<HTMLButtonElement>) => void;
  expansionError: string | null;
}) {
  const [tab, setTab] = useState<"personal" | "subreddit">("personal");
  const [savingSubreddit, setSavingSubreddit] = useState(false);
  const subredditTab = isModerator && tab === "subreddit";
  const [practice, setPractice] = useState(readPracticePreferences);
  const [sound, setSound] = useState(readSoundPreference);
  const title = useRef<HTMLHeadingElement>(null);
  useEffect(() => title.current?.focus(), []);
  useEffect(() => savePracticePreferences(practice), [practice]);
  useEffect(() => saveSoundPreference(sound), [sound]);
  const update = (change: Partial<PracticePreferences>) =>
    setPractice((current) => ({ ...current, ...change }));

  return (
    <section
      className={`splash-options${isModerator ? " splash-options--moderator" : ""}`}
      role="dialog"
      aria-modal="true"
      aria-labelledby="splash-options-title"
      onKeyDown={(event) => {
        if (event.key === "Escape" && !savingSubreddit) onClose();
      }}
    >
      <SplashHeader>
        <h2
          id="splash-options-title"
          className="splash-header__label"
          ref={title}
          tabIndex={-1}
        >
          Options
        </h2>
      </SplashHeader>
      {isModerator && (
        <div
          className="seg splash-options__tabs"
          role="tablist"
          aria-label="Options"
        >
          {(["personal", "subreddit"] as const).map((id) => (
            <button
              key={id}
              id={`options-tab-${id}`}
              type="button"
              role="tab"
              aria-selected={tab === id}
              aria-controls="options-panel"
              tabIndex={tab === id ? 0 : -1}
              disabled={savingSubreddit}
              onClick={() => setTab(id)}
              onKeyDown={(event) => {
                if (savingSubreddit) return;
                if (
                  !["ArrowLeft", "ArrowRight", "Home", "End"].includes(
                    event.key,
                  )
                )
                  return;
                event.preventDefault();
                const next =
                  event.key === "Home"
                    ? "personal"
                    : event.key === "End"
                      ? "subreddit"
                      : id === "personal"
                        ? "subreddit"
                        : "personal";
                setTab(next);
                document.getElementById(`options-tab-${next}`)?.focus();
              }}
            >
              {id === "personal" ? "Your options" : "Subreddit"}
            </button>
          ))}
        </div>
      )}
      <div
        id="options-panel"
        className="splash-options__panel"
        role={isModerator ? "tabpanel" : undefined}
        aria-labelledby={isModerator ? `options-tab-${tab}` : undefined}
      >
        {subredditTab ? (
          <SubredditOptions
            settings={settings}
            onSettingsChange={onSettingsChange}
            onPlayground={onPlayground}
            expansionError={expansionError}
            onSavingChange={setSavingSubreddit}
          />
        ) : (
          <SplashScene
            tone="red"
            live={false}
            decorative
            className="splash-options__scene"
            stage={
              // The stage previews square hints, so the switch shows its effect.
              <BoardDiagram
                width={SHOWCASE.width}
                height={SHOWCASE.height}
                cells={SHOWCASE.cells}
                squares={SHOWCASE.squares}
                markers={
                  practice.assist
                    ? [{ ...SHOWCASE.pressed, owner: 1, kind: "last" }]
                    : []
                }
                hints={practice.assist ? SHOWCASE_HINTS : []}
                dimEmpty={practice.assist}
              />
            }
          >
            <DifficultySlider
              id="splash-difficulty"
              value={practice.difficulty}
              onChange={(difficulty) => update({ difficulty })}
            />
            <Switch
              {...SQUARE_HINTS_COPY}
              checked={practice.assist}
              onChange={(assist) => update({ assist })}
            />
            <Switch
              label="Sound effects"
              hint="Pieces, squares and results play short tones."
              checked={sound}
              onChange={setSound}
            />
          </SplashScene>
        )}
      </div>
      <footer className="splash-footer">
        <p className="splash-sample">
          {subredditTab
            ? "Moderator changes apply to everyone in this subreddit."
            : "Saved on this device for your next Practice game. Ranked always uses the ranked rules."}
        </p>
        <button
          className="btn btn--primary"
          onClick={onClose}
          disabled={savingSubreddit}
        >
          Done
        </button>
      </footer>
    </section>
  );
}

function SubredditOptions({
  settings,
  onSettingsChange,
  onPlayground,
  expansionError,
  onSavingChange,
}: Pick<
  Parameters<typeof SplashOptions>[0],
  "settings" | "onSettingsChange" | "onPlayground" | "expansionError"
> & { onSavingChange: (saving: boolean) => void }) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const pending = useRef(false);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    void fetchJsonRecord(
      "/api/subreddit-settings",
      "Settings could not be loaded.",
      { signal: controller.signal },
    )
      .then((record) => {
        if (controller.signal.aborted) return;
        const next = validateSubredditSettings(record?.settings);
        if (!next) throw new Error("Settings could not be loaded.");
        onSettingsChange(next);
        setLoaded(true);
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted)
          setError(errorMessage(cause, "Settings could not be loaded."));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [attempt, onSettingsChange]);

  const save = async <K extends keyof SubredditSettings>(
    field: K,
    value: SubredditSettings[K],
  ) => {
    if (!loaded || pending.current) return;
    pending.current = true;
    onSavingChange(true);
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      const record = await fetchJsonRecord(
        "/api/subreddit-settings",
        "Settings could not be saved.",
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ settings: { ...settings, [field]: value } }),
        },
      );
      const next = validateSubredditSettings(record?.settings);
      if (!next) throw new Error("Settings could not be saved.");
      onSettingsChange(next);
      setSaved(true);
    } catch (cause) {
      setError(errorMessage(cause, "Settings could not be saved."));
      if (!(cause instanceof JsonRequestError) || cause.status >= 500) {
        // A failed response can follow a successful write. Read the canonical
        // settings before another full-object PUT can overwrite that change.
        try {
          const record = await fetchJsonRecord(
            "/api/subreddit-settings",
            "Current settings could not be confirmed.",
          );
          const next = validateSubredditSettings(record?.settings);
          if (!next)
            throw new Error("Current settings could not be confirmed.");
          onSettingsChange(next);
          if (next[field] === value) {
            setError(null);
            setSaved(true);
          } else {
            setError(
              "Current subreddit settings were refreshed. Review them before retrying your change.",
            );
          }
        } catch {
          setLoaded(false);
          setError(
            "The save result could not be confirmed. Reload current settings before making another change.",
          );
        }
      }
    } finally {
      pending.current = false;
      setSaving(false);
      onSavingChange(false);
    }
  };

  return (
    <section
      className="panel splash-options__subreddit"
      aria-label="Subreddit options"
    >
      <fieldset disabled={loading || saving || !loaded}>
        <legend>Challenge visibility</legend>
        <p className="field__hint">
          Offer these challenges and show their winners to everyone in this
          subreddit.
        </p>
        <Switch
          label="Daily challenges"
          checked={settings.dailyChallenges}
          onChange={(enabled) => void save("dailyChallenges", enabled)}
        />
        <Switch
          label="Weekly challenges"
          checked={settings.weeklyChallenges}
          onChange={(enabled) => void save("weeklyChallenges", enabled)}
        />
        <label className="field">
          <span className="field__label">Apply changes</span>
          <select
            className="select"
            value={settings.challengeApplyTiming}
            onChange={(event) =>
              void save(
                "challengeApplyTiming",
                event.currentTarget
                  .value as SubredditSettings["challengeApplyTiming"],
              )
            }
            aria-describedby="challenge-apply-timing-help"
          >
            <option value="next-start">Next scheduled start</option>
            <option value="immediately">Immediately</option>
          </select>
        </label>
        <p className="field__hint" id="challenge-apply-timing-help">
          Used when applying puzzle settings in the playground or enabling a
          challenge with no current board. Selecting a timing does not replace a
          puzzle. Daily starts at 00:00 GMT; weekly starts Monday at 00:00 GMT.
        </p>
        <Switch
          label="Show live challenge standings"
          hint="Applies immediately to both challenges. Players always see their own results."
          checked={settings.showLiveChallengeStandings}
          onChange={(enabled) =>
            void save("showLiveChallengeStandings", enabled)
          }
        />
      </fieldset>
      <p className="field__hint splash-options__status" role="status">
        {loading
          ? "Loading settings…"
          : saving
            ? "Saving…"
            : saved
              ? "Saved for this subreddit."
              : "Changes save automatically."}
      </p>
      {error && (
        <p className="notice notice--attention" role="alert">
          {error}{" "}
          {!loaded && (
            <button
              type="button"
              className="btn btn--sm"
              onClick={() => setAttempt((value) => value + 1)}
            >
              Retry
            </button>
          )}
        </p>
      )}
      <div className="splash-options__playground">
        <button
          type="button"
          className="btn"
          onClick={onPlayground}
          disabled={saving}
        >
          Challenge playground
        </button>
        <p className="field__hint">
          Private puzzle testing for moderators. Available even when both
          challenges are off.
        </p>
      </div>
      {expansionError && (
        <p role="alert" className="notice notice--attention">
          {expansionError}
        </p>
      )}
    </section>
  );
}
