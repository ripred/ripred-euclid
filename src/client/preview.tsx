import "./index.css";
import "./preview.css";

import { requestExpandedMode } from "@devvit/web/client";
import { useEffect, useRef, useState, type MouseEvent } from "react";

import type { InitResponse } from "../shared/types/api";
import { rankedPresetLabel } from "./format";
import { DEMO_STEPS } from "./preview-demo";
import { PREVIEW_ONBOARDING_KEY, storeCompletion } from "./onboarding";
import { SharePreview } from "./share-preview";
import { buildReplayFrames, frameShapes } from "./share-replay-model";
import { ScoreChips } from "./share-replay";
import { fetchRankings, type LoadedRankings } from "./rankings-loader";
import { errorMessage } from "./error-message";
import type { ExpandedEntry } from "./expanded-entry";
import {
  applyThemeModeToDocument,
  installThemeModeSync,
  type ThemeMode,
} from "./theme";
import { BoardDiagram } from "./ui/BoardDiagram";
import {
  blockedSquares,
  boardAspectRatio,
  type BoardMarker,
} from "./ui/board-geometry";
import { Wordmark } from "./ui/Brand";
import {
  SplashCarousel,
  SplashChoices,
  ChallengeWinnerCard,
  type SplashSlideId,
  type SplashSlide,
} from "./splash-carousel";
import { useReducedMotion } from "./ui/use-reduced-motion";
import {
  EMPTY_CHALLENGE_SPOTLIGHTS,
  type ChallengeSpotlights,
} from "../shared/challenge-spotlights";
import { StandingsList } from "./ui/Standings";
import { buildWatchDemo } from "./watch-demo";

/* The recorded teaching game, replayed move by move. */
const DEMO_BOARD = buildWatchDemo();
const DEMO_FRAMES = buildReplayFrames(DEMO_BOARD);
const LAST_FRAME = DEMO_FRAMES.length - 1;
const POSTER_FRAME = DEMO_FRAMES[LAST_FRAME]!;
const STEP_AT_MOVE = new Map(
  DEMO_STEPS.map((step, index) => [step.after.moveNumber, index]),
);

/* Choreography: a poster, then quick moves between narrated beats. */
const INTRO_MS = 3200;
const FAST_MOVE_MS = 260;
const BEAT_ANTICIPATION_MS = 750;
const BEAT_HOLD_MS = 4200;
const FINAL_HOLD_MS = 2600;
const LEADERBOARD_IDLE_MS = 10000;
const LEADERBOARD_REFRESH_MS = 60_000;

type PreviewSurfaceMode = "intro" | "demo" | Exclude<SplashSlideId, "rules">;

export function PreviewStatus({
  title,
  body,
  onRetry,
}: {
  theme: ThemeMode;
  title: string;
  body: string;
  onRetry?: () => void;
}) {
  return (
    <div className="euclid-preview euclid-preview-status">
      <div className="panel preview-status">
        <Wordmark as="p" size="sm" />
        <p className="preview-status__title">{title}</p>
        <p className="euclid-preview-status-message">{body}</p>
        {onRetry && (
          <button type="button" className="btn" onClick={onRetry}>
            Try again
          </button>
        )}
      </div>
    </div>
  );
}

