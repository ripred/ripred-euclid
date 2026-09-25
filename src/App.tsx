import { useCallback, useEffect, useMemo, useState } from "react";

import { DemoScreen } from "./demo-screen";
import { rulesSummary } from "./format";
import { Board } from "./game/engine";
import {
  AI_DIFFICULTY_LABELS,
  RANKED_SOLO_RULES,
  type SoloMode,
} from "./game/rules";
import { resultPlayers } from "./game-results";
import {
  AssistToggle,
  Confetti,
  GameScreen,
  ResultDialog,
} from "./game-screen";
import { shouldRunVictoryEffects } from "./game-ui";
import { HomeScreen } from "./home-screen";
import {
  continuationPresentation,
  playEuclidSubtitle,
  recordPresentations,
} from "./home-ui";
import { HowToPlayDialog } from "./how-to-play";
import {
  scoreFeedbackForMove,
  type ScoreFeedbackEvent,
} from "./score-feedback";
import {
  DEFAULT_SETTINGS,
  practiceRules,
  restoreSettings,
  updatePractice,
  type PracticeSettings,
  type Settings,
  type ThemePreference,
} from "./settings";
import { SetupScreen } from "./setup-screen";
import {
  createSoundEngine,
  readSoundPreference,
  saveSoundPreference,
} from "./sound/engine";
import { SoundContext } from "./sound/use-sounds";
import {
  allowsHints,
  soloExitAction,
  soloResultPresentation,
} from "./solo/presentation";
import {
  EMPTY_RECORDS,
  restoreRecords,
  settleGame,
  type PlayerRecords,
} from "./solo/records";
import {
  abandonSoloGame,
  createSoloGame,
  isEuclidTurn,
  isHumanTurn,
  playEuclidMove,
  playHumanMove,
  restoreSoloGame,
  saveSoloGame,
  type SoloGame,
  type SoloMove,
} from "./solo/session";
import { readStored, removeStored, STORAGE_KEYS, writeStored } from "./storage";
import { followTheme } from "./theme";
import type { WashingStone } from "./ui/BoardDiagram";
import { ConfirmDialog } from "./ui/ConfirmDialog";
import { Icon } from "./ui/Icon";
import { useViewport } from "./ui/use-viewport";

type Screen = "home" | "setup" | "game" | "demo";
type Confirmation = "abandon" | "replace" | "reset";

/** Euclid's pause before moving, so its reply reads as a turn, not a glitch. */
const EUCLID_THINK_MS = 700;
/** How long each scoring moment holds before the next one shows. */
const FEEDBACK_MS = 2200;
/** Fading pieces: how long a washed-away stone takes to sink out of view. */
const WASH_MS = 800;
/** The wash is heard just after the move's piece lands. */
const WASH_SOUND_DELAY = 0.45;

