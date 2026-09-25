import {
  AI_DIFFICULTIES,
  AI_DIFFICULTY_LABELS,
  FADE_TURN_CHOICES,
  RANKED_SOLO_RULES,
  type AiDifficulty,
  type FadeTurns,
  type SoloMode,
} from "./game/rules";
import { rulesSummary, scoringLabel } from "./format";
import {
  THEME_PREFERENCES,
  bestPossibleScore,
  recommendedScore,
  type PracticeSettings,
  type Settings,
  type ThemePreference,
} from "./settings";
import { BoardDiagram } from "./ui/BoardDiagram";
import { boardAspectRatio } from "./ui/board-geometry";
import { LevelSlider } from "./ui/LevelSlider";
import { PageShell } from "./ui/PageShell";
import "./setup-screen.css";

const EVEN_BOARD_SIZES = [4, 6, 8, 10, 12, 14, 16] as const;

type Scoring = "bbox" | "true";

export interface SetupScreenProps {
  settings: Settings;
  onSoloModeChange: (mode: SoloMode) => void;
  onPracticeChange: (change: Partial<PracticeSettings>) => void;
  onAssistChange: (on: boolean) => void;
  onThemeChange: (theme: ThemePreference) => void;
  /** Absent when there is nothing recorded to reset. */
  onResetRecords?: (() => void) | undefined;
  appVersion: string;
  onDone: () => void;
}

const THEME_LABELS: Record<ThemePreference, string> = {
  system: "Match device",
  light: "Light",
  dark: "Dark",
};

/** A radio group of pill choices for short, unordered settings. */
function ChoiceGroup<T extends string | number>({
  label,
  options,
  value,
  onChange,
  format = String,
}: {
  label: string;
  options: readonly T[];
  value: T;
  onChange: (value: T) => void;
  format?: (value: T) => string;
}) {
  return (
    <div className="choices" role="radiogroup" aria-label={label}>
      {options.map((option) => (
        <button
          key={option}
          type="button"
          role="radio"
          aria-checked={option === value}
          className="choice"
          onClick={() => onChange(option)}
        >
          {format(option)}
        </button>
      ))}
    </div>
  );
}

const SCORING_OPTIONS: readonly {
  value: Scoring;
  description: string;
}[] = [
  {
    value: "bbox",
    description:
      "Count the points along the side of the square's upright box, then square it. Tilted squares punch above their size.",
  },
  {
    value: "true",
    description:
      "Score the square's real area. Tilted squares are worth exactly what they cover.",
  },
];

function RulesPreview({
  width,
  height,
  label,
}: {
  width: number;
  height: number;
  label: string;
}) {
  return (
    <figure className="setup-preview">
      <div
        className="setup-preview__board"
        style={{
          aspectRatio: boardAspectRatio(width, height),
        }}
      >
        <BoardDiagram
          key={`${width}x${height}`}
          width={width}
          height={height}
          cells={new Array<number>(width * height).fill(0)}
        />
      </div>
      <figcaption>{label}</figcaption>
    </figure>
  );
}

