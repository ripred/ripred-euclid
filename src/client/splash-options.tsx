import "./splash-options.css";
import { useEffect, useRef, useState } from "react";
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
 * Game options edited in the post itself. Everything here is kept in this
 * device's storage, which the full game reads when it opens, so nothing
 * needs the game to launch. Changes save as they are made.
 */
export function SplashOptions({ onClose }: { onClose: () => void }) {
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
      className="splash-options"
      role="dialog"
      aria-modal="true"
      aria-labelledby="splash-options-title"
      onKeyDown={(event) => {
        if (event.key === "Escape") onClose();
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
      <footer className="splash-footer">
        <p className="splash-sample">
          Saved on this device for your next Practice game. Ranked always uses
          the ranked rules.
        </p>
        <button className="btn btn--primary" onClick={onClose}>
          Done
        </button>
      </footer>
    </section>
  );
}
