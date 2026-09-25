import type { ExpandedAction } from "./expanded-entry";
import { ChallengeScreen } from "./challenge-screen";
import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type {
  H2HCanonicalState,
  H2HCancelQueueResponse,
  H2HChatResponse,
  H2HLeaveRequest,
  H2HLeaveResponse,
  H2HMappingResponse,
  InitResponse,
  H2HMoveResponse,
  H2HQueueResponse,
  H2HRematchResponse,
  H2HShareRequest,
  H2HStateResponse,
  ShareChatItem,
  ShareBucket,
  SharedPostPayload,
  SoloAbandonResponse,
  SoloMoveResponse,
  SoloSessionSnapshot,
  SoloShareResponse,
  SoloStartResponse,
  SoloStateResponse,
  UserStatsResponse,
} from "../shared/types/api";
import { Board, isBoardValid } from "../shared/game/engine";
import {
  AI_DIFFICULTY_LABELS,
  type AiDifficulty,
  type PlayerColor,
  type SoloMode,
} from "../shared/game/rules";
import { recommendedWinTarget, totalSquareScore } from "../shared/scoring";
import {
  getH2HExitAction,
  getH2HResultPresentation,
  isH2HChatAvailable,
  isH2HRematchAvailable,
  isH2HRematchRecovery,
  shouldAdoptH2HState,
  shouldPollH2HState,
  shouldProcessH2HPollSnapshot,
  shouldRunVictoryEffects,
  type H2HViewEndReason,
} from "./game-ui";
import { H2HChatTrigger, H2HRematchButton } from "./h2h-controls";
import { formatDisplayDate, rulesSummary } from "./format";
import { resultPlayers } from "./game-results";
import {
  AssistToggle,
  Confetti,
  GameScreen,
  NoticeDialog,
  ResultDialog,
} from "./game-screen";
import { HowToPlayDialog } from "./how-to-play";
import { RankingsScreen } from "./rankings-screen";
import { SetupScreen } from "./setup-screen";
import { PageShell } from "./ui/PageShell";
import { StandingsList } from "./ui/Standings";
import { trapDialogTab } from "./ui/focus";
import { Icon } from "./ui/Icon";
import {
  FULL_TUTORIAL_KEY,
  hasStoredCompletion,
  PREVIEW_ONBOARDING_KEY,
  shouldShowFullTutorial,
  storeCompletion,
} from "./onboarding";
import {
  applyThemeModeToDocument,
  installThemeModeSync,
  type ThemeMode,
} from "./theme";
import { ResultShareView } from "./share-preview";
import { fetchRankings, type LoadedRankings } from "./rankings-loader";
import { errorMessage } from "./error-message";
import {
  readPracticeDifficulty,
  savePracticeDifficulty,
} from "./solo-preferences";
import { isRecord } from "./fetch-json";
import { useLiveGames } from "./live-games";
import {
  WatchActions,
  WatchLobby,
  WatchReplay,
  WatchUnavailable,
} from "./watch-view";
import { captureWatchRecording, type WatchRecording } from "./watch-recording";
import {
  createPracticeSoloStartIntent,
  createRankedSoloStartIntent,
  createSoloAbandonIntent,
  createSoloMoveIntent,
  createSoloStartIntentKey,
  getOrCreateSoloStartCommand,
  getSoloAssistancePolicy,
  getSoloExitAction,
  getSoloResultPresentation,
  getSoloSharePresentation,
  isSoloHumanTurn,
  shouldAdoptSoloSnapshot,
} from "./solo-ui";
import { isFreshSoloGameplayKey } from "./solo-keyboard";
import {
  HomeScreen,
  HomeStatusScreen,
  type HomeBusyAction,
} from "./home-screen";
import {
  getH2HHomePresentation,
  getHomeRecordPresentations,
  getPlayEuclidSubtitle,
  getSoloContinuationPresentation,
  shouldLockHomeNavigation,
} from "./home-ui";
import {
  isCurrentH2HRequest,
  resolveQueueRecovery,
  type HomeQueueOperation,
} from "./home-lifecycle";
import {
  didH2HHistoryReset,
  normalizeSoloScoreFeedback,
  resolvePendingH2HScoreFeedback,
  scoreFeedbackFromH2HMove,
  scoreFeedbackFromH2HSnapshot,
  type ScoreFeedbackEvent,
} from "./score-feedback";
import {
  createSoundEngine,
  readSoundPreference,
  saveSoundPreference,
} from "./sound/engine";
import { SoundContext } from "./sound/use-sounds";

const HUMAN_VS_EUCLID_LABEL = "Redditor vs Euclid";
const EUCLID_LABEL = "Euclid";

/* ===== app version (tiny watermark) ===== */
const VersionStamp: React.FC<{ version?: string | undefined }> = ({
  version,
}) => (
  <div className="version-stamp" aria-hidden="true">
    {!version ? "loading" : version.startsWith("v") ? version : `v${version}`}
  </div>
);

/** One sound control, placed in the game bar or floating elsewhere. */
const SoundToggle: React.FC<{
  on: boolean;
  onToggle: () => void;
  floating?: boolean;
}> = ({ on, onToggle, floating = false }) => (
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

/* ===== Admin metrics types ===== */
type AdminMetrics = {
  uniques: Record<string, number>;
  counts: Record<string, number>;
  computed: Record<string, number>;
  aiDiffs: Record<string, number>;
  activeGames: number;
  rankedPlayers: { hvh: number; hva: number };
  daily: { dates: string[]; hvh: number[]; ai: Record<AiDifficulty, number[]> };
};

type ShareResponse = {
  ok?: boolean;
  message?: string;
  status?: SoloShareResponse["status"];
};

function reportRequestFailure(action: string, error: unknown): void {
  console.warn(`[Euclid] ${action} failed:`, error);
}

function isH2HMappingResponse(value: unknown): value is H2HMappingResponse {
  if (!isRecord(value) || value.ok !== true) return false;
  if (value.state === "idle" || value.state === "queued") {
    return value.gameId === null;
  }
  if (
    value.state !== "active" ||
    typeof value.gameId !== "string" ||
    typeof value.isPlayer1 !== "boolean" ||
    typeof value.canRematch !== "boolean" ||
    !isRecord(value.board)
  ) {
    return false;
  }
  return (
    Array.isArray(value.board.m_board) &&
    Array.isArray(value.board.m_players) &&
    value.board.m_players.length === 2 &&
    Array.isArray(value.board.m_history) &&
    typeof value.revision === "number" &&
    typeof value.ended === "boolean"
  );
}

async function requestH2HMapping(): Promise<H2HMappingResponse> {
  const response = await fetch("/api/h2h/mapping");
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok || !isH2HMappingResponse(payload)) {
    const message =
      isRecord(payload) && typeof payload.message === "string"
        ? payload.message
        : "Unable to load multiplayer status.";
    throw new Error(message);
  }
  return payload;
}

function createClientCommandId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

/* ===== App (UI + flows) ===== */
type Mode =
  | "challenge"
  | "ai"
  | "multiplayer"
  | "spectate"
  | "watch-demo"
  | "rankings"
  | "admin"
  | "options"
  | null;

type H2HFeedbackMode = "derive" | "force-derive" | "baseline";
type H2HMutation = "move" | "chat" | "leave" | "rematch";
type H2HClientState = H2HCanonicalState & { canRematch?: boolean };
type HomeDataSource = "presence" | "solo" | "stats";

interface ViewportSize {
  width: number;
  height: number;
}

const DEFAULT_VIEWPORT: ViewportSize = { width: 1024, height: 768 };

function readViewportSize(): ViewportSize {
  const visualViewport = window.visualViewport;
  return {
    width: Math.max(1, Math.floor(visualViewport?.width ?? window.innerWidth)),
    height: Math.max(
      1,
      Math.floor(visualViewport?.height ?? window.innerHeight),
    ),
  };
}

