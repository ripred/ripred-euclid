import { useEffect, useRef, useState } from "react";
import {
  validateSubredditSettings,
  type SubredditSettings,
} from "../shared/subreddit-settings";
import { errorMessage } from "../shared/error-message";
import { fetchJsonRecord, JsonRequestError } from "./fetch-json";
import type { SetupScreenProps } from "./setup-screen";
import { Switch } from "./ui/Switch";
import { TideRules } from "./tide-rules";

export function SubredditOptions({
  settings,
  onSettingsChange,
  onPlayground,
  onSavingChange,
}: Pick<SetupScreenProps, "settings" | "onSettingsChange" | "onPlayground"> & {
  onSavingChange: (saving: boolean) => void;
}) {
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
      className="panel options__subreddit"
      aria-label="Subreddit options"
    >
      <fieldset disabled={loading || saving || !loaded}>
        <legend>Game mode</legend>
        <Switch
          label="Tide mode"
          hint="Use Tide for every new Practice, Ranked, and Redditor game. Games already in progress keep their rules."
          checked={settings.tideMode}
          onChange={(enabled) => void save("tideMode", enabled)}
        />
        <TideRules />
        <p className="field__hint">
          Tide ratings and leaderboards are separate from Standard.
        </p>
      </fieldset>
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
      <p className="field__hint options__status" role="status">
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
      <div className="options__playground">
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
    </section>
  );
}
