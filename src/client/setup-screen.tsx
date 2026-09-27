import {
  AI_DIFFICULTY_LABELS,
  RANKED_SOLO_RULES,
  STANDARD_BOARD,
  STANDARD_MAX_SCORE,
  STANDARD_WIN_SCORE,
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
  winScore: number;
  onWinScoreChange: (score: number) => void;
  assistOn: boolean;
  onAssistChange: (on: boolean) => void;
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
    winScore,
    onWinScoreChange,
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
            <RulesPreview label={rulesSummary(RANKED_SOLO_RULES)} />
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
            <DifficultySlider
              id="setup-difficulty"
              value={difficulty}
              onChange={onDifficultyChange}
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
                  max={STANDARD_MAX_SCORE}
                  value={winScore}
                  onChange={(event) =>
                    onWinScoreChange(
                      Math.max(
                        1,
                        Math.min(
                          STANDARD_MAX_SCORE,
                          Number(event.target.value) || 0,
                        ),
                      ),
                    )
                  }
                />
                <button
                  type="button"
                  className="btn btn--sm"
                  disabled={winScore === STANDARD_WIN_SCORE}
                  onClick={() => onWinScoreChange(STANDARD_WIN_SCORE)}
                >
                  Use standard {STANDARD_WIN_SCORE}
                </button>
              </div>
              <p className="field__hint">
                Standard games are first to {STANDARD_WIN_SCORE}. The most one
                player can score is {STANDARD_MAX_SCORE}.
              </p>
            </div>

            <Switch
              {...SQUARE_HINTS_COPY}
              checked={assistOn}
              onChange={onAssistChange}
            />
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