export function SetupScreen(props: SetupScreenProps) {
  const {
    settings,
    onSoloModeChange,
    onPracticeChange,
    onAssistChange,
    onThemeChange,
    onResetRecords,
    appVersion,
    onDone,
  } = props;
  const { soloMode, practice, assist: assistOn, theme } = settings;
  const {
    difficulty,
    W: width,
    H: height,
    scoring,
    winScore,
    fadeTurns,
  } = practice;
  const bestCase = bestPossibleScore(practice);
  const recommended = recommendedScore(practice);
  const ranked = soloMode === "ranked";
  const onDifficultyChange = (next: AiDifficulty) =>
    onPracticeChange({ difficulty: next });
  const onWidthChange = (W: number) => onPracticeChange({ W });
  const onHeightChange = (H: number) => onPracticeChange({ H });
  const onScoringChange = (next: Scoring) =>
    onPracticeChange({ scoring: next });
  const onWinScoreChange = (next: number) =>
    onPracticeChange({ winScore: next });
  const onFadeChange = (next: FadeTurns) =>
    onPracticeChange({ fadeTurns: next });

  return (
    <PageShell
      title="Game setup"
      titleId="setup-title"
      back={{ label: "Done", onClick: onDone }}
      className="setup"
    >
      <section className="panel setup-section" aria-labelledby="setup-solo">
        <div className="setup-section__head">
          <h2 id="setup-solo" className="panel__title">
            You vs Euclid
          </h2>
          <div className="seg" role="radiogroup" aria-label="Solo game type">
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
            <RulesPreview
              width={RANKED_SOLO_RULES.W}
              height={RANKED_SOLO_RULES.H}
              label={rulesSummary(RANKED_SOLO_RULES)}
            />
            <div className="setup-ranked__copy">
              <p>
                Ranked uses one comparable preset, so every rating is earned on
                the same board.
              </p>
              <ul className="setup-facts">
                <li>You move first</li>
                <li>
                  Euclid plays{" "}
                  {AI_DIFFICULTY_LABELS[RANKED_SOLO_RULES.difficulty]}
                </li>
                <li>Hints are off</li>
                <li>Stones never fade</li>
                <li>Wins and losses change your rating</li>
              </ul>
            </div>
          </div>
        ) : (
          <div className="setup-practice">
            <LevelSlider
              id="setup-difficulty"
              label="Euclid's difficulty"
              options={AI_DIFFICULTIES}
              value={difficulty}
              onChange={onDifficultyChange}
              format={(value) => AI_DIFFICULTY_LABELS[value]}
            />

            <div className="setup-board">
              <div className="setup-board__fields">
                <div className="field">
                  <span className="field__label">Board width</span>
                  <ChoiceGroup
                    label="Board width"
                    options={EVEN_BOARD_SIZES}
                    value={width as (typeof EVEN_BOARD_SIZES)[number]}
                    onChange={onWidthChange}
                  />
                </div>
                <div className="field">
                  <span className="field__label">Board height</span>
                  <ChoiceGroup
                    label="Board height"
                    options={EVEN_BOARD_SIZES}
                    value={height as (typeof EVEN_BOARD_SIZES)[number]}
                    onChange={onHeightChange}
                  />
                </div>
              </div>
              <RulesPreview
                width={width}
                height={height}
                label={`${width}×${height} board`}
              />
            </div>

            <div className="field">
              <span className="field__label">Scoring</span>
              <div
                className="setup-scoring"
                role="radiogroup"
                aria-label="Scoring"
              >
                {SCORING_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    role="radio"
                    aria-checked={scoring === option.value}
                    className="setup-scoring__option"
                    onClick={() => onScoringChange(option.value)}
                  >
                    <strong>{scoringLabel(option.value)}</strong>
                    <span>{option.description}</span>
                  </button>
                ))}
              </div>
            </div>

            <LevelSlider
              id="setup-fade"
              label="Fading pieces"
              options={FADE_TURN_CHOICES}
              value={fadeTurns}
              onChange={onFadeChange}
              format={(turns) => (turns ? `${turns} turns` : "Off")}
              hint={
                fadeTurns
                  ? `A stone lasts ${fadeTurns} of its owner's turns, fading as it ages, then washes away. Completing a square anchors its corners for good.`
                  : "Off: every stone stays for the whole game. Turn it on and stones wash away unless they complete a square."
              }
            />

            <div className="field setup-target">
              <label className="field__label" htmlFor="setup-win-score">
                Winning score
              </label>
              <div className="setup-target__row">
                <input
                  id="setup-win-score"
                  className="input num"
                  type="number"
                  min={1}
                  max={bestCase}
                  value={winScore}
                  onChange={(event) =>
                    onWinScoreChange(
                      Math.max(
                        1,
                        Math.min(bestCase, Number(event.target.value) || 0),
                      ),
                    )
                  }
                />
                <button
                  type="button"
                  className="btn btn--sm"
                  disabled={winScore === recommended}
                  onClick={() => onWinScoreChange(recommended)}
                >
                  Use recommended {recommended}
                </button>
              </div>
              <p className="field__hint">
                Recommended scales the classic 8×8, first-to-150 game. The most
                one player can score on {width}×{height} with{" "}
                {scoringLabel(scoring)} is {bestCase}.
              </p>
            </div>

            <label className="switch">
              <input
                type="checkbox"
                checked={assistOn}
                onChange={(event) => onAssistChange(event.target.checked)}
              />
              <span>
                <strong>Square hints</strong>
                <span className="field__hint">
                  Hover or press one of your pieces to see the points that
                  finish a square in one or two moves.
                </span>
              </span>
            </label>
          </div>
        )}
      </section>

      <section
        className="panel setup-section"
        aria-labelledby="setup-appearance"
      >
        <h2 id="setup-appearance" className="panel__title">
          Appearance
        </h2>
        <div className="field">
          <span className="field__label">Theme</span>
          <ChoiceGroup
            label="Theme"
            options={THEME_PREFERENCES}
            value={theme}
            onChange={onThemeChange}
            format={(value) => THEME_LABELS[value]}
          />
          <p className="field__hint">
            The board looks the same in every theme; only the surroundings
            change.
          </p>
        </div>
      </section>

      <section className="panel setup-about" aria-labelledby="setup-about">
        <h2 id="setup-about" className="panel__title">
          About Euclid
        </h2>
        <p className="muted">
          Euclid is a strategy game about placing pieces, completing squares and
          outscoring Euclid, the computer opponent. Straight and tilted squares
          both count, and one move can complete several at once.
        </p>
        <p className="muted">
          Everything stays in this browser: your settings, records and any saved
          game. Nothing is sent anywhere, and the game keeps working offline.
        </p>
        {onResetRecords ? (
          <button
            type="button"
            className="btn btn--ghost btn--sm setup-about__reset"
            onClick={onResetRecords}
          >
            Reset records
          </button>
        ) : null}
        <p className="field__hint">
          Version <span className="num">{appVersion}</span>
        </p>
      </section>
    </PageShell>
  );
}
