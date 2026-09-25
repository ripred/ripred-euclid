import type { CSSProperties } from "react";

import "./level-slider.css";

/**
 * One horizontal slider over a fixed list of levels: a tick for each level,
 * and a label that rides above the thumb, naming the level as it moves. The
 * native range input keeps arrow, Home and End keys and screen readers.
 */
export function LevelSlider<T extends string | number>({
  id,
  label,
  options,
  value,
  onChange,
  format = String,
  hint,
}: {
  id: string;
  label: string;
  options: readonly T[];
  value: T;
  onChange: (value: T) => void;
  format?: (value: T) => string;
  hint?: string | undefined;
}) {
  const last = options.length - 1;
  const index = Math.max(0, options.indexOf(value));
  const level = last > 0 ? index / last : 0;
  const hintId = hint ? `${id}-hint` : undefined;

  return (
    <div
      className="field level-slider"
      style={{ "--level": level } as CSSProperties}
    >
      <label className="field__label" htmlFor={id}>
        {label}
      </label>
      <div className="level-slider__rail">
        <output
          className="level-slider__bubble"
          htmlFor={id}
          aria-hidden="true"
        >
          {format(value)}
        </output>
        <input
          id={id}
          className="level-slider__input"
          type="range"
          min={0}
          max={last}
          step={1}
          value={index}
          aria-valuetext={format(value)}
          aria-describedby={hintId}
          onChange={(event) => {
            const next = options[event.currentTarget.valueAsNumber];
            if (next !== undefined) onChange(next);
          }}
        />
        <div className="level-slider__ticks" aria-hidden="true">
          {options.map((option, position) => (
            <span
              key={String(option)}
              data-reached={position <= index || undefined}
            />
          ))}
        </div>
      </div>
      <div className="level-slider__ends" aria-hidden="true">
        <span>{format(options[0]!)}</span>
        <span>{format(options[last]!)}</span>
      </div>
      {hint ? (
        <p id={hintId} className="field__hint">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