export function PreviewLeaderboard({
  rankings,
  rankingsLoading,
  rankingsError,
  onInteract,
}: {
  theme: ThemeMode;
  rankings: LoadedRankings;
  rankingsLoading: boolean;
  rankingsError: string | null;
  onInteract: () => void;
}) {
  const [bucket, setBucket] = useState<"hvh" | "hva">("hvh");
  const hasRows = rankings[bucket].length > 0;

  return (
    <div className="preview-standings">
      <div className="preview-standings__head">
        <p className="preview-panel__kicker">Leaderboard</p>
        <div
          className="seg preview-standings__tabs"
          role="group"
          aria-label="Leaderboard mode"
        >
          {(["hvh", "hva"] as const).map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={bucket === value}
              onClick={() => {
                setBucket(value);
                onInteract();
              }}
            >
              {value === "hvh" ? "vs Redditors" : "vs Euclid"}
            </button>
          ))}
        </div>
      </div>
      <p className="preview-panel__body">
        {bucket === "hvh"
          ? "Redditor vs Redditor matches."
          : `Ranked · ${rankedPresetLabel(rankings.hvaRules?.rules)}.`}
      </p>
      {rankings.preview && (
        <p className="splash-sample">
          Local preview · {rankings[bucket].length} sample players
        </p>
      )}
      {rankingsLoading && !hasRows ? (
        <p className="preview-panel__body">Loading leaderboard…</p>
      ) : rankingsError && !hasRows ? (
        <p className="preview-panel__body">
          Unable to load standings. Open the full leaderboard to retry.
        </p>
      ) : (
        <StandingsList
          rows={rankings[bucket]}
          label={bucket === "hvh" ? "Top redditors" : "Top ranked players"}
          limit={3}
          size="sm"
          empty="No entries yet. Be the first redditor to claim this board."
        />
      )}
    </div>
  );
}

function DemoCaption({
  surfaceMode,
  stepIndex,
}: {
  surfaceMode: PreviewSurfaceMode;
  stepIndex: number | null;
}) {
  const step = stepIndex === null ? null : DEMO_STEPS[stepIndex];
  return (
    <div className="preview-caption" aria-live="polite">
      <p className="preview-panel__kicker">
        {surfaceMode === "intro"
          ? "Reddit strategy game"
          : `How to play · ${Math.max(1, (stepIndex ?? 0) + 1)} of ${DEMO_STEPS.length}`}
      </p>
      <div className="preview-steps" aria-hidden="true">
        {DEMO_STEPS.map((demoStep, index) => (
          <span
            key={demoStep.id}
            className={
              stepIndex !== null && index <= stepIndex
                ? "preview-steps__pip preview-steps__pip--done"
                : "preview-steps__pip"
            }
          />
        ))}
      </div>
      <div key={step?.id ?? "intro"} className="preview-caption__copy">
        <p className="preview-caption__title">
          {step?.title ?? "A minute to learn. A lifetime to master."}
        </p>
        <p className="preview-panel__body">
          {step?.body ??
            "Place pieces. Close squares, tilted ones included. Outscore Euclid or another redditor."}
        </p>
      </div>
    </div>
  );
}

