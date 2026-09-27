import {
  AI_DIFFICULTIES,
  AI_DIFFICULTY_LABELS,
  type AiDifficulty,
} from "../../shared/game/rules";
import "./difficulty-slider.css";

/** Euclid's practice difficulty as one slider with a tick for each level. */
export function DifficultySlider({
  id,
  value,
  onChange,
  className = "",
}: {
  id: string;
  value: AiDifficulty;
  onChange: (difficulty: AiDifficulty) => void;
  className?: string;
}) {
  const last = AI_DIFFICULTIES[AI_DIFFICULTIES.length - 1]!;
  return (
    <div className={`field difficulty-slider ${className}`}>
      <div className="difficulty-slider__label">
        <label className="field__label" htmlFor={id}>
          Euclid's difficulty
        </label>
        <output htmlFor={id}>{AI_DIFFICULTY_LABELS[value]}</output>
      </div>
      <input
        id={id}
        className="difficulty-slider__slider"
        type="range"
        min={0}
        max={AI_DIFFICULTIES.length - 1}
        step={1}
        value={AI_DIFFICULTIES.indexOf(value)}
        aria-valuetext={AI_DIFFICULTY_LABELS[value]}
        onChange={(event) => {
          const selected = AI_DIFFICULTIES[event.currentTarget.valueAsNumber];
          if (selected) onChange(selected);
        }}
      />
      <div className="difficulty-slider__ticks" aria-hidden="true">
        {AI_DIFFICULTIES.map((level) => (
          <span key={level} data-selected={level === value} />
        ))}
      </div>
      <div className="difficulty-slider__ends" aria-hidden="true">
        <span>{AI_DIFFICULTY_LABELS[AI_DIFFICULTIES[0]]}</span>
        <span>{AI_DIFFICULTY_LABELS[last]}</span>
      </div>
    </div>
  );
}