const newGameId = () =>
  globalThis.crypto?.randomUUID?.() ??
  `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

const restoreTutorialSeen = (value: unknown) =>
  typeof value === "boolean" ? value : null;

function VersionStamp() {
  return (
    <div className="version-stamp" aria-hidden="true">
      v{__APP_VERSION__}
    </div>
  );
}

/** One sound control, placed in the game bar or floating elsewhere. */
function SoundToggle({
  on,
  onToggle,
  floating = false,
}: {
  on: boolean;
  onToggle: () => void;
  floating?: boolean;
}) {
  return (
    <button
      type="button"
      className={`icon-btn euclid-sound-toggle${floating ? " euclid-sound-toggle--floating" : ""}`}
      aria-label={on ? "Mute game sounds" : "Turn on game sounds"}
      aria-pressed={on}
      title={on ? "Mute game sounds" : "Turn on game sounds"}
      onClick={onToggle}
    >
      <Icon name={on ? "soundOn" : "soundOff"} />
    </button>
  );
}

export function App() {
  const viewport = useViewport();
  const [screen, setScreen] = useState<Screen>("home");
  const [settings, setSettings] = useState<Settings>(() =>
    readStored(STORAGE_KEYS.settings, restoreSettings, DEFAULT_SETTINGS),
  );
  const [records, setRecords] = useState<PlayerRecords>(() =>
    readStored(STORAGE_KEYS.records, restoreRecords, EMPTY_RECORDS),
  );
  const [game, setGame] = useState<SoloGame | null>(() =>
    readStored(STORAGE_KEYS.game, restoreSoloGame, null),
  );
  const [tutorialSeen, setTutorialSeen] = useState(() =>
    readStored(STORAGE_KEYS.tutorial, restoreTutorialSeen, false),
  );
  const [showTutorial, setShowTutorial] = useState(false);
  const [showRules, setShowRules] = useState(false);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [feedbackQueue, setFeedbackQueue] = useState<ScoreFeedbackEvent[]>([]);
  const [washing, setWashing] = useState<WashingStone[]>([]);

  /* ===== Persistence: every change is remembered on this device ===== */
  useEffect(() => writeStored(STORAGE_KEYS.settings, settings), [settings]);
  useEffect(() => writeStored(STORAGE_KEYS.records, records), [records]);
  useEffect(() => {
    // Only an unfinished game is worth resuming.
    if (game?.status === "active") {
      writeStored(STORAGE_KEYS.game, saveSoloGame(game));
    } else {
      removeStored(STORAGE_KEYS.game);
    }
  }, [game]);
  useEffect(() => followTheme(settings.theme), [settings.theme]);

  /* ===== Sound: off until the player asks, then remembered ===== */
  const sounds = useMemo(createSoundEngine, []);
  const [soundOn, setSoundOn] = useState(readSoundPreference);
  useEffect(() => sounds.setEnabled(soundOn), [sounds, soundOn]);
  useEffect(() => {
    if (!soundOn) return;
    // Browsers start audio suspended; the next gesture wakes it.
    const wake = () => sounds.unlock();
    window.addEventListener("pointerdown", wake, { once: true });
    window.addEventListener("keydown", wake, { once: true });
    return () => {
      window.removeEventListener("pointerdown", wake);
      window.removeEventListener("keydown", wake);
    };
  }, [sounds, soundOn]);
  const toggleSound = useCallback(() => {
    const next = !soundOn;
    sounds.unlock();
    sounds.setEnabled(next);
    saveSoundPreference(next);
    setSoundOn(next);
    if (next) sounds.place(1, "mine");
  }, [sounds, soundOn]);

  /* ===== Score feedback: one scoring moment at a time ===== */
  const activeFeedback = feedbackQueue[0] ?? null;
  useEffect(() => {
    if (!activeFeedback) return;
    const id = activeFeedback.id;
    const timer = window.setTimeout(
      () =>
        setFeedbackQueue((queue) =>
          queue[0]?.id === id ? queue.slice(1) : queue,
        ),
      FEEDBACK_MS,
    );
    return () => window.clearTimeout(timer);
  }, [activeFeedback]);

  const adoptMove = useCallback(
    (next: SoloGame, move: SoloMove) => {
      setGame(next);
      const feedback = scoreFeedbackForMove(next.id, move, next.board.scoring);
      if (feedback) setFeedbackQueue((queue) => [...queue, feedback]);
      if (move.washed.length > 0) {
        setWashing(
          move.washed.map((stone) => ({
            key: `${next.id}:${move.moveNumber}:${stone.index}`,
            x: stone.x,
            y: stone.y,
            owner: stone.owner,
          })),
        );
        sounds.wash(WASH_SOUND_DELAY);
      }
    },
    [sounds],
  );
  useEffect(() => {
    if (washing.length === 0) return;
    const timer = window.setTimeout(() => setWashing([]), WASH_MS);
    return () => window.clearTimeout(timer);
  }, [washing]);

  /* ===== Results: each finished game reaches the records exactly once ===== */
  useEffect(() => {
    if (!game || game.status === "active" || game.settled) return;
    const settled = settleGame(game, records);
    setGame(settled.game);
    setRecords(settled.records);
  }, [game, records]);

  /* ===== Euclid's turn ===== */
  const paused =
    screen !== "game" || showTutorial || showRules || confirmation !== null;
  useEffect(() => {
    if (!game || paused || !isEuclidTurn(game)) return;
    const timer = window.setTimeout(() => {
      const reply = playEuclidMove(game, Date.now());
      if (reply) adoptMove(reply.game, reply.move);
    }, EUCLID_THINK_MS);
    return () => window.clearTimeout(timer);
  }, [adoptMove, game, paused]);

  /* ===== Game lifecycle ===== */
  const openGame = useCallback(
    (next: SoloGame) => {
      setGame(next);
      setFeedbackQueue([]);
      setScreen("game");
      if (!tutorialSeen) setShowTutorial(true);
    },
    [tutorialSeen],
  );

  const startNewGame = useCallback(
    (mode: SoloMode = settings.soloMode) => {
      // Replacing an unfinished game ends it first, so a Ranked forfeit counts.
      if (game?.status === "active") {
        const ended = settleGame(abandonSoloGame(game, Date.now()), records);
        setRecords(ended.records);
      }
      const rules =
        mode === "ranked"
          ? RANKED_SOLO_RULES
          : practiceRules(settings.practice);
      openGame(createSoloGame(rules, { id: newGameId(), now: Date.now() }));
    },
    [game, openGame, records, settings.practice, settings.soloMode],
  );

  const requestNewGame = useCallback(() => {
    // A game with moves in it is never replaced without asking.
    if (game?.status === "active" && game.humanMoves > 0) {
      setConfirmation("replace");
      return;
    }
    startNewGame();
  }, [game, startNewGame]);

  const leaveGame = useCallback(() => {
    if (!game) {
      setScreen("home");
      return;
    }
    const exit = soloExitAction(game);
    if (exit.countsAsLoss) {
      setConfirmation("abandon");
      return;
    }
    if (game.status === "active") setGame(abandonSoloGame(game, Date.now()));
    setFeedbackQueue([]);
    setScreen("home");
  }, [game]);

  const confirm = useCallback(() => {
    const action = confirmation;
    setConfirmation(null);
    if (action === "reset") {
      setRecords(EMPTY_RECORDS);
    } else if (action === "replace") {
      startNewGame();
    } else if (action === "abandon" && game) {
      // The forfeit settles through the results effect and shows its result.
      setGame(abandonSoloGame(game, Date.now()));
    }
  }, [confirmation, game, startNewGame]);

  const completeTutorial = useCallback(() => {
    setShowTutorial(false);
    setTutorialSeen(true);
    writeStored(STORAGE_KEYS.tutorial, true);
  }, []);

  /* ===== Settings ===== */
  const changeSettings = (change: Partial<Settings>) =>
    setSettings((current) => ({ ...current, ...change }));
  const changePractice = (change: Partial<PracticeSettings>) =>
    setSettings((current) => ({
      ...current,
      practice: updatePractice(current.practice, change),
    }));
  const changeTheme = (theme: ThemePreference) => changeSettings({ theme });

  /* ===== Screens ===== */
  const hasRecords = records.ranked.games + records.practice.games > 0;
  const activeGame = game?.status === "active" ? game : null;
  let content: React.ReactElement;

  if (screen === "setup") {
    content = (
      <SetupScreen
        settings={settings}
        onSoloModeChange={(soloMode) => changeSettings({ soloMode })}
        onPracticeChange={changePractice}
        onAssistChange={(assist) => changeSettings({ assist })}
        onThemeChange={changeTheme}
        onResetRecords={hasRecords ? () => setConfirmation("reset") : undefined}
        appVersion={__APP_VERSION__}
        onDone={() => setScreen("home")}
      />
    );
  } else if (screen === "demo") {
    content = (
      <DemoScreen
        onPlay={activeGame ? () => openGame(activeGame) : requestNewGame}
        onDone={() => setScreen("home")}
      />
    );
  } else if (screen === "game" && game) {
    const board = Board.fromJSON(game.board);
    const presentation = soloResultPresentation(game);
    const humanFirst = game.rules.humanPlayer === 0;
    const difficulty = AI_DIFFICULTY_LABELS[game.rules.difficulty];
    const names: [string, string] = humanFirst
      ? ["You", "Euclid"]
      : ["Euclid", "You"];
    const hints = allowsHints(game.rules.mode);
    const thinking = !paused && isEuclidTurn(game);
    const ratingDelta = game.rating
      ? game.rating.after - game.rating.before
      : 0;
    const overlay =
      presentation.terminal && !activeFeedback ? (
        <>
          <Confetti
            show={shouldRunVictoryEffects(
              presentation.terminal,
              presentation.isLocalVictory,
            )}
          />
          <ResultDialog
            titleId="euclid-result-title"
            headline={presentation.headline}
            tone={
              presentation.isLocalVictory
                ? "win"
                : presentation.result === "loss"
                  ? "loss"
                  : "neutral"
            }
            detail={`${game.rules.mode === "ranked" ? "Ranked" : "Practice"} · ${rulesSummary(game.rules)}`}
            players={resultPlayers(board, names, presentation.winnerSide)}
            actions={
              <>
                <button
                  type="button"
                  autoFocus
                  className="btn btn--primary"
                  onClick={() => startNewGame(game.rules.mode)}
                >
                  <Icon name="refresh" size={18} />
                  Play again
                </button>
                {game.rules.mode === "practice" ? (
                  <button
                    type="button"
                    className="btn"
                    onClick={() => setScreen("setup")}
                  >
                    Change setup
                  </button>
                ) : null}
                <button
                  type="button"
                  className="btn btn--ghost"
                  onClick={() => setScreen("home")}
                >
                  Home
                </button>
              </>
            }
          >
            {game.rating && (
              <p className="result__rating num">
                Rating {game.rating.before} → {game.rating.after}
                <span
                  className={`result__rating-delta${ratingDelta < 0 ? " result__rating-delta--down" : ""}`}
                >
                  {ratingDelta >= 0 ? `+${ratingDelta}` : ratingDelta}
                </span>
              </p>
            )}
          </ResultDialog>
        </>
      ) : null;

    content = (
      <GameScreen
        exitLabel={soloExitAction(game).label}
        viewport={viewport}
        board={board}
        onCellClick={(x, y) => {
          if (paused || !isHumanTurn(game)) return;
          const played = playHumanMove(game, x, y, Date.now());
          if (played) adoptMove(played.game, played.move);
        }}
        onLeave={leaveGame}
        modeLabel={game.rules.mode === "ranked" ? "Ranked" : "Practice"}
        p1Name={names[0]}
        p2Name={names[1]}
        p1Tag={humanFirst ? undefined : difficulty}
        p2Tag={humanFirst ? difficulty : undefined}
        midText={presentation.headline}
        activeSide={
          presentation.terminal ? null : game.board.m_turn === 0 ? 1 : 2
        }
        placingSide={
          !paused && isHumanTurn(game) ? presentation.humanSide : null
        }
        thinking={thinking}
        overlay={overlay}
        assistOn={hints && settings.assist}
        myColor={presentation.humanSide}
        scoreFeedback={activeFeedback}
        futureScoreFeedback={feedbackQueue.slice(1)}
        washing={washing}
        onRules={() => setShowRules(true)}
        toolbar={
          <>
            {hints && !presentation.terminal && (
              <AssistToggle
                on={settings.assist}
                onToggle={() => changeSettings({ assist: !settings.assist })}
              />
            )}
            <SoundToggle on={soundOn} onToggle={toggleSound} />
          </>
        }
      />
    );
  } else {
    content = (
      <HomeScreen
        playEuclidSubtitle={playEuclidSubtitle(
          settings.soloMode,
          settings.practice.difficulty,
          settings.practice.fadeTurns,
        )}
        records={recordPresentations(records)}
        continuation={activeGame ? continuationPresentation(activeGame) : null}
        soloMode={settings.soloMode}
        onSoloModeChange={(soloMode) => changeSettings({ soloMode })}
        onPlayEuclid={requestNewGame}
        onContinue={() => activeGame && openGame(activeGame)}
        onWatchDemo={() => setScreen("demo")}
        onOptions={() => setScreen("setup")}
        onRules={() => setShowRules(true)}
      />
    );
  }

  const onGameScreen = screen === "game" && game !== null;
  const dialogOpen = showRules || showTutorial || confirmation !== null;

  return (
    <SoundContext.Provider value={sounds}>
      <VersionStamp />
      {content}
      {showRules && (
        <HowToPlayDialog
          variant="rules"
          fadeTurns={game && screen === "game" ? game.rules.fadeTurns : 0}
          onClose={() => setShowRules(false)}
        />
      )}
      {showTutorial && (
        <HowToPlayDialog variant="tutorial" onClose={completeTutorial} />
      )}
      {confirmation === "reset" && (
        <ConfirmDialog
          id="euclid-confirm-reset"
          title="Reset your records?"
          body="Your rating returns to 1,200 and every tally starts over. This cannot be undone."
          confirmLabel="Reset records"
          cancelLabel="Keep records"
          onConfirm={confirm}
          onCancel={() => setConfirmation(null)}
        />
      )}
      {(confirmation === "abandon" || confirmation === "replace") &&
        game &&
        (soloExitAction(game).countsAsLoss ? (
          <ConfirmDialog
            id="euclid-confirm-forfeit"
            title="Forfeit this Ranked game?"
            body="Leaving after your first move counts as a loss and lowers your rating."
            confirmLabel={
              confirmation === "replace" ? "Forfeit and start over" : "Forfeit"
            }
            onConfirm={confirm}
            onCancel={() => setConfirmation(null)}
          />
        ) : (
          <ConfirmDialog
            id="euclid-confirm-replace"
            title="Start a new game?"
            body="Your Practice game in progress will end. It is not counted in your records."
            confirmLabel="Start new game"
            onConfirm={confirm}
            onCancel={() => setConfirmation(null)}
          />
        ))}
      {!onGameScreen && !dialogOpen && (
        <SoundToggle floating on={soundOn} onToggle={toggleSound} />
      )}
    </SoundContext.Provider>
  );
}
