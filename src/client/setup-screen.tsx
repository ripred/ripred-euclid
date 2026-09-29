import { useEffect, useState } from "react";
import type { SubredditSettings } from "../shared/subreddit-settings";
import { SubredditOptions } from "./subreddit-options";
import {
  AI_DIFFICULTY_LABELS,
  RANKED_SOLO_RULES,
  STANDARD_BOARD,
  type AiDifficulty,
  type SoloMode,
} from "../shared/game/rules";
import { emptyCells } from "../shared/game/geometry";
import { rulesSummary } from "./format";
import { SQUARE_HINTS_COPY } from "./solo-preferences";
import { DifficultySlider } from "./ui/DifficultySlider";
import { Switch } from "./ui/Switch";
import { BoardDiagram } from "./ui/BoardDiagram";
import { boardAspectRatio } from "./ui/board-geometry";
import { PageShell } from "./ui/PageShell";
import "./setup-screen.css";

export interface SetupScreenProps {
  soloMode: SoloMode;
  onSoloModeChange: (mode: SoloMode) => void;
  difficulty: AiDifficulty;
  onDifficultyChange: (difficulty: AiDifficulty) => void;
  assistOn: boolean;
  onAssistChange: (on: boolean) => void;
  soundOn: boolean;
  onSoundChange: (on: boolean) => void;
  isModerator: boolean;
  settings: SubredditSettings;
  onSettingsChange: (settings: SubredditSettings) => void;
  onPlayground: () => void;
  appVersion: string;
  onDone: () => void;
}

const EMPTY_STANDARD_BOARD = emptyCells(STANDARD_BOARD.W, STANDARD_BOARD.H);

/** The standard board every game is played on, captioned with its rules. */
function RulesPreview({ label }: { label: string }) {
  return (
    <figure className="setup-preview">
      <div
        className="setup-preview__board"
        style={{
          aspectRatio: boardAspectRatio(STANDARD_BOARD.W, STANDARD_BOARD.H),
        }}
      >
        <BoardDiagram
          width={STANDARD_BOARD.W}
          height={STANDARD_BOARD.H}
          cells={EMPTY_STANDARD_BOARD}
        />
      </div>
      <figcaption>{label}</figcaption>
    </figure>
  );
}

export function SetupScreen(props: SetupScreenProps) {
  const {
    soloMode,
    onSoloModeChange,
    difficulty,
    onDifficultyChange,
    assistOn,
    onAssistChange,
    appVersion,
    onDone,
  } = props;
  const [tab, setTab] = useState<"personal" | "subreddit">("personal");
  const [savingSubreddit, setSavingSubreddit] = useState(false);
  const subredditTab = props.isModerator && tab === "subreddit";
  useEffect(() => {
    document.getElementById("setup-title")?.focus();
  }, []);
  const ranked = soloMode === "ranked";

  return (
    <PageShell
      title="Options"
      titleId="setup-title"
      back={{ label: "Done", onClick: onDone, disabled: savingSubreddit }}
      className="setup"
      onKeyDown={(event) => {
        if (event.key === "Escape" && !savingSubreddit) onDone();
      }}
    >
      {props.isModerator && (
        <div className="seg options__tabs" role="tablist" aria-label="Options">
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
        className="options__panel"
        role={props.isModerator ? "tabpanel" : undefined}
        aria-labelledby={props.isModerator ? `options-tab-${tab}` : undefined}
      >
        {subredditTab ? (
          <SubredditOptions
            settings={props.settings}
            onSettingsChange={props.onSettingsChange}
            onPlayground={props.onPlayground}
            onSavingChange={setSavingSubreddit}
          />
        ) : (
          <>
            <section
              className="panel setup-section"
              aria-labelledby="setup-solo"
            >
              <div className="setup-section__head">
                <h2 id="setup-solo" className="panel__title">
                  Redditor vs Euclid
                </h2>
                <div
                  className="seg"
                  role="radiogroup"
                  aria-label="Solo game type"
                >
                  {(["practice", "ranked"] as const).map((choice) => (
                    <button
                      key={choice}
                      type="button"
                      role="radio"
                      aria-checked={soloMode === choice}
                      onClick={() => onSoloModeChange(choice)}
                    >
                      {choice === "ranked" ? "Ranked" : "Practice"}
                    </button>
                  ))}
                </div>
              </div>

              {ranked ? (
                <div className="setup-ranked">
                  <RulesPreview label={rulesSummary(RANKED_SOLO_RULES)} />
                  <div className="setup-ranked__copy">
                    <p>
                      Ranked uses one comparable preset, so every rating is
                      earned on the same board.
                    </p>
                    <ul className="setup-facts">
                      <li>You move first</li>
                      <li>
                        Euclid plays{" "}
                        {AI_DIFFICULTY_LABELS[RANKED_SOLO_RULES.difficulty]}
                      </li>
                      <li>Hints are off</li>
                      <li>Wins and losses change your rating</li>
                    </ul>
                  </div>
                </div>
              ) : (
                <div className="setup-practice">
                  <DifficultySlider
                    id="setup-difficulty"
                    value={difficulty}
                    onChange={onDifficultyChange}
                  />

                  <Switch
                    {...SQUARE_HINTS_COPY}
                    checked={assistOn}
                    onChange={onAssistChange}
                  />
                </div>
              )}
            </section>

            <section className="panel setup-section" aria-label="Audio">
              <Switch
                label="Sound effects"
                hint="Pieces, squares and results play short tones."
                checked={props.soundOn}
                onChange={props.onSoundChange}
              />
              <p className="field__hint">
                Difficulty, square hints and sound are saved on this device.
              </p>
            </section>
            <section
              className="panel setup-about"
              aria-labelledby="setup-about"
            >
              <h2 id="setup-about" className="panel__title">
                About Euclid
              </h2>
              <p className="muted">
                Euclid is a strategy game about placing pieces, completing
                squares and outscoring Euclid or another redditor. Straight and
                tilted squares both count, and one move can complete several at
                once.
              </p>
              <p className="field__hint">
                Version <span className="num">{appVersion}</span>
              </p>
            </section>
          </>
        )}
      </div>
    </PageShell>
  );
}