export const PreviewApp = () => {
  const [theme, setTheme] = useState<ThemeMode>("dark");
  const [initState, setInitState] = useState<InitResponse | null>(null);
  const [initError, setInitError] = useState<string | null>(null);
  const [initAttempt, setInitAttempt] = useState(0);
  const [expansionError, setExpansionError] = useState<string | null>(null);
  const [surfaceMode, setSurfaceMode] = useState<PreviewSurfaceMode>("intro");
  const [frameIndex, setFrameIndex] = useState(0);
  const [pendingBeat, setPendingBeat] = useState(false);
  const [stepIndex, setStepIndex] = useState<number | null>(null);
  const [rankings, setRankings] = useState<LoadedRankings>({
    hvh: [],
    hva: [],
  });
  const [rankingsLoading, setRankingsLoading] = useState(false);
  const [rankingsError, setRankingsError] = useState<string | null>(null);
  const [leaderboardActivityVersion, setLeaderboardActivityVersion] =
    useState(0);
  const [isDocumentVisible, setIsDocumentVisible] = useState(
    typeof document === "undefined"
      ? true
      : document.visibilityState === "visible",
  );
  const rankingsLoadedAtRef = useRef(0);
  const rankingsPendingRef = useRef(false);
  const [rankingsRefresh, setRankingsRefresh] = useState(0);
  const isPreviewActive = initState?.type === "init" && isDocumentVisible;
  const reducedMotion = useReducedMotion();
  const [pauseOverride, setPauseOverride] = useState<boolean | null>(null);
  const paused = pauseOverride ?? reducedMotion;
  const canAnimate = isPreviewActive && !paused;
  const [challenges, setChallenges] = useState<ChallengeSpotlights>(
    EMPTY_CHALLENGE_SPOTLIGHTS,
  );
  const activeSlide: SplashSlideId =
    surfaceMode === "intro" || surfaceMode === "demo" ? "rules" : surfaceMode;
  const slideIds: SplashSlideId[] = [
    "rules",
    "leaderboard",
    ...(challenges.daily ? ["daily" as const] : []),
    ...(challenges.weekly ? ["weekly" as const] : []),
    "play",
  ];
  const selectSlide = (id: SplashSlideId) => {
    setSurfaceMode(id === "rules" ? "intro" : id);
    setFrameIndex(0);
    setStepIndex(null);
    setPendingBeat(false);
    setLeaderboardActivityVersion((version) => version + 1);
  };

  useEffect(() => {
    if (initState?.type !== "init") return;
    const controller = new AbortController();
    void fetch("/api/challenge-spotlights", { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) return;
        const results = (await response.json()) as ChallengeSpotlights;
        if (!controller.signal.aborted) setChallenges(results);
      })
      .catch(() => {
        /* Standings and games remain available without spotlights. */
      });
    return () => controller.abort();
  }, [initState]);

  useEffect(() => {
    return installThemeModeSync((nextTheme) => {
      applyThemeModeToDocument(nextTheme);
      setTheme((current) => (current === nextTheme ? current : nextTheme));
    });
  }, []);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        setInitError(null);
        const response = await fetch("/api/init");
        const data = (await response.json()) as
          | InitResponse
          | { message?: string };
        if (!response.ok) {
          throw new Error(
            "message" in data
              ? data.message || "Unable to load Euclid."
              : "Unable to load Euclid.",
          );
        }
        if (!cancelled) setInitState(data as InitResponse);
      } catch (error: unknown) {
        if (!cancelled)
          setInitError(errorMessage(error, "Unable to load Euclid."));
      }
    };

    void load();

    return () => {
      cancelled = true;
    };
  }, [initAttempt]);

  useEffect(() => {
    const onVisibility = () =>
      setIsDocumentVisible(document.visibilityState === "visible");
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);

  useEffect(() => {
    if (!isPreviewActive) return;
    let cancelled = false;
    const controller = new AbortController();
    rankingsPendingRef.current = true;

    const loadRankings = async () => {
      if (!rankingsLoadedAtRef.current) setRankingsLoading(true);
      try {
        setRankingsError(null);
        const data = await fetchRankings(controller.signal);
        if (cancelled) return;
        setRankings(data);
      } catch (error: unknown) {
        if (!cancelled)
          setRankingsError(
            errorMessage(error, "Unable to load the leaderboard."),
          );
      } finally {
        if (!cancelled) {
          // Failed requests also back off until the next eligible preview cycle.
          rankingsLoadedAtRef.current = Date.now();
          rankingsPendingRef.current = false;
          setRankingsLoading(false);
        }
      }
    };
    void loadRankings();
    return () => {
      cancelled = true;
      controller.abort();
      rankingsPendingRef.current = false;
    };
  }, [isPreviewActive, rankingsRefresh]);

  useEffect(() => {
    // Screen transitions may request fresh standings, but never cancel a request.
    if (
      isPreviewActive &&
      surfaceMode === "leaderboard" &&
      !rankingsPendingRef.current &&
      rankingsLoadedAtRef.current &&
      Date.now() - rankingsLoadedAtRef.current >= LEADERBOARD_REFRESH_MS
    )
      setRankingsRefresh((version) => version + 1);
  }, [isPreviewActive, surfaceMode]);

  // Intro poster, then the demo from an empty board.
  useEffect(() => {
    if (surfaceMode !== "intro" || !canAnimate) return;
    const timer = window.setTimeout(() => {
      setFrameIndex(0);
      setStepIndex(null);
      setPendingBeat(false);
      setSurfaceMode("demo");
    }, INTRO_MS);
    return () => window.clearTimeout(timer);
  }, [canAnimate, surfaceMode]);

  // Demo: quick moves, and a pulse, landing and narrated hold for each lesson.
  useEffect(() => {
    if (surfaceMode !== "demo" || !canAnimate) return;
    let timer: number;
    if (frameIndex >= LAST_FRAME) {
      timer = window.setTimeout(() => {
        storeCompletion(PREVIEW_ONBOARDING_KEY);
        setSurfaceMode("leaderboard");
        setLeaderboardActivityVersion(0);
      }, FINAL_HOLD_MS);
      return () => window.clearTimeout(timer);
    }
    const next = DEMO_FRAMES[frameIndex + 1]!;
    const nextStep = STEP_AT_MOVE.get(next.moveNumber);
    if (pendingBeat) {
      timer = window.setTimeout(() => {
        setPendingBeat(false);
        setFrameIndex(frameIndex + 1);
        if (nextStep !== undefined) setStepIndex(nextStep);
      }, BEAT_ANTICIPATION_MS);
      return () => window.clearTimeout(timer);
    }
    const onLesson = STEP_AT_MOVE.has(DEMO_FRAMES[frameIndex]!.moveNumber);
    timer = window.setTimeout(
      () => {
        if (nextStep !== undefined) setPendingBeat(true);
        else setFrameIndex(frameIndex + 1);
      },
      onLesson ? BEAT_HOLD_MS : FAST_MOVE_MS,
    );
    return () => window.clearTimeout(timer);
  }, [frameIndex, canAnimate, pendingBeat, surfaceMode]);

  const nextSlide =
    slideIds[(slideIds.indexOf(activeSlide) + 1) % slideIds.length]!;
  useEffect(() => {
    if (activeSlide === "rules" || !canAnimate) return;
    const timer = window.setTimeout(() => {
      setSurfaceMode(nextSlide === "rules" ? "intro" : nextSlide);
      setFrameIndex(0);
      setStepIndex(null);
      setPendingBeat(false);
    }, LEADERBOARD_IDLE_MS);
    return () => window.clearTimeout(timer);
  }, [canAnimate, leaderboardActivityVersion, activeSlide, nextSlide]);

  const noteLeaderboardInteraction = () => {
    if (surfaceMode !== "leaderboard") return;
    setLeaderboardActivityVersion((current) => current + 1);
  };

  const openExpanded = (
    event: MouseEvent<HTMLButtonElement>,
    entry: ExpandedEntry,
  ) => {
    try {
      setExpansionError(null);
      void Promise.resolve(requestExpandedMode(event.nativeEvent, entry)).catch(
        () => {
          setExpansionError("Could not open. Please try again.");
        },
      );
    } catch {
      setExpansionError("Could not open. Please try again.");
    }
  };

  if (initError) {
    return (
      <PreviewStatus
        theme={theme}
        title="Unable to load Euclid"
        body={initError}
        onRetry={() => setInitAttempt((attempt) => attempt + 1)}
      />
    );
  }

  if (!initState) {
    return null;
  }

  const sharedPost = initState.type === "share" ? initState.share : null;
  if (sharedPost) {
    return (
      <SharePreview
        share={sharedPost}
        theme={theme}
        onExpand={(event) => requestExpandedMode(event.nativeEvent, "game")}
      />
    );
  }

  const frame =
    surfaceMode === "demo" ? DEMO_FRAMES[frameIndex]! : POSTER_FRAME;
  const shapes = frameShapes(frame);
  const lessonId =
    surfaceMode === "demo" &&
    stepIndex !== null &&
    STEP_AT_MOVE.get(frame.moveNumber) === stepIndex
      ? DEMO_STEPS[stepIndex]?.id
      : undefined;
  // The blocking lesson shows the square the move denied.
  const squares =
    lessonId === "block" && frame.move
      ? [
          ...shapes.squares,
          ...blockedSquares(
            frame.board,
            DEMO_BOARD.W,
            DEMO_BOARD.H,
            frame.move.x,
            frame.move.y,
            frame.move.owner === 1 ? 2 : 1,
          ).map((corners, index) => ({
            key: `blocked-${index}`,
            owner: (frame.move!.owner === 1 ? 2 : 1) as 1 | 2,
            tone: "blocked" as const,
            corners,
          })),
        ]
      : shapes.squares;
  const lastMarkers = shapes.markers;
  const next = DEMO_FRAMES[frameIndex + 1];
  const onLesson = STEP_AT_MOVE.has(frame.moveNumber);
  const markers: BoardMarker[] =
    surfaceMode !== "demo"
      ? []
      : pendingBeat && next?.move
        ? [
            {
              x: next.move.x,
              y: next.move.y,
              owner: next.move.owner,
              kind: "pending",
            },
          ]
        : onLesson
          ? lastMarkers
          : [];

  const slides: SplashSlide[] = [
    {
      id: "rules",
      title: "How to play",
      content: (
        <div className="preview">
          <div
            className="preview__board"
            style={{
              aspectRatio: boardAspectRatio(DEMO_BOARD.W, DEMO_BOARD.H),
            }}
          >
            <BoardDiagram
              width={DEMO_BOARD.W}
              height={DEMO_BOARD.H}
              cells={frame.board}
              squares={squares}
              markers={markers}
              arrivingIndex={
                surfaceMode === "demo" ? (frame.move?.index ?? null) : null
              }
              className={surfaceMode === "demo" ? "" : "board--poster"}
            />
          </div>
          <div className="preview__side">
            <div className="preview__brand">
              <ScoreChips scores={frame.scores} />
            </div>
            <div className="preview__panel">
              <DemoCaption
                surfaceMode={surfaceMode === "demo" ? "demo" : "intro"}
                stepIndex={stepIndex}
              />
            </div>
            <div className="preview__progress" aria-hidden="true">
              <span>
                {surfaceMode === "demo"
                  ? `Move ${frame.moveNumber} of ${LAST_FRAME}`
                  : `A full game in ${LAST_FRAME} moves`}
              </span>
              <span className="preview__progress-bar">
                <span
                  style={{
                    transform: `scaleX(${surfaceMode === "demo" ? frame.moveNumber / LAST_FRAME : 1})`,
                  }}
                />
              </span>
            </div>
          </div>
        </div>
      ),
    },
    {
      id: "leaderboard",
      title: "Leaderboard",
      content: (
        <div className="splash-standings-panel">
          <h2>The players to beat</h2>
          <PreviewLeaderboard
            theme={theme}
            rankings={rankings}
            rankingsLoading={rankingsLoading}
            rankingsError={rankingsError}
            onInteract={noteLeaderboardInteraction}
          />
        </div>
      ),
    },
  ];
  for (const period of ["daily", "weekly"] as const) {
    const winner = challenges[period];
    if (winner)
      slides.push({
        id: period,
        title: period === "daily" ? "Daily winner" : "Weekly winner",
        content: (
          <ChallengeWinnerCard
            period={period}
            winner={winner}
            preview={challenges.preview}
          />
        ),
      });
  }
  slides.push({
    id: "play",
    title: "Choose a game",
    content: <SplashChoices challenges={challenges} onExpand={openExpanded} />,
  });
  return (
    <div className="euclid-preview" data-demo-steps={DEMO_STEPS.length}>
      <SplashCarousel
        slides={slides}
        activeId={activeSlide}
        onSelect={selectSlide}
        paused={paused}
        onPause={setPauseOverride}
        onExpand={openExpanded}
        expansionError={expansionError}
      />
    </div>
  );
};
