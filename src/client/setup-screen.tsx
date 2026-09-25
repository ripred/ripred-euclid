import {
  AI_DIFFICULTIES,
  AI_DIFFICULTY_LABELS,
  RANKED_SOLO_RULES,
  type AiDifficulty,
  type SoloMode,
} from "../shared/game/rules";
import { rulesSummary, scoringLabel } from "./format";
import { BoardDiagram } from "./ui/BoardDiagram";
import { boardAspectRatio } from "./ui/board-geometry";
import { PageShell } from "./ui/PageShell";
import "./setup-screen.css";

const EVEN_BOARD_SIZES = [4, 6, 8, 10, 12, 14, 16] as const;

type Scoring = "bbox" | "true";

export interface SetupScreenProps {
  soloMode: SoloMode;
  onSoloModeChange: (mode: SoloMode) => void;
  difficulty: AiDifficulty;
  onDifficultyChange: (difficulty: AiDifficulty) => void;
  width: number;
  height: number;
  onWidthChange: (width: number) => void;
  onHeightChange: (height: number) => void;
  scoring: Scoring;
  onScoringChange: (scoring: Scoring) => void;
  winScore: number;
  onWinScoreChange: (score: number) => void;
  bestCase: number;
  recommended: number;
  assistOn: boolean;
  onAssistChange: (on: boolean) => void;
  appVersion: string;
  onDone: () => void;
}

/** A radio group of pill choices for board dimensions. */
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
    soloMode,
    onSoloModeChange,
    difficulty,
    onDifficultyChange,
    width,
    height,
    onWidthChange,
    onHeightChange,
    scoring,
    onScoringChange,
    winScore,
    onWinScoreChange,
    bestCase,
    recommended,
    assistOn,
    onAssistChange,
    appVersion,
    onDone,
  } = props;
  const ranked = soloMode === "ranked";

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
            Redditor vs Euclid
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
                <li>Wins and losses change your rating</li>
              </ul>
            </div>
          </div>
        ) : (
          <div className="setup-practice">
            <div className="field setup-difficulty">
              <div className="setup-difficulty__label">
                <label className="field__label" htmlFor="setup-difficulty">
                  Euclid's difficulty
                </label>
                <output htmlFor="setup-difficulty">
                  {AI_DIFFICULTY_LABELS[difficulty]}
                </output>
              </div>
              <input
                id="setup-difficulty"
                className="setup-difficulty__slider"
                type="range"
                min={0}
                max={AI_DIFFICULTIES.length - 1}
                step={1}
                value={AI_DIFFICULTIES.indexOf(difficulty)}
                aria-valuetext={AI_DIFFICULTY_LABELS[difficulty]}
                onChange={(event) => {
                  const selected =
                    AI_DIFFICULTIES[event.currentTarget.valueAsNumber];
                  if (selected) onDifficultyChange(selected);
                }}
              />
              <div className="setup-difficulty__ticks" aria-hidden="true">
                {AI_DIFFICULTIES.map((level) => (
                  <span key={level} data-selected={level === difficulty} />
                ))}
              </div>
              <div className="setup-difficulty__ends" aria-hidden="true">
                <span>{AI_DIFFICULTY_LABELS[AI_DIFFICULTIES[0]]}</span>
                <span>
                  {
                    AI_DIFFICULTY_LABELS[
                      AI_DIFFICULTIES[AI_DIFFICULTIES.length - 1]!
                    ]
                  }
                </span>
              </div>
            </div>

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

      <section className="panel setup-about" aria-labelledby="setup-about">
        <h2 id="setup-about" className="panel__title">
          About Euclid
        </h2>
        <p className="muted">
          Euclid is a Reddit strategy game about placing pieces, completing
          squares and outscoring Euclid or another redditor. Straight and tilted
          squares both count, and one move can complete several at once.
        </p>
        <p className="field__hint">
          Version <span className="num">{appVersion}</span>
        </p>
      </section>
    </PageShell>
  );
}