export const App = ({
  initialMode = null,
  initialAction = null,
}: {
  initialMode?: "rankings" | "spectate" | null;
  initialAction?: ExpandedAction | null;
} = {}) => {
  const pendingInitialAction = useRef(initialAction);
  const appliedThemeRef = useRef<ThemeMode | null>(null);
  const [watchTheme, setWatchTheme] = useState<ThemeMode>("light");
  const [initState, setInitState] = useState<InitResponse | null>(null);
  const [initError, setInitError] = useState("");
  const [mode, setMode] = useState<Mode>(initialMode);
  const [board, setBoard] = useState<Board | null>(null);
  const [watchRecording, setWatchRecording] = useState<WatchRecording | null>(
    null,
  );
  const [showWatchReplay, setShowWatchReplay] = useState(false);
  const [scoreFeedbackQueue, setScoreFeedbackQueue] = useState<
    ScoreFeedbackEvent[]
  >([]);
  const [h2hScoreFeedbackSettling, setH2HScoreFeedbackSettling] =
    useState(false);
  const scoreFeedbackSeenRef = useRef(new Set<string>());
  const h2hFeedbackStateRef = useRef<H2HCanonicalState | null>(null);
  const h2hDeferredFeedbackStateRef = useRef<H2HCanonicalState | null>(null);
  const activeScoreFeedback = scoreFeedbackQueue[0] ?? null;

  const enqueueScoreFeedback = useCallback(
    (events: readonly ScoreFeedbackEvent[]) => {
      const unseen = events.filter((event) => {
        if (scoreFeedbackSeenRef.current.has(event.id)) return false;
        scoreFeedbackSeenRef.current.add(event.id);
        return true;
      });
      if (unseen.length > 0) {
        setScoreFeedbackQueue((current) => [...current, ...unseen]);
      }
    },
    [],
  );

  const clearScoreFeedback = useCallback(() => {
    scoreFeedbackSeenRef.current = new Set<string>();
    h2hFeedbackStateRef.current = null;
    h2hDeferredFeedbackStateRef.current = null;
    setH2HScoreFeedbackSettling(false);
    setScoreFeedbackQueue([]);
  }, []);

  useEffect(() => {
    if (!activeScoreFeedback) return;
    const activeId = activeScoreFeedback.id;
    const timer = window.setTimeout(() => {
      setScoreFeedbackQueue((current) =>
        current[0]?.id === activeId ? current.slice(1) : current,
      );
    }, 2200);
    return () => window.clearTimeout(timer);
  }, [activeScoreFeedback]);

  // Remember practice preferences; ranked and resumed games use server rules.
  const [selectedDifficulty, setSelectedDifficulty] = useState<AiDifficulty>(
    readPracticeDifficulty,
  );
  useEffect(() => {
    savePracticeDifficulty(selectedDifficulty);
  }, [selectedDifficulty]);
  const [soloMode, setSoloMode] = useState<SoloMode>("practice");

  // Independent W/H (even); the setup screen owns the allowed sizes.
  const [boardW, setBoardW] = useState<number>(8);
  const [boardH, setBoardH] = useState<number>(8);

  const [scoringMode, setScoringMode] = useState<"bbox" | "true">("bbox");

  // Assist highlights toggle
  const [assistOn, setAssistOn] = useState<boolean>(false);

  // Setup guidance pairs the board's score ceiling with a target scaled from
  // the classic 8x8 first-to-150 game.
  const [bestCase, setBestCase] = useState<number>(0);
  const [recommended, setRecommended] = useState<number>(150);
  const [winScore, setWinScore] = useState<number>(150);
  const soloStartIntentKey = useMemo(
    () =>
      createSoloStartIntentKey(
        soloMode === "ranked"
          ? { mode: "ranked" }
          : {
              mode: "practice",
              rules: {
                W: boardW,
                H: boardH,
                scoring: scoringMode,
                winScore,
                difficulty: selectedDifficulty,
              },
            },
      ),
    [boardH, boardW, scoringMode, selectedDifficulty, soloMode, winScore],
  );

  const [status, setStatus] = useState<string>("");
  const [winner, setWinner] = useState<PlayerColor | null>(null);
  const [finalSide, setFinalSide] = useState<PlayerColor | null>(null);
  const [finalReason, setFinalReason] = useState<H2HViewEndReason>("");
  const [viewport, setViewport] = useState<ViewportSize>(DEFAULT_VIEWPORT);
  const [notice, setNotice] = useState<string>("");
  const [homeStats, setHomeStats] = useState<UserStatsResponse | null>(null);
  const [homeH2H, setHomeH2H] = useState<H2HMappingResponse>({
    ok: true,
    state: "idle",
    gameId: null,
  });
  const [homeSolo, setHomeSolo] = useState<SoloSessionSnapshot | null>(null);
  const [homePresenceLoading, setHomePresenceLoading] = useState(true);
  const [
    homePresenceReconciliationPending,
    setHomePresenceReconciliationPending,
  ] = useState(false);
  const [homeSoloLoading, setHomeSoloLoading] = useState(true);
  const [homeRecordsLoading, setHomeRecordsLoading] = useState(true);
  // The version retriggers the home probes even when batched state updates
  // collapse a failed transition back into the already-active home mode.
  const [homeRefreshVersion, setHomeRefreshVersion] = useState(0);
  const primeHomeRefresh = useCallback(() => {
    setHomePresenceLoading(true);
    setHomeSoloLoading(true);
    setHomeRecordsLoading(true);
  }, []);
  const beginHomeRefresh = useCallback(() => {
    primeHomeRefresh();
    setHomeRefreshVersion((version) => version + 1);
  }, [primeHomeRefresh]);
  const [homePresenceReady, setHomePresenceReady] = useState(false);
  const [homeActionError, setHomeActionError] = useState("");
  const [homeDataErrors, setHomeDataErrors] = useState<
    Partial<Record<HomeDataSource, string>>
  >({});
  const homeError = [homeActionError, ...Object.values(homeDataErrors)]
    .filter(
      (message, index, messages) =>
        Boolean(message) && messages.indexOf(message) === index,
    )
    .join(" ");
  const updateHomeDataError = useCallback(
    (source: HomeDataSource, message: string) => {
      setHomeDataErrors((current) => {
        const next = { ...current };
        if (message) next[source] = message;
        else delete next[source];
        return next;
      });
    },
    [],
  );
  const adoptHomeH2HPresence = useCallback(
    (presence: H2HMappingResponse) => {
      setHomeH2H(presence);
      setHomePresenceReady(true);
      setHomePresenceLoading(false);
      setHomePresenceReconciliationPending(false);
      updateHomeDataError("presence", "");
    },
    [updateHomeDataError],
  );
  const [homeStatus, setHomeStatus] = useState("");
  const returnHome = useCallback(() => {
    setHomeActionError("");
    setHomeStatus("");
    beginHomeRefresh();
    setMode(null);
  }, [beginHomeRefresh]);
  const [homeBusyAction, setHomeBusyAction] = useState<HomeBusyAction | null>(
    null,
  );
  const homeBusyActionRef = useRef<HomeBusyAction | null>(null);
  const [showRules, setShowRules] = useState(false);
  const [showTutorial, setShowTutorial] = useState(false);
  const [soloSnapshot, setSoloSnapshot] = useState<SoloSessionSnapshot | null>(
    null,
  );
  const soloSnapshotRef = useRef<SoloSessionSnapshot | null>(null);
  const soloGameIdRef = useRef<string | null>(null);
  const soloRevisionRef = useRef(0);
  const soloSessionRef = useRef(0);
  const soloStartCommandRef = useRef<{
    intentKey: string;
    commandId: string;
  } | null>(null);
  const soloMovePendingRef = useRef(false);
  const soloAbandonPendingRef = useRef(false);
  const [soloPending, setSoloPending] = useState<
    "starting" | "moving" | "abandoning" | null
  >(null);
  const soloShareCommandRef = useRef<{
    gameId: string;
    commandId: string;
  } | null>(null);
  const [shareBusy, setShareBusy] = useState<string | null>(null);
  const shareBusyRef = useRef<string | null>(null);
  const [sharedWins, setSharedWins] = useState({
    ai: false,
    multiplayer: false,
  });

  useEffect(() => {
    if (soloStartCommandRef.current?.intentKey !== soloStartIntentKey) {
      soloStartCommandRef.current = null;
    }
  }, [soloStartIntentKey]);

  // Chat (global overlay + data)
  const [chatOpen, setChatOpen] = useState(false);
  const [chatText, setChatText] = useState("");
  const [chatError, setChatError] = useState("");
  const chatTriggerRef = useRef<HTMLButtonElement>(null);
  const chatReturnFocusRef = useRef<HTMLElement | null>(null);
  const [localChat, setLocalChat] = useState<ShareChatItem[]>([]);
  const localSeqRef = useRef(0);

  // H2H state/polling
  const [, setGameId] = useState<string | null>(null);
  const gameIdRef = useRef<string | null>(null);
  const [isPlayer1, setIsPlayer1] = useState<boolean>(false);
  const isPlayer1Ref = useRef(false);
  const [spectating, setSpectating] = useState<boolean>(false);
  const spectatingRef = useRef(false);
  const pollRef = useRef<number | null>(null);
  const pollActiveRef = useRef<"none" | "mapping" | "state">("none");
  const gameRevisionRef = useRef(0);
  const [h2hMutation, setH2HMutation] = useState<H2HMutation | null>(null);
  const h2hMutationRef = useRef<H2HMutation | null>(null);
  const h2hRefreshPendingRef = useRef(false);
  const h2hMappingPendingRef = useRef(false);
  const h2hQueuePendingRef = useRef(false);
  const h2hSessionRef = useRef(0);
  const h2hRoundEpochRef = useRef(0);
  const [h2hCanRematch, setH2HCanRematch] = useState(true);
  const h2hCanRematchRef = useRef(true);
  useEffect(() => {
    isPlayer1Ref.current = isPlayer1;
  }, [isPlayer1]);
  useEffect(() => {
    spectatingRef.current = spectating;
  }, [spectating]);

  const chatBlockedByOverlay = showRules || showTutorial || notice !== "";
  const h2hChatAvailable =
    mode === "multiplayer" &&
    !chatBlockedByOverlay &&
    isH2HChatAvailable({
      hasGame: gameIdRef.current !== null,
      hasBoard: isBoardValid(board),
      spectating,
      endReason: finalReason,
    });
  const soloChatAvailable =
    mode === "ai" && !chatBlockedByOverlay && isBoardValid(board) && !winner;

  const closeChat = useCallback((restoreFocus = true) => {
    setChatOpen(false);
    setChatText("");
    setChatError("");
    const returnTarget = chatReturnFocusRef.current;
    chatReturnFocusRef.current = null;
    if (restoreFocus) {
      window.requestAnimationFrame(() => {
        if (
          returnTarget?.isConnected &&
          !returnTarget.matches(":disabled") &&
          !returnTarget.closest("[inert], [aria-hidden='true']")
        ) {
          returnTarget.focus();
          if (document.activeElement === returnTarget) return;
        }
        chatTriggerRef.current?.focus();
      });
    }
  }, []);

  const openChat = useCallback((): boolean => {
    if (
      (!h2hChatAvailable && !soloChatAvailable) ||
      h2hMutationRef.current !== null
    ) {
      return false;
    }
    setChatText("");
    setChatError("");
    chatReturnFocusRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    setChatOpen(true);
    return true;
  }, [h2hChatAvailable, soloChatAvailable]);

  useEffect(() => {
    if (!chatOpen) return;
    if (!h2hChatAvailable && !soloChatAvailable) closeChat(false);
  }, [chatOpen, closeChat, h2hChatAvailable, soloChatAvailable]);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);
  useEffect(
    () => () => {
      h2hSessionRef.current++;
      h2hMutationRef.current = null;
      h2hRefreshPendingRef.current = false;
      h2hMappingPendingRef.current = false;
      h2hQueuePendingRef.current = false;
      homeBusyActionRef.current = null;
      stopPolling();
      pollActiveRef.current = "none";
      soloSessionRef.current++;
      soloMovePendingRef.current = false;
      soloAbandonPendingRef.current = false;
    },
    [stopPolling],
  );

  // Sounds: off until the player asks, then remembered on this device.
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

  // Tutorial/onboarding
  const [tutorialCompletedThisSession, setTutorialCompletedThisSession] =
    useState(false);
  useEffect(() => {
    const previewOnboardingSeen = hasStoredCompletion(PREVIEW_ONBOARDING_KEY);
    const fullTutorialCompleted = hasStoredCompletion(FULL_TUTORIAL_KEY);
    setShowTutorial(
      shouldShowFullTutorial(
        mode,
        {
          previewDemoCompleted: previewOnboardingSeen,
          fullTutorialCompleted,
          completedThisSession: tutorialCompletedThisSession,
        },
        spectating,
      ),
    );
  }, [mode, spectating, tutorialCompletedThisSession]);

  const completeTutorial = useCallback(() => {
    setShowTutorial(false);
    setTutorialCompletedThisSession(true);
    storeCompletion(FULL_TUTORIAL_KEY);
  }, []);

  // window/theme basics
  useEffect(() => {
    const visualViewport = window.visualViewport;
    const onResize = () => {
      const nextViewport = readViewportSize();
      setViewport((current) =>
        current.width === nextViewport.width &&
        current.height === nextViewport.height
          ? current
          : nextViewport,
      );
    };
    onResize();
    window.addEventListener("resize", onResize);
    visualViewport?.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      visualViewport?.removeEventListener("resize", onResize);
    };
  }, []);
  useEffect(() => {
    return installThemeModeSync((nextTheme) => {
      if (appliedThemeRef.current === nextTheme) return;
      applyThemeModeToDocument(nextTheme);
      appliedThemeRef.current = nextTheme;
      setWatchTheme(nextTheme);
    });
  }, []);
  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const r = await fetch("/api/init");
        const j = (await r
          .json()
          .catch(() => ({ message: "Init failed." }))) as
          | InitResponse
          | { message?: string };
        if (!r.ok)
          throw new Error(
            "message" in j ? j.message || "Init failed." : "Init failed.",
          );
        if (!active) return;
        setInitState(j as InitResponse);
        setInitError("");
      } catch (e) {
        if (!active) return;
        setInitError(errorMessage(e, "Unable to start Euclid."));
      }
    })();
    return () => {
      active = false;
    };
  }, []);
  // Scale the recommended target from the 8×8 first-to-150 baseline.
  useEffect(() => {
    const W = boardW - (boardW % 2);
    const H = boardH - (boardH % 2);
    const cur = totalSquareScore(W, H, scoringMode);
    const rec = recommendedWinTarget(W, H, scoringMode);
    setBestCase(cur);
    setRecommended(rec);
    setWinScore(rec); // auto-adjust; user can override afterward
  }, [boardW, boardH, scoringMode]);

  const returnFromSolo = useCallback(() => {
    // Every solo exit changes the authoritative saved-game/record summary.
    // Refresh those home cards as part of the transition instead of relying
    // on each caller to remember a positional flag.
    setHomeActionError("");
    setHomeStatus("");
    beginHomeRefresh();
    soloSessionRef.current++;
    soloMovePendingRef.current = false;
    soloAbandonPendingRef.current = false;
    soloSnapshotRef.current = null;
    soloGameIdRef.current = null;
    soloRevisionRef.current = 0;
    soloShareCommandRef.current = null;
    setSoloSnapshot(null);
    setHomeSolo(null);
    setSoloPending(null);
    setBoard(null);
    setWinner(null);
    setLocalChat([]);
    setStatus("");
    setNotice("");
    setSharedWins((current) => ({ ...current, ai: false }));
    clearScoreFeedback();
    setMode(null);
  }, [beginHomeRefresh, clearScoreFeedback]);

  const adoptSoloSnapshot = useCallback(
    (snapshot: SoloSessionSnapshot): boolean => {
      const activeGameId = soloGameIdRef.current;
      if (
        activeGameId &&
        !shouldAdoptSoloSnapshot(
          activeGameId,
          soloRevisionRef.current,
          snapshot,
        )
      ) {
        return false;
      }

      if (soloShareCommandRef.current?.gameId !== snapshot.gameId) {
        soloShareCommandRef.current = null;
      }
      soloGameIdRef.current = snapshot.gameId;
      soloRevisionRef.current = snapshot.revision;
      soloSnapshotRef.current = snapshot;
      setSoloSnapshot(snapshot);
      setSoloMode(snapshot.mode);
      setBoard(Board.fromJSON(snapshot.board));
      const presentation = getSoloResultPresentation(snapshot);
      setWinner(presentation.winnerSide);
      setStatus("");
      setMode("ai");
      return true;
    },
    [],
  );

  const startSoloGame = useCallback(async (): Promise<boolean> => {
    const session = ++soloSessionRef.current;
    let startedSnapshot: SoloSessionSnapshot | null = null;
    clearScoreFeedback();
    const startCommand = getOrCreateSoloStartCommand(
      soloStartCommandRef.current,
      soloStartIntentKey,
      () => createClientCommandId("solo-start"),
    );
    soloStartCommandRef.current = startCommand;
    const { commandId } = startCommand;
    const request =
      soloMode === "ranked"
        ? createRankedSoloStartIntent(commandId)
        : createPracticeSoloStartIntent(
            {
              W: boardW,
              H: boardH,
              scoring: scoringMode,
              winScore,
              difficulty: selectedDifficulty,
            },
            commandId,
          );

    soloMovePendingRef.current = false;
    soloAbandonPendingRef.current = false;
    soloSnapshotRef.current = null;
    soloGameIdRef.current = null;
    soloRevisionRef.current = 0;
    soloShareCommandRef.current = null;
    setSoloSnapshot(null);
    setBoard(null);
    setWinner(null);
    setLocalChat([]);
    setNotice("");
    setStatus(
      soloMode === "ranked" ? "Starting Ranked…" : "Starting Practice…",
    );
    setSoloPending("starting");
    setMode("ai");

    void fetch("/api/metrics/ai-click", { method: "POST" }).catch((error) =>
      reportRequestFailure("recording the AI menu click", error),
    );

    try {
      const response = await fetch("/api/solo/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request),
      });
      const payload = (await response.json().catch(() => null)) as
        | SoloStartResponse
        | { message?: string }
        | null;
      if (soloSessionRef.current !== session) return false;
      if (!response.ok || !payload || !("snapshot" in payload)) {
        throw new Error(
          payload && "message" in payload && payload.message
            ? payload.message
            : "Unable to start the solo game.",
        );
      }

      startedSnapshot = payload.snapshot;
      soloGameIdRef.current = payload.snapshot.gameId;
      soloRevisionRef.current = 0;
      clearScoreFeedback();
      if (!adoptSoloSnapshot(payload.snapshot)) {
        throw new Error("Unable to adopt the started solo game.");
      }
      if (soloStartCommandRef.current?.commandId === commandId) {
        soloStartCommandRef.current = null;
      }
      enqueueScoreFeedback(
        normalizeSoloScoreFeedback(
          payload.snapshot.gameId,
          payload.events,
          payload.snapshot.board.scoring,
        ),
      );
      return true;
    } catch (error) {
      if (soloSessionRef.current !== session) return false;
      reportRequestFailure("starting the solo game", error);
      const message = errorMessage(error, "Unable to start the solo game.");
      returnFromSolo();
      setHomeSolo(startedSnapshot ?? homeSolo);
      setHomeActionError(message);
      return false;
    } finally {
      if (soloSessionRef.current === session) setSoloPending(null);
    }
  }, [
    adoptSoloSnapshot,
    boardH,
    boardW,
    returnFromSolo,
    clearScoreFeedback,
    enqueueScoreFeedback,
    homeSolo,
    scoringMode,
    selectedDifficulty,
    soloMode,
    soloStartIntentKey,
    winScore,
  ]);

  const submitSoloMove = useCallback(
    async (x: number, y: number): Promise<boolean> => {
      const snapshot = soloSnapshotRef.current;
      if (
        !snapshot ||
        !isSoloHumanTurn(snapshot) ||
        soloMovePendingRef.current ||
        soloAbandonPendingRef.current
      ) {
        return false;
      }

      const session = soloSessionRef.current;
      const gameId = snapshot.gameId;
      soloMovePendingRef.current = true;
      setSoloPending("moving");
      setNotice("");
      try {
        const response = await fetch("/api/solo/move", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(
            createSoloMoveIntent(
              snapshot,
              x,
              y,
              createClientCommandId("solo-move"),
            ),
          ),
        });
        const payload = (await response.json().catch(() => null)) as
          | SoloMoveResponse
          | { message?: string }
          | null;
        if (
          soloSessionRef.current !== session ||
          soloGameIdRef.current !== gameId
        ) {
          return false;
        }

        const adoptedSnapshot =
          payload && "snapshot" in payload
            ? adoptSoloSnapshot(payload.snapshot)
            : false;
        if (
          !response.ok ||
          !payload ||
          !("accepted" in payload) ||
          !payload.accepted
        ) {
          setNotice(
            payload && "message" in payload && payload.message
              ? payload.message
              : "The move was not accepted. The canonical board is shown.",
          );
          return false;
        }

        if (adoptedSnapshot) {
          enqueueScoreFeedback(
            normalizeSoloScoreFeedback(
              payload.snapshot.gameId,
              payload.events,
              payload.snapshot.board.scoring,
            ),
          );
        }
        return true;
      } catch (error) {
        if (
          soloSessionRef.current === session &&
          soloGameIdRef.current === gameId
        ) {
          reportRequestFailure("saving the solo move", error);
          setNotice(errorMessage(error, "The move could not be saved."));
        }
        return false;
      } finally {
        if (
          soloSessionRef.current === session &&
          soloGameIdRef.current === gameId
        ) {
          soloMovePendingRef.current = false;
          setSoloPending(null);
        }
      }
    },
    [adoptSoloSnapshot, enqueueScoreFeedback],
  );

  /* === H2H polling helpers === */
  const adoptH2HState = useCallback(
    (
      state: H2HClientState,
      feedbackMode: H2HFeedbackMode = "derive",
    ): boolean => {
      const revision = state.revision;
      if (
        !shouldAdoptH2HState(
          gameIdRef.current,
          gameRevisionRef.current,
          state.gameId,
          revision,
        )
      ) {
        return false;
      }

      const canRematch =
        state.ended && typeof state.canRematch === "boolean"
          ? state.canRematch
          : true;
      h2hCanRematchRef.current = canRematch;
      setH2HCanRematch(canRematch);

      const previousFeedbackState = h2hFeedbackStateRef.current;
      const holdFeedbackBaseline =
        feedbackMode === "derive" && h2hMutationRef.current === "move";
      const historyReset =
        !!previousFeedbackState &&
        previousFeedbackState.gameId === state.gameId &&
        didH2HHistoryReset(previousFeedbackState, state);
      if (
        !previousFeedbackState ||
        previousFeedbackState.gameId !== state.gameId ||
        historyReset
      ) {
        if (historyReset) {
          h2hRoundEpochRef.current++;
          setWinner(null);
          setFinalSide(null);
          setFinalReason("");
          setNotice("");
          setSharedWins((current) => ({ ...current, multiplayer: false }));
          closeChat(false);
        }
        clearScoreFeedback();
        h2hFeedbackStateRef.current = state;
      } else if (holdFeedbackBaseline) {
        // A poll can overtake a pending move response. Keep its newest
        // canonical snapshot so feedback for a following move is not lost.
        h2hDeferredFeedbackStateRef.current = state;
        setH2HScoreFeedbackSettling(true);
      } else {
        h2hDeferredFeedbackStateRef.current = null;
        h2hFeedbackStateRef.current = state;
        if (feedbackMode === "derive" || feedbackMode === "force-derive") {
          const feedback = scoreFeedbackFromH2HSnapshot(
            previousFeedbackState,
            state,
          );
          if (feedback) enqueueScoreFeedback([feedback]);
        }
      }

      gameRevisionRef.current = revision;
      setBoard(Board.fromJSON(state.board));

      if (!state.ended) return true;

      const endReason = state.endedReason || "game_over";
      let side: PlayerColor | null =
        endReason === "tie" ? null : (state.victorSide ?? null);
      if (!side && endReason === "game_over") {
        const firstScore = state.board.m_players[0]?.m_score ?? 0;
        const secondScore = state.board.m_players[1]?.m_score ?? 0;
        side =
          firstScore > secondScore ? 1 : secondScore > firstScore ? 2 : null;
      } else if (!side && endReason === "player_left" && state.endedBy) {
        const departedIndex = state.board.m_players.findIndex(
          (player) => player.userId === state.endedBy,
        );
        side = departedIndex === 0 ? 2 : departedIndex === 1 ? 1 : null;
      }
      setFinalSide(side);
      setFinalReason(endReason);
      if (spectatingRef.current) {
        setWatchRecording(captureWatchRecording(state, side));
      }
      if (endReason === "tie") setNotice("Tie game!");
      else if (
        spectatingRef.current &&
        (endReason === "opponent_left" || endReason === "player_left")
      )
        setNotice("A player left the game.");
      else if (endReason === "opponent_left")
        setNotice("The other redditor left — You Win!");
      else if (endReason === "player_left") {
        const localPlayerId =
          state.board.m_players[isPlayer1Ref.current ? 0 : 1]?.userId;
        setNotice(
          state.endedBy && state.endedBy === localPlayerId
            ? "You left the game."
            : "The other redditor left — You Win!",
        );
      }
      // Only a normal participant completion can transition into a rematch.
      // Spectators and departure results have no further canonical round to
      // observe, so polling them would waste requests indefinitely.
      if (
        !shouldPollH2HState({
          ended: state.ended,
          endReason,
          spectating: spectatingRef.current,
          canRematch,
        })
      ) {
        stopPolling();
        pollActiveRef.current = "none";
      }
      return true;
    },
    [clearScoreFeedback, closeChat, enqueueScoreFeedback, stopPolling],
  );

  const flushDeferredH2HScoreFeedback = useCallback(
    (
      gameId: string,
      session: number,
      submittedRoundEpoch: number,
      acceptedFeedback: ScoreFeedbackEvent | null,
    ) => {
      if (h2hSessionRef.current !== session || gameIdRef.current !== gameId) {
        return;
      }

      const deferredState = h2hDeferredFeedbackStateRef.current;
      h2hDeferredFeedbackStateRef.current = null;
      const resolution = resolvePendingH2HScoreFeedback({
        acceptedFeedback,
        submittedRoundEpoch,
        currentRoundEpoch: h2hRoundEpochRef.current,
        baseline: h2hFeedbackStateRef.current,
        deferred: deferredState?.gameId === gameId ? deferredState : null,
      });
      h2hFeedbackStateRef.current = resolution.baseline;
      setH2HScoreFeedbackSettling(false);
      enqueueScoreFeedback(resolution.events);
    },
    [enqueueScoreFeedback],
  );

  const refreshStateOnce = useCallback(async () => {
    const gid = gameIdRef.current;
    if (!gid || h2hRefreshPendingRef.current) return;
    const session = h2hSessionRef.current;
    h2hRefreshPendingRef.current = true;
    try {
      const r = await fetch(`/api/h2h/state?gameId=${encodeURIComponent(gid)}`);
      if (h2hSessionRef.current !== session || gameIdRef.current !== gid)
        return;
      if (r.status === 404 || r.status === 410) {
        setWatchRecording(null);
        setFinalReason("gone");
        setNotice("This game is no longer available.");
        setStatus("This game is no longer available.");
        stopPolling();
        pollActiveRef.current = "none";
        return;
      }
      const j = (await r.json().catch(() => null)) as
        | H2HStateResponse
        | { message?: string }
        | null;
      if (h2hSessionRef.current !== session || gameIdRef.current !== gid)
        return;
      if (!r.ok || !j || !("board" in j)) {
        throw new Error(
          j && "message" in j && j.message
            ? j.message
            : "Unable to refresh the multiplayer game.",
        );
      }
      if (
        !shouldProcessH2HPollSnapshot({
          activeGameId: gameIdRef.current,
          currentRevision: gameRevisionRef.current,
          currentCanRematch: h2hCanRematchRef.current,
          hasBaseline: h2hFeedbackStateRef.current?.gameId === gid,
          incoming: j,
        })
      ) {
        return;
      }
      adoptH2HState(j);
    } catch (error) {
      if (h2hSessionRef.current !== session || gameIdRef.current !== gid)
        return;
      reportRequestFailure("refreshing the multiplayer game", error);
      if (spectatingRef.current) {
        setStatus("Could not load the live game. Retrying…");
      }
    } finally {
      if (h2hSessionRef.current === session && gameIdRef.current === gid) {
        h2hRefreshPendingRef.current = false;
      }
    }
  }, [adoptH2HState, stopPolling]);

  const pollGame = useCallback(() => {
    if (pollActiveRef.current === "state") return;
    stopPolling();
    pollActiveRef.current = "state";
    pollRef.current = window.setInterval(() => {
      void refreshStateOnce();
    }, 1000);
  }, [refreshStateOnce, stopPolling]);

  const enterH2HGame = useCallback(
    (mapping: H2HMappingResponse | H2HQueueResponse): boolean => {
      if (!("gameId" in mapping) || !mapping.gameId || !("board" in mapping)) {
        return false;
      }
      const incomingRevision = mapping.revision;
      if (
        mapping.gameId === gameIdRef.current &&
        incomingRevision < gameRevisionRef.current
      ) {
        return true;
      }

      h2hSessionRef.current++;
      h2hMutationRef.current = null;
      setH2HMutation(null);
      h2hRefreshPendingRef.current = false;
      h2hMappingPendingRef.current = false;
      h2hQueuePendingRef.current = false;
      homeBusyActionRef.current = null;
      setHomeBusyAction(null);
      // Rules belongs to Home; automatic pairing must not carry the overlay
      // into the match or let it reappear on the next return.
      setShowRules(false);
      adoptHomeH2HPresence({ ...mapping, state: "active" });
      setGameId(mapping.gameId);
      gameIdRef.current = mapping.gameId;
      gameRevisionRef.current = incomingRevision;
      if (typeof mapping.isPlayer1 === "boolean") {
        isPlayer1Ref.current = mapping.isPlayer1;
        setIsPlayer1(mapping.isPlayer1);
      }
      spectatingRef.current = false;
      setSpectating(false);
      setMode("multiplayer");
      setStatus("");
      setHomeStatus("");
      setNotice("");
      closeChat(false);
      setWinner(null);
      setFinalSide(null);
      setFinalReason("");
      stopPolling();
      pollActiveRef.current = "none";
      adoptH2HState(mapping, "baseline");
      if (
        shouldPollH2HState({
          ended: mapping.ended,
          endReason: mapping.endedReason,
          spectating: false,
          canRematch: mapping.canRematch,
        })
      ) {
        pollGame();
      }
      return true;
    },
    [adoptH2HState, adoptHomeH2HPresence, closeChat, pollGame, stopPolling],
  );

  const pollMapping = useCallback(() => {
    if (pollActiveRef.current === "mapping") return;
    stopPolling();
    pollActiveRef.current = "mapping";
    pollRef.current = window.setInterval(() => {
      if (h2hMappingPendingRef.current) return;
      void (async () => {
        const session = h2hSessionRef.current;
        const request = { session };
        h2hMappingPendingRef.current = true;
        try {
          const j = await requestH2HMapping();
          if (!isCurrentH2HRequest(request, h2hSessionRef.current)) return;
          adoptHomeH2HPresence(j);
          setHomeActionError("");
          if (j.state === "active") {
            sounds.matchFound();
            if (!enterH2HGame(j)) {
              throw new Error("The multiplayer mapping has no board state.");
            }
          } else if (j.state === "queued") {
            setHomeStatus("Searching for another redditor…");
          } else {
            setHomeStatus("");
            stopPolling();
            pollActiveRef.current = "none";
          }
        } catch (error) {
          if (!isCurrentH2HRequest(request, h2hSessionRef.current)) return;
          reportRequestFailure("checking the multiplayer queue", error);
          setHomeActionError(
            errorMessage(error, "Unable to refresh the multiplayer queue."),
          );
        } finally {
          if (isCurrentH2HRequest(request, h2hSessionRef.current)) {
            h2hMappingPendingRef.current = false;
          }
        }
      })();
    }, 1000);
  }, [adoptHomeH2HPresence, enterH2HGame, sounds, stopPolling]);

  useEffect(() => {
    if (!initState || initState.type !== "init" || mode !== null) return;

    let active = true;
    const session = h2hSessionRef.current;
    primeHomeRefresh();
    setHomePresenceReady(false);
    setHomeDataErrors({});

    const loadActiveSolo = async (): Promise<SoloSessionSnapshot | null> => {
      const response = await fetch("/api/solo/active");
      if (response.status === 404) return null;
      const payload = (await response.json().catch(() => null)) as
        | (SoloStateResponse & { message?: string })
        | null;
      if (!response.ok || !payload?.snapshot) {
        throw new Error(payload?.message ?? "Unable to load your Ranked game.");
      }
      return payload.snapshot;
    };

    const loadStats = async (): Promise<UserStatsResponse> => {
      const response = await fetch("/api/user/stats");
      const payload = (await response.json().catch(() => null)) as
        | (UserStatsResponse & { message?: string })
        | null;
      if (!response.ok || !payload) {
        throw new Error(payload?.message ?? "Unable to load player records.");
      }
      return payload;
    };

    void requestH2HMapping()
      .then((mapping) => {
        if (!active || h2hSessionRef.current !== session) return;
        adoptHomeH2HPresence(mapping);
        if (mapping.state === "queued") {
          setHomeStatus("Searching for another redditor…");
          pollMapping();
        } else {
          setHomeStatus("");
        }
      })
      .catch((error) => {
        if (!active || h2hSessionRef.current !== session) return;
        reportRequestFailure("loading multiplayer presence", error);
        setHomePresenceReady(false);
        updateHomeDataError(
          "presence",
          "Multiplayer status could not be refreshed.",
        );
      })
      .finally(() => {
        if (active && h2hSessionRef.current === session) {
          setHomePresenceLoading(false);
        }
      });

    void loadActiveSolo()
      .then(
        (snapshot) => {
          if (!active) return;
          setHomeSolo(snapshot);
          updateHomeDataError("solo", "");
        },
        (error: unknown) => {
          if (!active) return;
          reportRequestFailure("loading the active Ranked game", error);
          updateHomeDataError(
            "solo",
            "Your Ranked game could not be refreshed.",
          );
        },
      )
      .finally(() => {
        if (active) setHomeSoloLoading(false);
      });

    void loadStats()
      .then(
        (stats) => {
          if (!active) return;
          setHomeStats(stats);
          updateHomeDataError("stats", "");
        },
        (error: unknown) => {
          if (!active) return;
          reportRequestFailure("loading player records", error);
          updateHomeDataError(
            "stats",
            "Player records could not be refreshed.",
          );
        },
      )
      .finally(() => {
        if (active) setHomeRecordsLoading(false);
      });

    return () => {
      active = false;
    };
  }, [
    adoptHomeH2HPresence,
    homeRefreshVersion,
    initState,
    mode,
    pollMapping,
    primeHomeRefresh,
    updateHomeDataError,
  ]);

  // Recover a multiplayer route that has lost its board snapshot by resuming
  // mapping polls; spectators instead rely on the selected game's own state.
  useEffect(() => {
    if (mode === "multiplayer" && !spectating && !isBoardValid(board)) {
      pollMapping();
    }
  }, [mode, board, pollMapping, spectating]);

  /* ===== Spectate list ===== */
  const liveGames = useLiveGames(
    initState?.type === "init" && mode === "spectate",
  );

  /* ===== Rankings ===== */
  const [rankings, setRankings] = useState<LoadedRankings>({
    hvh: [],
    hva: [],
  });
  const [rankingsLoaded, setRankingsLoaded] = useState(false);
  const [rankingsLoading, setRankingsLoading] = useState(false);
  const [rankingsError, setRankingsError] = useState("");
  const rankingsRequestRef = useRef(0);
  const rankingsAbortRef = useRef<AbortController | null>(null);
  const cancelRankings = useCallback(() => {
    // Aborted or late responses cannot update a different route or remount.
    rankingsRequestRef.current++;
    rankingsAbortRef.current?.abort();
    rankingsAbortRef.current = null;
  }, []);
  const loadRankings = useCallback(async () => {
    cancelRankings();
    const request = rankingsRequestRef.current;
    const controller = new AbortController();
    rankingsAbortRef.current = controller;
    setRankingsLoading(true);
    setRankingsError("");
    try {
      const j = await fetchRankings(controller.signal);
      if (rankingsRequestRef.current !== request) return;
      setRankings(j);
      setRankingsLoaded(true);
    } catch (error) {
      if (rankingsRequestRef.current !== request) return;
      reportRequestFailure("loading rankings", error);
      setRankingsError(errorMessage(error, "Unable to load the leaderboard."));
    } finally {
      if (rankingsRequestRef.current === request) {
        setRankingsLoading(false);
        rankingsAbortRef.current = null;
      }
    }
  }, [cancelRankings]);

  useEffect(() => {
    if (initState?.type !== "init" || mode !== "rankings") return;
    void loadRankings();
    return cancelRankings;
  }, [initState, mode, loadRankings, cancelRankings]);

  /* ===== Admin metrics ===== */
  const [admin, setAdmin] = useState<AdminMetrics | null>(null);
  const adminRequestRef = useRef(0);
  const loadAdmin = useCallback(async () => {
    const request = ++adminRequestRef.current;
    try {
      const r = await fetch("/api/admin/metrics");
      const j = (await r.json()) as AdminMetrics;
      if (adminRequestRef.current !== request) return;
      setAdmin(j);
    } catch (error) {
      if (adminRequestRef.current !== request) return;
      reportRequestFailure("loading admin metrics", error);
      setAdmin(null);
    }
  }, []);

  const clearMultiplayerState = ({
    nextMode = null,
    refreshHome = false,
  }: { nextMode?: Mode; refreshHome?: boolean } = {}) => {
    if (refreshHome) {
      setHomeActionError("");
      setHomeStatus("");
      beginHomeRefresh();
    }
    h2hSessionRef.current++;
    stopPolling();
    pollActiveRef.current = "none";
    setGameId(null);
    gameIdRef.current = null;
    gameRevisionRef.current = 0;
    h2hCanRematchRef.current = true;
    setH2HCanRematch(true);
    h2hMutationRef.current = null;
    setH2HMutation(null);
    h2hRefreshPendingRef.current = false;
    h2hMappingPendingRef.current = false;
    h2hQueuePendingRef.current = false;
    homeBusyActionRef.current = null;
    setHomeBusyAction(null);
    setHomeH2H({ ok: true, state: "idle", gameId: null });
    setHomePresenceReady(true);
    setHomePresenceReconciliationPending(false);
    setHomeStatus("");
    setIsPlayer1(false);
    isPlayer1Ref.current = false;
    spectatingRef.current = false;
    setSpectating(false);
    setBoard(null);
    setWatchRecording(null);
    setShowWatchReplay(false);
    setMode(nextMode);
    setStatus("");
    setNotice("");
    closeChat(false);
    setWinner(null);
    setFinalSide(null);
    setFinalReason("");
    setSharedWins((current) => ({ ...current, multiplayer: false }));
    clearScoreFeedback();
  };

  const applyQueueRecovery = (
    operation: HomeQueueOperation,
    mapping: H2HMappingResponse,
  ): boolean => {
    const decision = resolveQueueRecovery(operation, mapping.state);
    if (decision.clearActionError) setHomeActionError("");
    adoptHomeH2HPresence(mapping);

    if (decision.action === "enter") {
      const entered = enterH2HGame(mapping);
      return decision.operationCompleted && entered;
    }
    if (decision.action === "poll") {
      setHomeStatus(decision.status);
      pollMapping();
      return decision.operationCompleted;
    }
    if (decision.operationCompleted) {
      clearMultiplayerState();
      setHomeActionError("");
    }
    setHomeStatus(decision.status);
    return decision.operationCompleted;
  };

  const cancelMultiplayerQueue = async (): Promise<boolean> => {
    if (homeBusyActionRef.current || h2hQueuePendingRef.current) return false;
    const session = ++h2hSessionRef.current;
    h2hQueuePendingRef.current = true;
    homeBusyActionRef.current = "h2h";
    setHomeBusyAction("h2h");
    h2hMutationRef.current = null;
    setH2HMutation(null);
    h2hRefreshPendingRef.current = false;
    h2hMappingPendingRef.current = false;
    stopPolling();
    pollActiveRef.current = "none";
    try {
      const response = await fetch("/api/h2h/cancelQueue", { method: "POST" });
      const payload = (await response.json().catch(() => null)) as
        | (H2HCancelQueueResponse & { message?: string })
        | null;
      if (h2hSessionRef.current !== session) return false;
      if (!response.ok || !payload) {
        throw new Error(
          payload?.message ?? "Unable to cancel the multiplayer queue.",
        );
      }

      // A cancellation can race a pairing. Confirm the authoritative presence
      // before treating the user as idle or allowing another game to start.
      const mapping = await requestH2HMapping();
      if (h2hSessionRef.current !== session) return false;
      return applyQueueRecovery("cancel", mapping);
    } catch (error) {
      if (h2hSessionRef.current !== session) return false;
      reportRequestFailure("canceling the multiplayer queue", error);
      const message = errorMessage(
        error,
        "Unable to cancel the multiplayer queue.",
      );
      setHomeActionError(message);
      setHomeStatus("");
      try {
        const mapping = await requestH2HMapping();
        if (h2hSessionRef.current !== session) return false;
        return applyQueueRecovery("cancel", mapping);
      } catch (refreshError) {
        reportRequestFailure(
          "refreshing multiplayer status after cancellation",
          refreshError,
        );
        if (h2hSessionRef.current === session) pollMapping();
      }
      return false;
    } finally {
      if (h2hSessionRef.current === session) {
        h2hQueuePendingRef.current = false;
        homeBusyActionRef.current = null;
        setHomeBusyAction(null);
      }
    }
  };

  const startMultiplayerQueue = async (): Promise<boolean> => {
    if (homeBusyActionRef.current || h2hQueuePendingRef.current) return false;

    const session = ++h2hSessionRef.current;
    homeBusyActionRef.current = "h2h";
    h2hQueuePendingRef.current = true;
    setHomeBusyAction("h2h");
    setHomePresenceLoading(false);
    setHomeActionError("");
    setHomeStatus("Joining the matchmaking queue…");
    stopPolling();
    pollActiveRef.current = "none";
    h2hMutationRef.current = null;
    setH2HMutation(null);
    h2hRefreshPendingRef.current = false;
    h2hMappingPendingRef.current = false;
    setGameId(null);
    gameIdRef.current = null;
    gameRevisionRef.current = 0;
    setBoard(null);
    isPlayer1Ref.current = false;
    setIsPlayer1(false);
    spectatingRef.current = false;
    setSpectating(false);
    setWinner(null);
    setFinalSide(null);
    setFinalReason("");
    setNotice("");

    try {
      const response = await fetch("/api/h2h/queue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const payload = (await response.json().catch(() => null)) as
        | (H2HQueueResponse & { message?: string })
        | null;
      if (h2hSessionRef.current !== session) return false;
      if (!response.ok || !payload) {
        throw new Error(
          payload?.message ?? "Unable to join the multiplayer queue.",
        );
      }
      if (enterH2HGame(payload)) {
        sounds.matchFound();
        return true;
      }
      if (payload.state !== "queued") {
        throw new Error("The match response has no board state.");
      }

      adoptHomeH2HPresence({
        ok: true,
        state: "queued",
        gameId: null,
      });
      setHomeStatus("Searching for another redditor…");
      pollMapping();
      return true;
    } catch (error) {
      if (h2hSessionRef.current !== session) return false;
      reportRequestFailure("joining the multiplayer queue", error);
      const message = errorMessage(error, "Unable to join matchmaking.");
      setHomeActionError(message);
      setHomeStatus("");
      try {
        const mapping = await requestH2HMapping();
        if (h2hSessionRef.current !== session) return false;
        return applyQueueRecovery("join", mapping);
      } catch (refreshError) {
        if (h2hSessionRef.current !== session) return false;
        reportRequestFailure(
          "refreshing multiplayer status after queue failure",
          refreshError,
        );
        // The queue request may have committed even though neither response
        // arrived. Treat presence as unknown and keep reconciling instead of
        // exposing the previous idle cache as permission to start another game.
        setHomePresenceReady(false);
        setHomePresenceLoading(true);
        setHomePresenceReconciliationPending(true);
        updateHomeDataError(
          "presence",
          "Matchmaking status is still being confirmed.",
        );
        setHomeStatus("Confirming matchmaking status…");
        pollMapping();
      }
      return false;
    } finally {
      if (h2hSessionRef.current === session) {
        h2hQueuePendingRef.current = false;
        homeBusyActionRef.current = null;
        setHomeBusyAction(null);
      }
    }
  };

  const stopHomePresenceMonitoring = useCallback(() => {
    // Invalidate in-flight mapping reads before another route can be entered
    // by a late pairing response. Release its guard here because the stale
    // request's session check intentionally prevents its own cleanup.
    h2hSessionRef.current++;
    h2hMappingPendingRef.current = false;
    setShowRules(false);
    stopPolling();
    pollActiveRef.current = "none";
  }, [stopPolling]);

  const confirmSoloCanStart = async (): Promise<boolean> => {
    if (homePresenceReady) return homeH2H.state !== "queued";

    const session = h2hSessionRef.current;
    try {
      const mapping = await requestH2HMapping();
      if (h2hSessionRef.current !== session) return false;
      adoptHomeH2HPresence(mapping);
      if (mapping.state === "queued") {
        setHomeStatus("Searching for another redditor…");
        pollMapping();
        return false;
      }
      return true;
    } catch (error) {
      if (h2hSessionRef.current !== session) return false;
      reportRequestFailure("confirming multiplayer presence", error);
      setHomeStatus("");
      updateHomeDataError(
        "presence",
        "Multiplayer status must be refreshed before opening a solo game.",
      );
      return false;
    }
  };

  const startSoloFromHome = async (): Promise<boolean> => {
    if (homeBusyActionRef.current || homeH2H.state === "queued") return false;

    homeBusyActionRef.current = "solo";
    setHomeBusyAction("solo");
    setHomeActionError("");
    setHomeStatus("");
    try {
      if (!(await confirmSoloCanStart())) return false;
      stopHomePresenceMonitoring();
      return await startSoloGame();
    } finally {
      if (homeBusyActionRef.current === "solo") {
        homeBusyActionRef.current = null;
        setHomeBusyAction(null);
      }
    }
  };

  useEffect(() => {
    if (mode !== null) pendingInitialAction.current = null;
    if (
      !pendingInitialAction.current ||
      initState?.type !== "init" ||
      mode !== null ||
      homePresenceLoading ||
      homeSoloLoading ||
      !homePresenceReady ||
      homePresenceReconciliationPending ||
      homeBusyActionRef.current
    )
      return;
    const action = pendingInitialAction.current;
    pendingInitialAction.current = null;
    // An existing match, queue, or unresolved solo lookup requires the home controls.
    if (homeH2H.state !== "idle" || homeDataErrors.solo) return;
    if (action === "reddit") void startMultiplayerQueue();
    else if (homeSolo) void continueSoloFromHome();
    else void startSoloFromHome();
  });

  const continueSoloFromHome = async (): Promise<boolean> => {
    const cached = homeSolo;
    if (!cached || homeBusyActionRef.current || homeH2H.state === "queued") {
      return false;
    }

    const session = ++soloSessionRef.current;
    homeBusyActionRef.current = "solo-continuation";
    setHomeBusyAction("solo-continuation");
    setHomeActionError("");
    setHomeStatus("Refreshing your Ranked game…");
    try {
      if (!(await confirmSoloCanStart())) return false;
      stopHomePresenceMonitoring();
      const response = await fetch(
        `/api/solo/state?gameId=${encodeURIComponent(cached.gameId)}`,
      );
      if (response.status === 404 || response.status === 410) {
        if (soloSessionRef.current !== session) return false;
        setHomeSolo(null);
        setHomeStatus("That Ranked game is no longer available.");
        return false;
      }
      const payload = (await response.json().catch(() => null)) as
        | (SoloStateResponse & { message?: string })
        | null;
      if (soloSessionRef.current !== session) return false;
      if (!response.ok || !payload?.snapshot) {
        throw new Error(payload?.message ?? "Unable to refresh the game.");
      }

      soloGameIdRef.current = payload.snapshot.gameId;
      soloRevisionRef.current = 0;
      if (!adoptSoloSnapshot(payload.snapshot)) {
        throw new Error("Unable to open the refreshed Ranked game.");
      }
      setHomeStatus("");
      return true;
    } catch (error) {
      if (soloSessionRef.current !== session) return false;
      reportRequestFailure("continuing the Ranked game", error);
      setHomeStatus("");
      setHomeActionError(
        errorMessage(error, "Unable to continue the Ranked game."),
      );
      return false;
    } finally {
      if (soloSessionRef.current === session) {
        homeBusyActionRef.current = null;
        setHomeBusyAction(null);
      }
    }
  };

  const continueH2HFromHome = async (): Promise<boolean> => {
    if (homeH2H.state !== "active" || homeBusyActionRef.current) return false;

    const session = ++h2hSessionRef.current;
    homeBusyActionRef.current = "h2h-continuation";
    setHomeBusyAction("h2h-continuation");
    setHomeActionError("");
    setHomeStatus("Refreshing your Redditor match…");
    stopPolling();
    pollActiveRef.current = "none";
    try {
      const mapping = await requestH2HMapping();
      if (h2hSessionRef.current !== session) return false;
      adoptHomeH2HPresence(mapping);
      if (mapping.state === "active") {
        return enterH2HGame(mapping);
      }
      if (mapping.state === "queued") {
        setHomeStatus("Searching for another redditor…");
        pollMapping();
      } else {
        setHomeStatus("That Redditor match is no longer available.");
      }
      return false;
    } catch (error) {
      if (h2hSessionRef.current !== session) return false;
      reportRequestFailure("continuing the Redditor match", error);
      setHomeStatus("");
      setHomeActionError(
        errorMessage(error, "Unable to continue the Redditor match."),
      );
      return false;
    } finally {
      if (h2hSessionRef.current === session) {
        homeBusyActionRef.current = null;
        setHomeBusyAction(null);
      }
    }
  };

  const requestH2HRematch = useCallback(async (): Promise<boolean> => {
    const gameId = gameIdRef.current;
    if (
      !gameId ||
      spectatingRef.current ||
      h2hMutationRef.current !== null ||
      shareBusyRef.current === "multiplayer"
    ) {
      return false;
    }

    const expectedRevision = gameRevisionRef.current;
    const session = h2hSessionRef.current;
    const request = { session, gameId };
    h2hMutationRef.current = "rematch";
    setH2HMutation("rematch");
    setNotice("");

    try {
      const response = await fetch("/api/h2h/rematch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ gameId, expectedRevision }),
      });
      const payload = (await response.json().catch(() => null)) as
        | H2HRematchResponse
        | (H2HCanonicalState & { ok: false; message?: string })
        | { ok?: false; message?: string }
        | null;
      if (
        !isCurrentH2HRequest(request, h2hSessionRef.current, gameIdRef.current)
      ) {
        return false;
      }

      if (payload && "board" in payload) {
        const recovered = isH2HRematchRecovery(
          gameId,
          expectedRevision,
          payload,
        );
        const adopted = adoptH2HState(payload, "baseline");
        if (adopted && (response.ok || recovered)) {
          pollGame();
          return true;
        }
      }

      throw new Error(
        payload && "message" in payload && payload.message
          ? payload.message
          : "The rematch could not be started.",
      );
    } catch (error) {
      if (
        !isCurrentH2HRequest(request, h2hSessionRef.current, gameIdRef.current)
      ) {
        return false;
      }

      // A lost response or simultaneous click can still have committed the
      // rematch. Reconcile once before presenting a failure to the player.
      await refreshStateOnce();
      const current = h2hFeedbackStateRef.current;
      if (current && isH2HRematchRecovery(gameId, expectedRevision, current)) {
        pollGame();
        return true;
      }

      reportRequestFailure("starting a multiplayer rematch", error);
      setNotice(errorMessage(error, "The rematch could not be started."));
      return false;
    } finally {
      if (
        isCurrentH2HRequest(request, h2hSessionRef.current, gameIdRef.current)
      ) {
        h2hMutationRef.current = null;
        setH2HMutation(null);
      }
    }
  }, [adoptH2HState, pollGame, refreshStateOnce]);

  const leaveMultiplayer = async (
    intent: H2HLeaveRequest["intent"] = "leave",
  ): Promise<boolean> => {
    const gameId = gameIdRef.current;
    if (
      !gameId ||
      h2hMutationRef.current !== null ||
      shareBusyRef.current === "multiplayer"
    ) {
      return false;
    }
    const expectedRevision = gameRevisionRef.current;
    const session = ++h2hSessionRef.current;
    const request = { session, gameId };
    h2hMutationRef.current = "leave";
    setH2HMutation("leave");
    h2hRefreshPendingRef.current = false;
    h2hMappingPendingRef.current = false;
    stopPolling();
    pollActiveRef.current = "none";
    try {
      const response = await fetch("/api/h2h/leave", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ gameId, expectedRevision, intent }),
      });
      const payload = (await response.json().catch(() => null)) as
        | H2HLeaveResponse
        | (H2HClientState & { ok: false; message?: string })
        | { message?: string }
        | null;
      if (
        !isCurrentH2HRequest(request, h2hSessionRef.current, gameIdRef.current)
      ) {
        return false;
      }
      if (!response.ok) {
        const hasCanonicalSnapshot = !!payload && "board" in payload;
        if (hasCanonicalSnapshot) adoptH2HState(payload, "baseline");
        throw new Error(
          payload && "message" in payload && payload.message
            ? payload.message
            : "Unable to leave the multiplayer game.",
        );
      }
    } catch (error) {
      if (
        !isCurrentH2HRequest(request, h2hSessionRef.current, gameIdRef.current)
      ) {
        return false;
      }
      reportRequestFailure("leaving the multiplayer game", error);
      setNotice(errorMessage(error, "Unable to leave the multiplayer game."));
      void refreshStateOnce();
      pollGame();
      return false;
    } finally {
      if (
        isCurrentH2HRequest(request, h2hSessionRef.current, gameIdRef.current)
      ) {
        h2hMutationRef.current = null;
        setH2HMutation(null);
      }
    }
    clearMultiplayerState({ refreshHome: true });
    return true;
  };

  const stopWatching = () => {
    clearMultiplayerState({ nextMode: "spectate" });
  };

  const watchGame = (gameId: string) => {
    // Starting a spectator session invalidates pending reads from the old one.
    // It deliberately sends no join, leave or result-close command.
    clearMultiplayerState({ nextMode: "multiplayer" });
    setGameId(gameId);
    gameIdRef.current = gameId;
    spectatingRef.current = true;
    setSpectating(true);
    setStatus("Loading live game…");
    void refreshStateOnce();
    pollGame();
  };

  const watchDemo = () => {
    clearMultiplayerState({ nextMode: "watch-demo" });
  };

  const playFromWatch = () => {
    if (spectatingRef.current) clearMultiplayerState({ refreshHome: true });
    else returnHome();
  };

  const exitSoloGame = async (): Promise<boolean> => {
    if (shareBusyRef.current === "ai") return false;
    const snapshot = soloSnapshotRef.current;
    if (!snapshot) {
      returnFromSolo();
      return true;
    }

    const exitAction = getSoloExitAction(snapshot);
    if (!exitAction.notifyServer) {
      returnFromSolo();
      return true;
    }
    if (
      exitAction.countsAsLoss &&
      !window.confirm(
        "Abandon this Ranked game? This will be recorded as a loss.",
      )
    ) {
      return false;
    }
    if (soloAbandonPendingRef.current || soloMovePendingRef.current) {
      return false;
    }

    const session = soloSessionRef.current;
    const gameId = snapshot.gameId;
    soloAbandonPendingRef.current = true;
    setSoloPending("abandoning");
    setNotice("");
    try {
      const response = await fetch("/api/solo/abandon", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          createSoloAbandonIntent(
            snapshot,
            createClientCommandId("solo-abandon"),
          ),
        ),
      });
      const payload = (await response.json().catch(() => null)) as
        | SoloAbandonResponse
        | { message?: string }
        | null;
      if (
        soloSessionRef.current !== session ||
        soloGameIdRef.current !== gameId
      ) {
        return false;
      }
      if (payload && "snapshot" in payload) {
        adoptSoloSnapshot(payload.snapshot);
      }
      if (
        !response.ok ||
        !payload ||
        !("abandoned" in payload) ||
        !payload.abandoned
      ) {
        throw new Error(
          payload && "message" in payload && payload.message
            ? payload.message
            : "Unable to end the solo game.",
        );
      }
      returnFromSolo();
      return true;
    } catch (error) {
      if (
        soloSessionRef.current === session &&
        soloGameIdRef.current === gameId
      ) {
        reportRequestFailure("ending the solo game", error);
        setNotice(errorMessage(error, "Unable to end the solo game."));
      }
      return false;
    } finally {
      if (
        soloSessionRef.current === session &&
        soloGameIdRef.current === gameId
      ) {
        soloAbandonPendingRef.current = false;
        setSoloPending(null);
      }
    }
  };

  const shareGeneratedPost = async ({
    busyKey,
    endpoint,
    payload,
    isCurrent = () => true,
  }: {
    busyKey: string;
    endpoint: string;
    payload?: Record<string, unknown>;
    isCurrent?: () => boolean;
  }): Promise<ShareResponse | null> => {
    if (shareBusyRef.current) return null;

    setNotice("");
    shareBusyRef.current = busyKey;
    setShareBusy(busyKey);
    try {
      const r = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload || {}),
      });
      const j = (await r.json().catch(() => ({}))) as ShareResponse;
      if (!r.ok || !j.ok) throw new Error(j.message || "Share failed.");
      if (isCurrent()) setNotice(j.message || "Shared to Reddit.");
      return j;
    } catch (e) {
      if (isCurrent()) setNotice(errorMessage(e, "Share failed."));
      return null;
    } finally {
      if (shareBusyRef.current === busyKey) {
        shareBusyRef.current = null;
        setShareBusy(null);
      }
    }
  };

  const shareRankings = async (bucket: ShareBucket) =>
    shareGeneratedPost({
      busyKey: `rankings:${bucket}`,
      endpoint: "/api/share/rankings",
      payload: { bucket },
    });

  const shareMultiplayerWin = async () => {
    const gameId = gameIdRef.current;
    if (!gameId || h2hMutationRef.current !== null) return;
    const terminalRevision = gameRevisionRef.current;
    const roundEpoch = h2hRoundEpochRef.current;
    const request = { session: h2hSessionRef.current, gameId };
    const isCurrent = () =>
      isCurrentH2HRequest(request, h2hSessionRef.current, gameIdRef.current) &&
      h2hRoundEpochRef.current === roundEpoch &&
      gameRevisionRef.current === terminalRevision;
    const payload: H2HShareRequest = { gameId, terminalRevision };
    const response = await shareGeneratedPost({
      busyKey: "multiplayer",
      endpoint: "/api/share/h2h-result",
      payload,
      isCurrent,
    });
    if (!response || !isCurrent()) return;
    setSharedWins((current) => ({ ...current, multiplayer: true }));
  };

  const shareAiWin = async () => {
    const snapshot = soloSnapshotRef.current;
    if (
      !snapshot?.canShare ||
      soloMovePendingRef.current ||
      soloAbandonPendingRef.current
    ) {
      return;
    }
    if (soloShareCommandRef.current?.gameId !== snapshot.gameId) {
      soloShareCommandRef.current = {
        gameId: snapshot.gameId,
        commandId: createClientCommandId("solo-share"),
      };
    }
    const response = await shareGeneratedPost({
      busyKey: "ai",
      endpoint: "/api/share/ai-result",
      payload: {
        gameId: snapshot.gameId,
        commandId: soloShareCommandRef.current.commandId,
      },
    });
    if (!response || soloSnapshotRef.current?.gameId !== snapshot.gameId) {
      return;
    }

    const presentation = getSoloSharePresentation(response);
    if (presentation.completed) {
      setSharedWins((current) => ({ ...current, ai: true }));
    }
    setNotice(presentation.notice);
  };

  const submitH2HMove = useCallback(
    async (x: number, y: number): Promise<boolean> => {
      const gameId = gameIdRef.current;
      if (!gameId || h2hMutationRef.current !== null || spectatingRef.current)
        return false;
      const session = h2hSessionRef.current;
      const request = { session, gameId };
      const roundEpoch = h2hRoundEpochRef.current;
      let acceptedFeedback: ScoreFeedbackEvent | null = null;

      h2hMutationRef.current = "move";
      setH2HMutation("move");
      setH2HScoreFeedbackSettling(true);
      setNotice("");
      try {
        const response = await fetch("/api/h2h/save", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            gameId,
            x,
            y,
            expectedRevision: gameRevisionRef.current,
          }),
        });
        const payload = (await response.json().catch(() => null)) as
          | H2HMoveResponse
          | { message?: string }
          | null;

        if (
          !isCurrentH2HRequest(
            request,
            h2hSessionRef.current,
            gameIdRef.current,
          )
        )
          return false;

        const hasCanonicalSnapshot = !!payload && "board" in payload;
        if (hasCanonicalSnapshot) {
          acceptedFeedback = payload.accepted
            ? scoreFeedbackFromH2HMove(payload)
            : null;
          adoptH2HState(
            payload,
            payload.accepted ? "baseline" : "force-derive",
          );
        }
        if (
          !response.ok ||
          !payload ||
          !("accepted" in payload) ||
          !payload.accepted
        ) {
          const message =
            payload && "message" in payload && payload.message
              ? payload.message
              : hasCanonicalSnapshot
                ? "The move was not accepted. The canonical board is shown."
                : "The move was not accepted. Refreshing the board…";
          setNotice(message);
          if (!hasCanonicalSnapshot) void refreshStateOnce();
          return false;
        }

        return true;
      } catch (error) {
        if (
          !isCurrentH2HRequest(
            request,
            h2hSessionRef.current,
            gameIdRef.current,
          )
        ) {
          return false;
        }
        reportRequestFailure("saving the multiplayer move", error);
        setNotice("The move could not be saved. The board will be refreshed.");
        void refreshStateOnce();
        return false;
      } finally {
        if (
          isCurrentH2HRequest(request, h2hSessionRef.current, gameIdRef.current)
        ) {
          h2hMutationRef.current = null;
          setH2HMutation(null);
          flushDeferredH2HScoreFeedback(
            gameId,
            session,
            roundEpoch,
            acceptedFeedback,
          );
        }
      }
    },
    [adoptH2HState, flushDeferredH2HScoreFeedback, refreshStateOnce],
  );

  /* ===== Secret keys + chat hotkey ===== */
  const [cheatsUnlocked, setCheatsUnlocked] = useState(false);
  const cheatsUnlockedRef = useRef(false);
  useEffect(() => {
    cheatsUnlockedRef.current = cheatsUnlocked;
  }, [cheatsUnlocked]);

  const brutalPlayForHuman = useCallback(async () => {
    if (!board || winner || finalSide) return;
    if (mode === "multiplayer" && finalReason) return;
    if (mode === "ai") {
      const snapshot = soloSnapshotRef.current;
      if (
        !snapshot ||
        !getSoloAssistancePolicy(snapshot.mode, initState?.username)
          .allowSecretAutoMove ||
        !isSoloHumanTurn(snapshot) ||
        soloMovePendingRef.current ||
        soloAbandonPendingRef.current
      ) {
        return;
      }
      const analysisBoard = Board.fromJSON(snapshot.board);
      const human = analysisBoard.m_players[snapshot.rules.humanPlayer];
      const savedStyle = human.m_playStyle;
      human.m_playStyle = Board.PS_BRUTAL;
      const move = analysisBoard.findBestMove();
      human.m_playStyle = savedStyle;
      await submitSoloMove(move.x, move.y);
    } else if (mode === "multiplayer") {
      const gid = gameIdRef.current;
      if (!gid) {
        console.log("Cheat: No game ID");
        return;
      }
      const myTurn = (board.m_turn === 0) === isPlayer1;
      if (spectating) {
        console.log("Cheat: Cannot use while spectating");
        return;
      }
      if (!myTurn) {
        console.log("Cheat: Not your turn");
        return;
      }

      const saved = board.m_players[board.m_turn].m_playStyle;
      board.m_players[board.m_turn].m_playStyle = Board.PS_BRUTAL;
      const m = board.findBestMove();
      board.m_players[board.m_turn].m_playStyle = saved;
      if (m) {
        console.log("Cheat: Making brutal move at", m.x, m.y);
        await submitH2HMove(m.x, m.y);
      } else {
        console.log("Cheat: No valid move found");
      }
    }
  }, [
    board,
    finalReason,
    finalSide,
    initState?.username,
    isPlayer1,
    mode,
    spectating,
    submitH2HMove,
    submitSoloMove,
    winner,
  ]);

  const sendChat = async () => {
    if (h2hMutationRef.current !== null) return;
    const text = chatText.replace(/\r?\n/g, " ").trim();
    if (!text) {
      closeChat();
      return;
    }
    setChatError("");
    if (mode === "ai") {
      const you: ShareChatItem = {
        id: ++localSeqRef.current,
        ts: Date.now(),
        sender: "You",
        text,
      };
      const bot: ShareChatItem = {
        id: ++localSeqRef.current,
        ts: Date.now() + 1,
        sender: EUCLID_LABEL,
        text,
      };
      setLocalChat((prev) => [...prev.slice(-10), you, bot]);
      closeChat();
    } else if (mode === "multiplayer") {
      const gid = gameIdRef.current;
      if (!gid || spectatingRef.current || h2hMutationRef.current !== null) {
        closeChat();
        if (spectatingRef.current) setNotice("Spectating is read only.");
        return;
      }
      const session = h2hSessionRef.current;
      const request = { session, gameId: gid };
      h2hMutationRef.current = "chat";
      setH2HMutation("chat");
      try {
        const response = await fetch("/api/h2h/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ gameId: gid, text }),
        });
        const payload = (await response.json().catch(() => null)) as
          | H2HChatResponse
          | { message?: string }
          | null;
        if (
          !isCurrentH2HRequest(
            request,
            h2hSessionRef.current,
            gameIdRef.current,
          )
        ) {
          return;
        }
        if (!response.ok || !payload || !("board" in payload)) {
          throw new Error(
            payload && "message" in payload && payload.message
              ? payload.message
              : "The message could not be sent.",
          );
        }
        adoptH2HState(payload);
      } catch (error) {
        if (
          !isCurrentH2HRequest(
            request,
            h2hSessionRef.current,
            gameIdRef.current,
          )
        ) {
          return;
        }
        reportRequestFailure("sending chat", error);
        setChatError(errorMessage(error, "The message could not be sent."));
        return;
      } finally {
        if (
          isCurrentH2HRequest(request, h2hSessionRef.current, gameIdRef.current)
        ) {
          h2hMutationRef.current = null;
          setH2HMutation(null);
        }
      }
      closeChat();
    } else {
      closeChat();
    }
  };

  const secretIdxRef = useRef(0);
  const soloKeyboardTurnStartedAtRef = useRef(Infinity);

  useLayoutEffect(() => {
    if (mode !== "ai") {
      soloKeyboardTurnStartedAtRef.current = Infinity;
      return;
    }
    // Reopen input only after the human turn is rendered. Reset partial secret
    // input too, so keystrokes cannot carry over from the previous turn.
    secretIdxRef.current = 0;
    soloKeyboardTurnStartedAtRef.current =
      !chatOpen &&
      soloPending === null &&
      soloSnapshot &&
      isSoloHumanTurn(soloSnapshot)
        ? performance.now()
        : Infinity;
  }, [mode, chatOpen, soloPending, soloSnapshot]);

  useEffect(() => {
    const secret = "ripred";
    const onKey = (e: KeyboardEvent) => {
      // Playground configuration and play never enter ordinary-game shortcuts.
      if (mode === "challenge") return;
      const k = e.key || "";
      if (!k) return;
      if (chatOpen) return;

      if (k === "\\") {
        if (openChat()) e.preventDefault();
        return;
      }

      if (mode === "ai") {
        const snapshot = soloSnapshotRef.current;
        if (
          !snapshot ||
          !isSoloHumanTurn(snapshot) ||
          soloMovePendingRef.current ||
          soloAbandonPendingRef.current ||
          !isFreshSoloGameplayKey(e, soloKeyboardTurnStartedAtRef.current)
        ) {
          secretIdxRef.current = 0;
          return;
        }
      }

      const lower = k.toLowerCase();
      if (lower === "." && cheatsUnlockedRef.current) {
        if (mode === "ai" || (mode === "multiplayer" && board))
          void brutalPlayForHuman();
        return;
      }
      if (lower.length === 1) {
        if (lower === secret[secretIdxRef.current]) {
          secretIdxRef.current++;
          if (secretIdxRef.current === secret.length) {
            secretIdxRef.current = 0;
            if (mode === "ai" || (mode === "multiplayer" && board)) {
              void brutalPlayForHuman();
              setCheatsUnlocked(true);
            } else {
              if (shareBusyRef.current) return;
              // The hidden route obeys the same lock as visible Home actions;
              // otherwise it could strand an in-flight queue or resume guard.
              if (
                mode === null &&
                shouldLockHomeNavigation(
                  homeBusyActionRef.current !== null,
                  homeH2H.state,
                  homePresenceReconciliationPending,
                )
              ) {
                return;
              }
              stopHomePresenceMonitoring();
              setMode("admin");
              void loadAdmin();
            }
          }
        } else {
          secretIdxRef.current = lower === secret[0] ? 1 : 0;
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    mode,
    board,
    chatOpen,
    brutalPlayForHuman,
    homeH2H.state,
    homePresenceReconciliationPending,
    loadAdmin,
    openChat,
    spectating,
    stopHomePresenceMonitoring,
  ]);

  /* ===== Rules and first-game tutorial ===== */
  const RulesOverlay = showRules ? (
    <HowToPlayDialog variant="rules" onClose={() => setShowRules(false)} />
  ) : null;
  const TutorialModal = showTutorial ? (
    <HowToPlayDialog variant="tutorial" onClose={completeTutorial} />
  ) : null;

  /* ===== Chat Input Overlay ===== */
  const ChatOverlay =
    !chatOpen || chatBlockedByOverlay ? null : (
      <div
        className="euclid-chat-backdrop"
        onClick={() => {
          if (h2hMutation !== "chat") closeChat();
        }}
      >
        <div
          id="euclid-game-chat-dialog"
          className="chat-sheet"
          role="dialog"
          aria-modal="true"
          aria-labelledby="euclid-game-chat-title"
          aria-describedby={chatError ? "euclid-game-chat-error" : undefined}
          tabIndex={-1}
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              if (h2hMutation !== "chat") {
                event.preventDefault();
                closeChat();
              }
              return;
            }
            trapDialogTab(event);
          }}
        >
          <h2 id="euclid-game-chat-title" className="euclid-sr-only">
            Game chat
          </h2>
          <div className="euclid-chat-composer">
            <input
              autoFocus
              className="input"
              aria-label="Message"
              value={chatText}
              readOnly={h2hMutation === "chat"}
              aria-busy={h2hMutation === "chat" || undefined}
              onChange={(e) => setChatText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void sendChat();
                }
              }}
              placeholder={
                mode === "ai"
                  ? `Say something to ${EUCLID_LABEL} (echo)…`
                  : "Say something to the other redditor…"
              }
              maxLength={140}
            />
            <button
              type="button"
              className="btn btn--ghost euclid-chat-composer__cancel"
              disabled={h2hMutation === "chat"}
              onClick={() => closeChat()}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn btn--primary euclid-chat-composer__send"
              disabled={h2hMutation === "chat"}
              aria-busy={h2hMutation === "chat" || undefined}
              onClick={() => void sendChat()}
            >
              {h2hMutation === "chat" ? "Sending…" : "Send"}
            </button>
          </div>
          {chatError && (
            <div
              id="euclid-game-chat-error"
              role="alert"
              className="euclid-chat-composer__error"
            >
              {chatError}
            </div>
          )}
        </div>
      </div>
    );

  const sharedPost = initState?.type === "share" ? initState.share : null;
  const soundControl = <SoundToggle on={soundOn} onToggle={toggleSound} />;

  /* =========================
     CONTENT ROUTER
     ========================= */
  let content: React.ReactElement;

  if (!initState && !initError) {
    content = (
      <HomeStatusScreen
        heading="Preparing your board"
        detail="Loading your games, records, and Euclid settings…"
        busy
      />
    );
  } else if (sharedPost) {
    content = <SharedPostView share={sharedPost} />;
  } else if (initError) {
    content = (
      <HomeStatusScreen
        heading="Euclid could not start"
        detail={initError}
        error
      />
    );
  } else if (mode === null) {
    const navigationLocked = shouldLockHomeNavigation(
      homeBusyActionRef.current !== null,
      homeH2H.state,
      homePresenceReconciliationPending,
    );
    content = (
      <>
        <HomeScreen
          onChallenges={
            initState?.type === "init" && initState.canManageChallenges
              ? () => {
                  if (navigationLocked) return;
                  stopHomePresenceMonitoring();
                  setMode("challenge");
                }
              : undefined
          }
          username={initState?.username ?? ""}
          playEuclidSubtitle={getPlayEuclidSubtitle(
            soloMode,
            selectedDifficulty,
          )}
          records={getHomeRecordPresentations(homeStats)}
          soloContinuation={
            homeSolo ? getSoloContinuationPresentation(homeSolo) : null
          }
          h2h={getH2HHomePresentation(homeH2H)}
          loading={{
            presence: homePresenceLoading,
            solo: homeSoloLoading,
            records: homeRecordsLoading,
          }}
          presenceReconciliationPending={homePresenceReconciliationPending}
          busyAction={homeBusyAction}
          status={homeStatus}
          error={homeError}
          soloMode={soloMode}
          onSoloModeChange={setSoloMode}
          onPlayEuclid={() => void startSoloFromHome()}
          onPlayRedditor={() => void startMultiplayerQueue()}
          onContinueSolo={() => void continueSoloFromHome()}
          onContinueH2H={() => void continueH2HFromHome()}
          onCancelSearch={() => void cancelMultiplayerQueue()}
          onWatchGames={() => {
            if (navigationLocked) return;
            stopHomePresenceMonitoring();
            setMode("spectate");
          }}
          onLeaderboard={() => {
            if (navigationLocked) return;
            stopHomePresenceMonitoring();
            setMode("rankings");
          }}
          onOptions={() => {
            if (navigationLocked) return;
            stopHomePresenceMonitoring();
            setMode("options");
          }}
          onRules={() => {
            if (!navigationLocked) setShowRules(true);
          }}
        />
      </>
    );
  } else if (mode === "challenge") {
    content = <ChallengeScreen onLeave={() => setMode(null)} />;
  } else if (mode === "options") {
    content = (
      <SetupScreen
        soloMode={soloMode}
        onSoloModeChange={setSoloMode}
        difficulty={selectedDifficulty}
        onDifficultyChange={setSelectedDifficulty}
        width={boardW}
        height={boardH}
        onWidthChange={setBoardW}
        onHeightChange={setBoardH}
        scoring={scoringMode}
        onScoringChange={setScoringMode}
        winScore={winScore}
        onWinScoreChange={setWinScore}
        bestCase={bestCase}
        recommended={recommended}
        assistOn={assistOn}
        onAssistChange={setAssistOn}
        appVersion={initState?.appVersion || "loading"}
        onDone={returnHome}
      />
    );
  } else if (mode === "rankings") {
    content = (
      <RankingsScreen
        rankings={rankings}
        loading={rankingsLoading}
        loaded={rankingsLoaded}
        error={rankingsError || null}
        notice={notice}
        shareBusy={shareBusy}
        onRetry={() => void loadRankings()}
        onShare={shareRankings}
        onBack={returnHome}
      />
    );
  } else if (mode === "spectate") {
    content = (
      <WatchLobby
        {...liveGames}
        theme={watchTheme}
        onRefresh={liveGames.refresh}
        onWatch={watchGame}
        onDemo={watchDemo}
        onPlay={playFromWatch}
      />
    );
  } else if (
    mode === "watch-demo" ||
    (spectating && showWatchReplay && watchRecording)
  ) {
    content = (
      <WatchReplay
        board={mode === "watch-demo" ? null : watchRecording!.board}
        headline={mode === "watch-demo" ? undefined : watchRecording!.headline}
        theme={watchTheme}
        onAnother={stopWatching}
        onPlay={playFromWatch}
      />
    );
  } else if (mode === "admin") {
    /* ===== Admin ===== */
    content = (
      <PageShell
        title="Admin metrics"
        titleId="admin-title"
        back={{ label: "Done", onClick: returnHome }}
        narrow={false}
      >
        <div className="panel admin-panel">
          <table
            style={{
              width: "100%",
              borderCollapse: "collapse",
              fontSize: "0.8125rem",
            }}
          >
            <tbody>
              <tr>
                <td
                  style={{
                    padding: 4,
                    verticalAlign: "top",
                    border: "1px solid var(--card-border)",
                    color: "var(--text)",
                  }}
                >
                  <div
                    className="font-bold mb-2"
                    style={{ color: "var(--muted)" }}
                  >
                    Unique users
                  </div>
                  <ul
                    style={{
                      color: "var(--text)",
                      lineHeight: 1.6,
                      fontVariantNumeric: "tabular-nums",
                    }}
                  >
                    <li>App started: {admin?.uniques?.app_start_users ?? 0}</li>
                    <li>H2H clicked: {admin?.uniques?.h2h_click_users ?? 0}</li>
                    <li>
                      H2H started: {admin?.uniques?.h2h_started_users ?? 0}
                    </li>
                    <li>
                      H2H completed: {admin?.uniques?.h2h_completed_users ?? 0}
                    </li>
                    <li>
                      {HUMAN_VS_EUCLID_LABEL} clicked:{" "}
                      {admin?.uniques?.ai_click_users ?? 0}
                    </li>
                    <li>
                      {HUMAN_VS_EUCLID_LABEL} first move:{" "}
                      {admin?.uniques?.ai_first_users ?? 0}
                    </li>
                    <li>
                      {HUMAN_VS_EUCLID_LABEL} completed:{" "}
                      {admin?.uniques?.ai_completed_users ?? 0}
                    </li>
                  </ul>
                  <div
                    className="font-bold mt-4 mb-2"
                    style={{ color: "var(--muted)" }}
                  >
                    Computed (never …)
                  </div>
                  <ul
                    style={{
                      color: "var(--text)",
                      lineHeight: 1.6,
                      fontVariantNumeric: "tabular-nums",
                    }}
                  >
                    <li>
                      H2H: clicked but never played:{" "}
                      {admin?.computed?.h2h_clicked_never_started ?? 0}
                    </li>
                    <li>
                      H2H: started but never finished:{" "}
                      {admin?.computed?.h2h_started_never_finished ?? 0}
                    </li>
                    <li>
                      {HUMAN_VS_EUCLID_LABEL}: clicked but never played:{" "}
                      {admin?.computed?.ai_clicked_never_started ?? 0}
                    </li>
                    <li>
                      {HUMAN_VS_EUCLID_LABEL}: started but never finished:{" "}
                      {admin?.computed?.ai_started_never_finished ?? 0}
                    </li>
                  </ul>
                </td>
                <td
                  style={{
                    padding: 4,
                    verticalAlign: "top",
                    border: "1px solid var(--card-border)",
                    color: "var(--text)",
                  }}
                >
                  <div
                    className="font-bold mb-2"
                    style={{ color: "var(--muted)" }}
                  >
                    Event counts
                  </div>
                  <ul
                    style={{
                      color: "var(--text)",
                      lineHeight: 1.6,
                      fontVariantNumeric: "tabular-nums",
                    }}
                  >
                    <li>App starts: {admin?.counts?.app_start_count ?? 0}</li>
                    <li>H2H clicks: {admin?.counts?.h2h_click_count ?? 0}</li>
                    <li>H2H pairs: {admin?.counts?.h2h_started_count ?? 0}</li>
                    <li>
                      H2H game overs: {admin?.counts?.h2h_game_over_count ?? 0}
                    </li>
                    <li>
                      H2H cancel queue:{" "}
                      {admin?.counts?.h2h_cancel_queue_count ?? 0}
                    </li>
                    <li>
                      H2H opponent left:{" "}
                      {admin?.counts?.h2h_opponent_left_count ?? 0}
                    </li>
                    <li>
                      H2H player left:{" "}
                      {admin?.counts?.h2h_player_left_count ?? 0}
                    </li>
                    <li>
                      {HUMAN_VS_EUCLID_LABEL} clicks:{" "}
                      {admin?.counts?.ai_click_count ?? 0}
                    </li>
                    <li>
                      {HUMAN_VS_EUCLID_LABEL} first moves:{" "}
                      {admin?.counts?.ai_first_count ?? 0}
                    </li>
                    <li>
                      {HUMAN_VS_EUCLID_LABEL} completes:{" "}
                      {admin?.counts?.ai_completed_count ?? 0}
                    </li>
                  </ul>
                  <div
                    className="font-bold mt-4 mb-2"
                    style={{ color: "var(--muted)" }}
                  >
                    {EUCLID_LABEL} difficulty breakdown
                  </div>
                  <ul
                    style={{
                      color: "var(--text)",
                      lineHeight: 1.6,
                      fontVariantNumeric: "tabular-nums",
                    }}
                  >
                    <li>doofus: {admin?.aiDiffs?.doofus ?? 0}</li>
                    <li>Goldfish: {admin?.aiDiffs?.goldfish ?? 0}</li>
                    <li>Beginner: {admin?.aiDiffs?.beginner ?? 0}</li>
                    <li>Coffee-Deprived: {admin?.aiDiffs?.coffee ?? 0}</li>
                    <li>Tenderfoot: {admin?.aiDiffs?.tenderfoot ?? 0}</li>
                    <li>Casual: {admin?.aiDiffs?.casual ?? 0}</li>
                    <li>Offensive: {admin?.aiDiffs?.offensive ?? 0}</li>
                    <li>Defensive: {admin?.aiDiffs?.defensive ?? 0}</li>
                    <li>Brutal: {admin?.aiDiffs?.brutal ?? 0}</li>
                  </ul>
                </td>
              </tr>
              <tr>
                <td
                  colSpan={2}
                  style={{
                    padding: 4,
                    border: "1px solid var(--card-border)",
                    color: "var(--text)",
                  }}
                >
                  <div
                    className="font-bold mb-2"
                    style={{ color: "var(--muted)" }}
                  >
                    Daily Play Counts (Past 7 Days)
                  </div>
                  <table
                    style={{
                      width: "100%",
                      borderCollapse: "collapse",
                      fontSize: "0.75rem",
                    }}
                  >
                    <thead>
                      <tr>
                        <th
                          style={{
                            border: "1px solid var(--card-border)",
                            padding: 4,
                            textAlign: "left",
                            color: "var(--text)",
                          }}
                        >
                          Date
                        </th>
                        <th
                          style={{
                            border: "1px solid var(--card-border)",
                            padding: 4,
                            textAlign: "right",
                            color: "var(--text)",
                          }}
                        >
                          HvH
                        </th>
                        <th
                          style={{
                            border: "1px solid var(--card-border)",
                            padding: 4,
                            textAlign: "right",
                            color: "var(--text)",
                          }}
                        >
                          doofus
                        </th>
                        <th
                          style={{
                            border: "1px solid var(--card-border)",
                            padding: 4,
                            textAlign: "right",
                            color: "var(--text)",
                          }}
                        >
                          Goldfish
                        </th>
                        <th
                          style={{
                            border: "1px solid var(--card-border)",
                            padding: 4,
                            textAlign: "right",
                            color: "var(--text)",
                          }}
                        >
                          Beginner
                        </th>
                        <th
                          style={{
                            border: "1px solid var(--card-border)",
                            padding: 4,
                            textAlign: "right",
                            color: "var(--text)",
                          }}
                        >
                          Coffee
                        </th>
                        <th
                          style={{
                            border: "1px solid var(--card-border)",
                            padding: 4,
                            textAlign: "right",
                            color: "var(--text)",
                          }}
                        >
                          Tenderfoot
                        </th>
                        <th
                          style={{
                            border: "1px solid var(--card-border)",
                            padding: 4,
                            textAlign: "right",
                            color: "var(--text)",
                          }}
                        >
                          Casual
                        </th>
                        <th
                          style={{
                            border: "1px solid var(--card-border)",
                            padding: 4,
                            textAlign: "right",
                            color: "var(--text)",
                          }}
                        >
                          Offensive
                        </th>
                        <th
                          style={{
                            border: "1px solid var(--card-border)",
                            padding: 4,
                            textAlign: "right",
                            color: "var(--text)",
                          }}
                        >
                          Defensive
                        </th>
                        <th
                          style={{
                            border: "1px solid var(--card-border)",
                            padding: 4,
                            textAlign: "right",
                            color: "var(--text)",
                          }}
                        >
                          Brutal
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {admin?.daily?.dates.map((date, i) => (
                        <tr key={date}>
                          <td
                            style={{
                              border: "1px solid var(--card-border)",
                              padding: 4,
                              color: "var(--text)",
                            }}
                          >
                            {date}
                          </td>
                          <td
                            style={{
                              border: "1px solid var(--card-border)",
                              padding: 4,
                              textAlign: "right",
                              color: "var(--text)",
                            }}
                          >
                            {admin.daily.hvh[i] ?? 0}
                          </td>
                          <td
                            style={{
                              border: "1px solid var(--card-border)",
                              padding: 4,
                              textAlign: "right",
                              color: "var(--text)",
                            }}
                          >
                            {admin.daily.ai.doofus[i] ?? 0}
                          </td>
                          <td
                            style={{
                              border: "1px solid var(--card-border)",
                              padding: 4,
                              textAlign: "right",
                              color: "var(--text)",
                            }}
                          >
                            {admin.daily.ai.goldfish[i] ?? 0}
                          </td>
                          <td
                            style={{
                              border: "1px solid var(--card-border)",
                              padding: 4,
                              textAlign: "right",
                              color: "var(--text)",
                            }}
                          >
                            {admin.daily.ai.beginner[i] ?? 0}
                          </td>
                          <td
                            style={{
                              border: "1px solid var(--card-border)",
                              padding: 4,
                              textAlign: "right",
                              color: "var(--text)",
                            }}
                          >
                            {admin.daily.ai.coffee[i] ?? 0}
                          </td>
                          <td
                            style={{
                              border: "1px solid var(--card-border)",
                              padding: 4,
                              textAlign: "right",
                              color: "var(--text)",
                            }}
                          >
                            {admin.daily.ai.tenderfoot[i] ?? 0}
                          </td>
                          <td
                            style={{
                              border: "1px solid var(--card-border)",
                              padding: 4,
                              textAlign: "right",
                              color: "var(--text)",
                            }}
                          >
                            {admin.daily.ai.casual[i] ?? 0}
                          </td>
                          <td
                            style={{
                              border: "1px solid var(--card-border)",
                              padding: 4,
                              textAlign: "right",
                              color: "var(--text)",
                            }}
                          >
                            {admin.daily.ai.offensive[i] ?? 0}
                          </td>
                          <td
                            style={{
                              border: "1px solid var(--card-border)",
                              padding: 4,
                              textAlign: "right",
                              color: "var(--text)",
                            }}
                          >
                            {admin.daily.ai.defensive[i] ?? 0}
                          </td>
                          <td
                            style={{
                              border: "1px solid var(--card-border)",
                              padding: 4,
                              textAlign: "right",
                              color: "var(--text)",
                            }}
                          >
                            {admin.daily.ai.brutal[i] ?? 0}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </td>
              </tr>
            </tbody>
          </table>
          <div
            className="p-4 flex flex-wrap items-center justify-between"
            style={{
              borderTop: `1px solid var(--card-border)`,
              color: "var(--text)",
            }}
          >
            <div>
              Active H2H games: <b>{admin?.activeGames ?? 0}</b>
            </div>
            <div>
              Leaderboard entries — HvH: <b>{admin?.rankedPlayers?.hvh ?? 0}</b>{" "}
              / HvE: <b>{admin?.rankedPlayers?.hva ?? 0}</b>
            </div>
          </div>
        </div>
      </PageShell>
    );
  } else if (mode === "multiplayer" && spectating && finalReason === "gone") {
    content = (
      <WatchUnavailable
        theme={watchTheme}
        onAnother={stopWatching}
        onDemo={watchDemo}
        onPlay={playFromWatch}
      />
    );
  } else if (mode === "multiplayer" && !isBoardValid(board)) {
    const multiplayerTransitionPending =
      !spectating &&
      (h2hMutation !== null ||
        homeBusyAction !== null ||
        shareBusy === "multiplayer");
    const multiplayerTransitionLabel =
      shareBusy === "multiplayer"
        ? "Sharing…"
        : h2hMutation === "leave"
          ? "Leaving…"
          : homeBusyAction === "h2h"
            ? "Canceling…"
            : "Finishing match action…";
    content = (
      <HomeStatusScreen
        heading={spectating ? "Opening live game" : "Opening your match"}
        detail={
          status ||
          (spectating ? "Loading the latest board…" : "Paired — loading board…")
        }
        busy
        actions={[
          {
            label: spectating
              ? "Stop watching"
              : multiplayerTransitionPending
                ? multiplayerTransitionLabel
                : gameIdRef.current
                  ? "Leave game"
                  : "Back",
            disabled: multiplayerTransitionPending,
            busy: multiplayerTransitionPending,
            onClick: () => {
              void (async () => {
                if (spectatingRef.current) {
                  stopWatching();
                } else if (gameIdRef.current) {
                  await leaveMultiplayer();
                } else {
                  await cancelMultiplayerQueue();
                }
              })();
            },
          },
          ...(!spectating
            ? [
                {
                  label: `Play ${soloMode === "ranked" ? "Ranked" : "Practice"} instead`,
                  primary: true,
                  disabled: multiplayerTransitionPending,
                  busy: multiplayerTransitionPending,
                  onClick: () => {
                    void (async () => {
                      const exited = gameIdRef.current
                        ? await leaveMultiplayer()
                        : await cancelMultiplayerQueue();
                      if (exited) await startSoloGame();
                    })();
                  },
                },
              ]
            : []),
        ]}
      />
    );
  } else if (mode === "multiplayer" && isBoardValid(board)) {
    /* ===== Multiplayer (live) ===== */
    const p1Id = board.m_players[0].userId;
    const p2Id = board.m_players[1].userId;
    const names = board.playerNames;
    const avatars = board.playerAvatars;
    const p1Name = names[p1Id] || "Redditor 1";
    const p2Name = names[p2Id] || "Redditor 2";
    const isMyTurn = (board.m_turn === 0) === isPlayer1;

    const onCellClick = (x: number, y: number) => {
      if (!board || !gameIdRef.current) return;
      if (spectating) return;
      const cell = board.m_board[y * board.W + x];
      if (
        !isMyTurn ||
        cell === undefined ||
        cell > 0 ||
        winner ||
        finalSide ||
        finalReason
      )
        return;
      void submitH2HMove(x, y);
    };

    const midText = finalSide
      ? (finalSide === 1 ? p1Name : p2Name) + " Wins!"
      : finalReason === "tie"
        ? "Tie game!"
        : finalReason === "gone"
          ? "Game unavailable"
          : finalReason
            ? "Game over"
            : spectating
              ? `${board.m_turn === 0 ? p1Name : p2Name} to move`
              : isMyTurn
                ? "Your move"
                : `Waiting on ${board.m_turn === 0 ? p1Name : p2Name}…`;

    const decided = finalSide ?? winner ?? null;
    const showWinner = !!decided;
    const showTerminalResult = showWinner || finalReason !== "";
    const localSide: PlayerColor | null = spectating ? null : isPlayer1 ? 1 : 2;
    const h2hScoreFeedbackQueue = scoreFeedbackQueue.filter(
      (feedback) => feedback.gameId === gameIdRef.current,
    );
    const h2hScoreFeedback = h2hScoreFeedbackQueue[0] ?? null;
    const resultPresentation = decided
      ? getH2HResultPresentation(decided, localSide, spectating, p1Name, p2Name)
      : null;
    const rematchAvailable = isH2HRematchAvailable(
      finalReason,
      spectating,
      h2hCanRematch,
    );
    const youAreWinner = resultPresentation?.isLocalVictory ?? false;
    const winnerText = resultPresentation?.headline ?? "Game over";
    const exitAction =
      finalReason === "gone"
        ? { label: "Back" as const, notifyServer: false }
        : getH2HExitAction(spectating);
    const exitMultiplayer =
      finalReason === "gone"
        ? spectating
          ? stopWatching
          : () => clearMultiplayerState({ refreshHome: true })
        : exitAction.notifyServer
          ? () => {
              void leaveMultiplayer(
                showTerminalResult ? "close_result" : "leave",
              );
            }
          : stopWatching;
    const h2hExitPending =
      h2hMutation !== null ||
      h2hScoreFeedbackSettling ||
      shareBusy === "multiplayer";
    const h2hExitPendingLabel =
      shareBusy === "multiplayer"
        ? "Sharing…"
        : h2hMutation === "leave"
          ? "Leaving…"
          : h2hMutation === "rematch"
            ? "Starting rematch…"
            : h2hMutation === "chat"
              ? "Sending message…"
              : "Saving move…";

    const showOverlay =
      (notice &&
        !showTerminalResult &&
        !h2hScoreFeedback &&
        !h2hScoreFeedbackSettling) ||
      (showTerminalResult && !h2hScoreFeedback && !h2hScoreFeedbackSettling);
    const closeLabel = showTerminalResult
      ? h2hExitPending && h2hMutation !== "rematch"
        ? h2hExitPendingLabel
        : "Close"
      : "OK";
    const closeButton = (
      <button
        autoFocus
        type="button"
        className="btn"
        onClick={() => {
          if (h2hExitPending) return;
          if (showTerminalResult) {
            exitMultiplayer();
          } else {
            setNotice("");
          }
        }}
        aria-disabled={h2hExitPending || undefined}
        aria-busy={h2hExitPending || undefined}
      >
        {closeLabel}
      </button>
    );
    const overlay = !showOverlay ? null : showTerminalResult ? (
      <>
        <Confetti show={shouldRunVictoryEffects(showWinner, youAreWinner)} />
        <ResultDialog
          titleId="euclid-h2h-result-title"
          headline={
            showWinner
              ? winnerText
              : finalReason === "tie"
                ? "Tie game!"
                : notice || "Game over."
          }
          tone={
            youAreWinner
              ? "win"
              : showWinner && !spectating
                ? "loss"
                : "neutral"
          }
          detail={`${spectating ? "Spectated match" : "Redditor match"} · ${rulesSummary(board)}`}
          players={
            showWinner || finalReason === "tie"
              ? resultPlayers(board, [p1Name, p2Name], decided)
              : undefined
          }
          actions={
            <>
              {rematchAvailable && (
                <H2HRematchButton
                  disabled={h2hExitPending}
                  pending={h2hMutation === "rematch"}
                  onClick={() => void requestH2HRematch()}
                />
              )}
              {showWinner &&
                youAreWinner &&
                !spectating &&
                !sharedWins.multiplayer && (
                  <button
                    type="button"
                    className="btn btn--primary"
                    disabled={h2hExitPending}
                    onClick={shareMultiplayerWin}
                  >
                    <Icon name="share" size={18} />
                    {shareBusy === "multiplayer"
                      ? "Sharing…"
                      : h2hExitPending
                        ? "Please wait…"
                        : "Share win"}
                  </button>
                )}
              {spectating ? (
                <WatchActions
                  initialFocus
                  onReplay={
                    watchRecording ? () => setShowWatchReplay(true) : undefined
                  }
                  onAnother={stopWatching}
                  onPlay={playFromWatch}
                />
              ) : (
                closeButton
              )}
            </>
          }
        >
          {showWinner && notice ? (
            <p className="result__notice">{notice}</p>
          ) : null}
        </ResultDialog>
      </>
    ) : (
      <NoticeDialog titleId="euclid-h2h-result-title" message={notice}>
        {closeButton}
      </NoticeDialog>
    );

    // Chat items for display (H2H from board.chat)
    const chatItems: { id: number; sender: string; text: string }[] = (() => {
      const chat = board.chat;
      if (!chat) return [];
      return chat.items.slice(-8).map((it) => ({
        id: it.id,
        sender:
          names[it.sender] ||
          (it.sender === p1Id
            ? p1Name
            : it.sender === p2Id
              ? p2Name
              : "Redditor"),
        text: it.text,
      }));
    })();

    content = (
      <GameScreen
        exitLabel={exitAction.label}
        viewport={viewport}
        board={board}
        onCellClick={onCellClick}
        onLeave={exitMultiplayer}
        exitPending={h2hExitPending}
        exitPendingLabel={h2hExitPendingLabel}
        modeLabel={spectating ? "Spectating" : "Redditor match"}
        p1Name={p1Name}
        p2Name={p2Name}
        midText={midText}
        activeSide={
          finalSide || finalReason ? null : board.m_turn === 0 ? 1 : 2
        }
        placingSide={
          !spectating &&
          isMyTurn &&
          !winner &&
          !finalSide &&
          !finalReason &&
          h2hMutation === null
            ? localSide
            : null
        }
        overlay={overlay}
        p1Avatar={avatars[p1Id]}
        p2Avatar={avatars[p2Id]}
        chatItems={chatItems}
        chatReadOnly={spectating}
        chatCanCompose={h2hChatAvailable}
        chatHasVisibleTrigger={h2hChatAvailable}
        assistOn={assistOn}
        myColor={localSide}
        scoreFeedback={h2hScoreFeedback}
        futureScoreFeedback={h2hScoreFeedbackQueue.slice(1)}
        acceptPlacementKey={(event) => !event.repeat}
        onRules={() => setShowRules(true)}
        toolbar={
          <>
            {!chatOpen && h2hChatAvailable && (
              <H2HChatTrigger
                ref={chatTriggerRef}
                disabled={h2hMutation !== null}
                onClick={() => {
                  openChat();
                }}
              />
            )}
            {!spectating && (
              <AssistToggle
                on={assistOn}
                onToggle={() => setAssistOn(!assistOn)}
              />
            )}
            {soundControl}
          </>
        }
      />
    );
  } else if (mode === "ai" && (!isBoardValid(board) || !soloSnapshot)) {
    content = (
      <HomeStatusScreen
        heading="Setting up the board"
        detail={status || "Loading your solo game…"}
        busy
      />
    );
  } else if (mode === "ai" && isBoardValid(board) && soloSnapshot) {
    /* ===== Canonical Ranked / Practice solo ===== */
    const presentation = getSoloResultPresentation(soloSnapshot);
    const assistance = getSoloAssistancePolicy(
      soloSnapshot.mode,
      initState?.username,
    );
    const soloExitPending = soloPending !== null || shareBusy === "ai";
    const soloExitPendingLabel =
      shareBusy === "ai"
        ? "Sharing…"
        : soloPending === "abandoning"
          ? "Ending game…"
          : "Saving move…";
    const exitAction = getSoloExitAction(soloSnapshot);
    const difficultyName = AI_DIFFICULTY_LABELS[soloSnapshot.rules.difficulty];
    const euclidName = `${EUCLID_LABEL} (${difficultyName})`;
    const humanIsPlayerOne = soloSnapshot.rules.humanPlayer === 0;
    const p1Name = humanIsPlayerOne ? "You" : euclidName;
    const p2Name = humanIsPlayerOne ? euclidName : "You";
    const soloScoreFeedbackQueue = scoreFeedbackQueue.filter(
      (feedback) => feedback.gameId === soloSnapshot.gameId,
    );
    const soloScoreFeedback = soloScoreFeedbackQueue[0] ?? null;
    const onCellClick = (x: number, y: number) => {
      const cell = board.m_board[y * board.W + x];
      if (
        !isSoloHumanTurn(soloSnapshot) ||
        soloPending !== null ||
        cell === undefined ||
        cell > 0
      ) {
        return;
      }
      void submitSoloMove(x, y);
    };
    const midText =
      soloPending === "moving"
        ? `${EUCLID_LABEL} is thinking…`
        : presentation.headline;
    const ratingDelta = soloSnapshot.rating
      ? soloSnapshot.rating.after - soloSnapshot.rating.before
      : 0;
    const overlay =
      presentation.terminal && !soloScoreFeedback ? (
        <>
          <Confetti
            show={shouldRunVictoryEffects(
              presentation.terminal,
              presentation.isLocalVictory,
            )}
          />
          <ResultDialog
            titleId="euclid-solo-result-title"
            headline={presentation.headline}
            tone={
              presentation.isLocalVictory
                ? "win"
                : presentation.result === "loss"
                  ? "loss"
                  : "neutral"
            }
            detail={`${soloSnapshot.mode === "ranked" ? "Ranked" : "Practice"} · ${rulesSummary(board)}`}
            players={resultPlayers(
              board,
              [p1Name, p2Name],
              presentation.winnerSide,
            )}
            actions={
              <>
                {soloSnapshot.canShare &&
                  presentation.isLocalVictory &&
                  !sharedWins.ai && (
                    <button
                      type="button"
                      className="btn btn--primary"
                      disabled={soloExitPending}
                      onClick={() => void shareAiWin()}
                    >
                      <Icon name="share" size={18} />
                      {shareBusy === "ai"
                        ? "Sharing…"
                        : soloExitPending
                          ? "Please wait…"
                          : "Share win"}
                    </button>
                  )}
                <button
                  autoFocus
                  type="button"
                  className="btn"
                  onClick={() => void exitSoloGame()}
                  disabled={soloExitPending}
                  aria-busy={soloExitPending || undefined}
                >
                  {soloExitPending ? soloExitPendingLabel : "Close"}
                </button>
              </>
            }
          >
            {soloSnapshot.rating && (
              <p className="result__rating num">
                Rating {soloSnapshot.rating.before} →{" "}
                {soloSnapshot.rating.after}
                <span
                  className={`result__rating-delta${ratingDelta < 0 ? " result__rating-delta--down" : ""}`}
                >
                  {ratingDelta >= 0 ? `+${ratingDelta}` : ratingDelta}
                </span>
              </p>
            )}
            {notice && <p className="result__notice">{notice}</p>}
          </ResultDialog>
        </>
      ) : null;

    content = (
      <GameScreen
        exitLabel={exitAction.label}
        viewport={viewport}
        board={board}
        onCellClick={onCellClick}
        onLeave={() => void exitSoloGame()}
        exitPending={soloExitPending}
        exitPendingLabel={soloExitPendingLabel}
        modeLabel={soloSnapshot.mode === "ranked" ? "Ranked" : "Practice"}
        p1Name={humanIsPlayerOne ? "You" : EUCLID_LABEL}
        p2Name={humanIsPlayerOne ? EUCLID_LABEL : "You"}
        p1Tag={humanIsPlayerOne ? undefined : difficultyName}
        p2Tag={humanIsPlayerOne ? difficultyName : undefined}
        midText={midText}
        activeSide={presentation.terminal ? null : board.m_turn === 0 ? 1 : 2}
        placingSide={
          isSoloHumanTurn(soloSnapshot) && soloPending === null
            ? presentation.humanSide
            : null
        }
        thinking={soloPending === "moving"}
        overlay={overlay}
        chatItems={localChat.slice(-8)}
        chatCanCompose={soloChatAvailable}
        assistOn={assistance.allowAssistHighlights && assistOn}
        myColor={presentation.humanSide}
        scoreFeedback={soloScoreFeedback}
        futureScoreFeedback={soloScoreFeedbackQueue.slice(1)}
        acceptPlacementKey={(event) =>
          isFreshSoloGameplayKey(
            event.nativeEvent,
            soloKeyboardTurnStartedAtRef.current,
          )
        }
        onRules={() => setShowRules(true)}
        toolbar={
          <>
            {assistance.allowAssistHighlights && !presentation.terminal && (
              <AssistToggle
                on={assistOn}
                onToggle={() => setAssistOn(!assistOn)}
              />
            )}
            {soundControl}
          </>
        }
      />
    );
  }

  // Defensive fallback for a transient mode/state combination not routed above.
  else {
    content = <HomeStatusScreen heading="Loading" detail="One moment…" busy />;
  }

  // The game bar hosts chat and sound controls; other screens float sound.
  const onGameScreen = content.type === GameScreen;
  const globalControlsBlocked =
    chatOpen ||
    showRules ||
    showTutorial ||
    notice !== "" ||
    winner !== null ||
    finalReason !== "";
  const appReady = !sharedPost && !!initState && !initError;

  /* ===== Unconditional globals + content + overlays ===== */
  return (
    <SoundContext.Provider value={sounds}>
      <VersionStamp version={initState?.appVersion} />
      {content}
      {appReady && ChatOverlay}
      {appReady && RulesOverlay}
      {appReady && TutorialModal}
      {appReady && !onGameScreen && !globalControlsBlocked && (
        <SoundToggle floating on={soundOn} onToggle={toggleSound} />
      )}
    </SoundContext.Provider>
  );
};

const SharedPostView: React.FC<{ share: SharedPostPayload }> = ({ share }) => {
  if (share.kind === "rankings") {
    return (
      <PageShell
        title={share.title}
        titleId="shared-rankings-title"
        role="region"
        tabIndex={0}
      >
        <header className="shared-rankings__head">
          <p className="eyebrow">r/{share.subredditName}</p>
          <p className="muted">{share.subtitle}</p>
          <p className="field__hint">
            Top players right now · shared from Euclid on{" "}
            {formatDisplayDate(share.sharedAt)}
          </p>
        </header>
        <section className="panel">
          <StandingsList
            rows={share.rows}
            label="Shared leaderboard"
            size="lg"
            empty="No ranked players in this snapshot."
          />
        </section>
      </PageShell>
    );
  }

  return <ResultShareView share={share} theme="dark" />;
};
