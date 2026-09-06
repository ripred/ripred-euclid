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
  RankingsResponse,
  RankingsShareRow,
  SerializableBoard,
  ShareChatItem,
  ShareBucket,
  SharePoint,
  ShareSquare,
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
  AI_DIFFICULTIES,
  AI_DIFFICULTY_LABELS,
  isAiDifficulty,
  type AiDifficulty,
  type PlayerColor,
  type PlayerIndex,
  type SoloMode,
} from "../shared/game/rules";
import { recommendedWinTarget, totalSquareScore } from "../shared/scoring";
import {
  calculateBoardLayout,
  getH2HExitAction,
  getH2HResultPresentation,
  isH2HChatAvailable,
  isH2HRematchAvailable,
  isH2HRematchRecovery,
  isLocalVictory,
  shouldAdoptH2HState,
  shouldPollH2HState,
  shouldProcessH2HPollSnapshot,
  shouldRunVictoryEffects,
  type H2HViewEndReason,
} from "./game-ui";
import { H2HChatTrigger, H2HRematchButton } from "./h2h-controls";
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
  formatScoreFeedback,
  normalizeSoloScoreFeedback,
  resolvePendingH2HScoreFeedback,
  scoreFeedbackFromH2HMove,
  scoreFeedbackFromH2HSnapshot,
  selectSquareLines,
  squareSignature,
  type ScoreFeedbackEvent,
} from "./score-feedback";

const HUMAN_VS_EUCLID_LABEL = "Redditor vs Euclid";
const HUMAN_VS_HUMAN_LABEL = "Redditor vs Redditor";
const WATCH_OTHER_REDDITORS_LIVE_GAMES_LABEL =
  "Watch Other Redditor's Live Games";
const LEADERBOARD_LABEL = "Leaderboard";
const EUCLID_LABEL = "Euclid";

/* ===== app version (tiny watermark) ===== */
const VersionStamp: React.FC<{ version?: string | undefined }> = ({
  version,
}) => {
  const label = !version
    ? "loading"
    : version.startsWith("v")
      ? version
      : `v${version}`;
  return (
    <div
      style={{
        position: "fixed",
        top: 6,
        right: 8,
        fontSize: 10,
        lineHeight: 1,
        opacity: 0.6,
        color: "var(--muted)",
        zIndex: 80,
      }}
    >
      {label}
    </div>
  );
};
/* ===== theme (FOLLOW user/Devvit light/dark) ===== */
const GlobalStyles = () => (
  <style>{`
    /* --- Light theme defaults --- */
    :root{
      --bg:#f8fafc; --text:#111827; --muted:#4b5563;
      --card-bg:#ffffff; --card-border:#e5e7eb; --error-text:#b91c1c;

      --empty-fill:#f3f4f6; --empty-stroke:#9ca3af;

      --dot-red-stroke:#ef4444; --dot-red-fill:#fee2e2;
      --dot-blue-stroke:#3b82f6; --dot-blue-fill:#dbeafe;

      --line-red:252,97,97; --line-blue:96,165,250;

      --pill-red:rgba(239,68,68,.10); --pill-blue:rgba(59,130,246,.10);

      --last-red-ring:rgba(239,68,68,.65);
      --last-blue-ring:rgba(59,130,246,.65);
      --last-red-glow:rgba(239,68,68,.35);
      --last-blue-glow:rgba(59,130,246,.35);

    }

    /* --- Prefer dark: OS/browser choice --- */
    @media (prefers-color-scheme: dark) {
      :root{
        --bg:#0b1220; --text:#f3f4f6; --muted:#9ca3af;
        --card-bg:#111827; --card-border:#374151; --error-text:#fca5a5;

        --empty-fill:#1f2937; --empty-stroke:#d1d5db;

        --dot-red-stroke:#ef4444; --dot-red-fill:#7f1d1d;
        --dot-blue-stroke:#3b82f6; --dot-blue-fill:#1e3a8a;

        --line-red:252,97,97; --line-blue:96,165,250;

        --pill-red:rgba(239,68,68,.20); --pill-blue:rgba(59,130,246,.20);

        --last-red-ring:rgba(239,68,68,.80);
        --last-blue-ring:rgba(59,130,246,.80);
        --last-red-glow:rgba(239,68,68,.50);
        --last-blue-glow:rgba(59,130,246,.50);

      }
    }

    /* --- Explicit Dev/host toggles (classes/attributes) override OS --- */
    html.dark, body.dark,
    html[data-theme="dark"], body[data-theme="dark"],
    html[data-color-scheme="dark"], body[data-color-scheme="dark"]{
      --bg:#0b1220; --text:#f3f4f6; --muted:#9ca3af;
      --card-bg:#111827; --card-border:#374151; --error-text:#fca5a5;

      --empty-fill:#1f2937; --empty-stroke:#d1d5db;

      --dot-red-stroke:#ef4444; --dot-red-fill:#7f1d1d;
      --dot-blue-stroke:#3b82f6; --dot-blue-fill:#1e3a8a;

      --line-red:252,97,97; --line-blue:96,165,250;

      --pill-red:rgba(239,68,68,.20); --pill-blue:rgba(59,130,246,.20);

      --last-red-ring:rgba(239,68,68,.80);
      --last-blue-ring:rgba(59,130,246,.80);
      --last-red-glow:rgba(239,68,68,.50);
      --last-blue-glow:rgba(59,130,246,.50);

    }
    html.light, body.light,
    html[data-theme="light"], body[data-theme="light"],
    html[data-color-scheme="light"], body[data-color-scheme="light"]{
      --bg:#f8fafc; --text:#111827; --muted:#4b5563;
      --card-bg:#ffffff; --card-border:#e5e7eb; --error-text:#b91c1c;

      --empty-fill:#f3f4f6; --empty-stroke:#9ca3af;

      --dot-red-stroke:#ef4444; --dot-red-fill:#fee2e2;
      --dot-blue-stroke:#3b82f6; --dot-blue-fill:#dbeafe;

      --line-red:252,97,97; --line-blue:96,165,250;

      --pill-red:rgba(239,68,68,.10); --pill-blue:rgba(59,130,246,.10);

      --last-red-ring:rgba(239,68,68,.65);
      --last-blue-ring:rgba(59,130,246,.65);
      --last-red-glow:rgba(239,68,68,.35);
      --last-blue-glow:rgba(59,130,246,.35);

    }

    html, body, #root { height: 100%; background: var(--bg); }
    body { color-scheme: light dark; margin: 0; overflow: hidden; }

    .glow-red { box-shadow: 0 0 0 3px rgba(239,68,68,.6), 0 0 18px rgba(239,68,68,.45); }
	.glow-blue{ box-shadow: 0 0 0 3px rgba(59,130,246,.6), 0 0 18px rgba(59,130,246,.45); }

	/* Updated hint styles - match player color with pulsing */
	.hint-red-bright { 
	    animation: pulse-red-bright 1.5s ease-in-out infinite;
	}
	.hint-red-dim { 
	    animation: pulse-red-dim 1.5s ease-in-out infinite;
	}
	.hint-blue-bright { 
	    animation: pulse-blue-bright 1.5s ease-in-out infinite;
	}
	.hint-blue-dim { 
	    animation: pulse-blue-dim 1.5s ease-in-out infinite;
	}

	@keyframes pulse-red-bright {
	    0%, 100% { box-shadow: 0 0 0 5px rgba(239,68,68,.85), 0 0 20px rgba(239,68,68,.60); }
	    50% { box-shadow: 0 0 0 7px rgba(239,68,68,.95), 0 0 26px rgba(239,68,68,.70); }
	}
	@keyframes pulse-red-dim {
	    0%, 100% { box-shadow: 0 0 0 4px rgba(239,68,68,.50), 0 0 14px rgba(239,68,68,.35); }
	    50% { box-shadow: 0 0 0 5px rgba(239,68,68,.60), 0 0 16px rgba(239,68,68,.45); }
	}
	@keyframes pulse-blue-bright {
	    0%, 100% { box-shadow: 0 0 0 5px rgba(59,130,246,.85), 0 0 20px rgba(59,130,246,.60); }
	    50% { box-shadow: 0 0 0 7px rgba(59,130,246,.95), 0 0 26px rgba(59,130,246,.70); }
	}
	@keyframes pulse-blue-dim {
	    0%, 100% { box-shadow: 0 0 0 4px rgba(59,130,246,.50), 0 0 14px rgba(59,130,246,.35); }
	    50% { box-shadow: 0 0 0 5px rgba(59,130,246,.60), 0 0 16px rgba(59,130,246,.45); }
	}

    .assist__dim { opacity: 0.42; }

    .anim__animated{animation-duration:.6s;animation-fill-mode:both;}
    @keyframes zoomIn_kf{from{opacity:0;transform:scale3d(.3,.3,.3)}50%{opacity:1}}
    .anim__zoomIn{animation-name:zoomIn_kf}
    @keyframes lastPulse{0%{transform:scale(1)}50%{transform:scale(1.06)}100%{transform:scale(1)}}
    .last__pulse{animation:lastPulse 900ms ease-out 2}
  `}</style>
);

/* ===== Simple Confetti (no deps) ===== */
const Confetti: React.FC<{ show: boolean }> = ({ show }) => {
  const ref = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    if (!show) return;
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    let w = (canvas.width = window.innerWidth),
      h = (canvas.height = window.innerHeight);
    const onResize = () => {
      w = canvas.width = window.innerWidth;
      h = canvas.height = window.innerHeight;
    };
    window.addEventListener("resize", onResize);
    const colors = [
      "#ef4444",
      "#f59e0b",
      "#10b981",
      "#3b82f6",
      "#a855f7",
      "#ec4899",
    ];
    const N = 140;
    const parts = Array.from({ length: N }, () => ({
      x: Math.random() * w,
      y: -20 - Math.random() * h * 0.5,
      vx: (Math.random() - 0.5) * 2,
      vy: 2 + Math.random() * 3,
      size: 6 + Math.random() * 6,
      rot: Math.random() * Math.PI,
      vr: (Math.random() - 0.5) * 0.2,
      color: colors[Math.floor(Math.random() * colors.length)] ?? "#ef4444",
    }));
    let animationFrameId: number | undefined;
    let previousFrameAt = performance.now();
    const tick = (t: number) => {
      const dt = Math.min(32, t - previousFrameAt);
      previousFrameAt = t;
      ctx.clearRect(0, 0, w, h);
      for (const p of parts) {
        p.x += (p.vx * dt) / 16;
        p.y += (p.vy * dt) / 16;
        p.rot += (p.vr * dt) / 16;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size);
        ctx.restore();
      }

      // A rotated square always fits within this radius. Since every piece
      // moves downward, it cannot re-enter after its top clears the viewport.
      const allPiecesHaveExited = parts.every(
        (p) => p.y - p.size / Math.SQRT2 > h,
      );
      if (!allPiecesHaveExited) {
        animationFrameId = requestAnimationFrame(tick);
      }
    };
    animationFrameId = requestAnimationFrame(tick);
    return () => {
      if (animationFrameId !== undefined) {
        cancelAnimationFrame(animationFrameId);
      }
      window.removeEventListener("resize", onResize);
    };
  }, [show]);
  if (!show) return null;
  return (
    <canvas
      ref={ref}
      style={{ position: "fixed", inset: 0, pointerEvents: "none", zIndex: 55 }}
    />
  );
};

/* ===== Score card ===== */
const ScoreCard: React.FC<{
  label: string;
  score: number;
  align: "left" | "right";
  glow?: "red" | "blue" | null;
  avatar?: string | undefined;
  compact?: boolean;
  feedback?: ScoreFeedbackEvent | null;
}> = ({
  label,
  score,
  align,
  glow = null,
  avatar,
  compact = false,
  feedback = null,
}) => {
  const width = compact
    ? "clamp(160px, 44vw, 210px)"
    : "clamp(200px, 42vw, 230px)";
  return (
    <div
      className={`euclid-score-card-wrap flex flex-col ${align === "right" ? "items-end" : "items-start"}`}
    >
      <div
        className={`euclid-score-card flex items-center justify-between px-3 py-1 rounded-md shadow-sm ${glow === "red" ? "glow-red" : ""} ${glow === "blue" ? "glow-blue" : ""}`}
        style={{
          width,
          background: "var(--card-bg)",
          border: `1px solid var(--card-border)`,
        }}
      >
        <div
          className="flex items-center gap-2"
          style={{ color: "var(--text)", minWidth: 0 }}
        >
          {avatar ? (
            <img
              src={avatar}
              alt=""
              crossOrigin="anonymous"
              style={{ width: 22, height: 22, borderRadius: "50%" }}
            />
          ) : (
            <span
              style={{
                width: 22,
                height: 22,
                borderRadius: "50%",
                background: "var(--empty-stroke)",
              }}
            />
          )}
          <span
            className="font-medium"
            style={{
              display: "inline-block",
              overflow: "hidden",
              whiteSpace: "nowrap",
              textOverflow: "ellipsis",
              maxWidth: compact ? 120 : 150,
            }}
            title={label}
          >
            {label}
          </span>
        </div>
        <span className="font-semibold" style={{ color: "var(--text)" }}>
          {score}
        </span>
        {feedback && (
          <span
            key={feedback.id}
            className={`euclid-score-card__delta euclid-score-card__delta--${feedback.player === 0 ? "red" : "blue"}`}
            aria-hidden="true"
          >
            {formatScoreFeedback(feedback)}
          </span>
        )}
        <span
          className="euclid-sr-only"
          role="status"
          aria-live="polite"
          aria-atomic="true"
        >
          {feedback
            ? `Move ${feedback.moveCount}: ${label} scored ${feedback.pointsScored} points by completing ${feedback.completedSquares.length} ${feedback.completedSquares.length === 1 ? "square" : "squares"}.`
            : ""}
        </span>
      </div>
    </div>
  );
};

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

type LiveGameSummary = {
  gameId: string;
  names: Record<string, string>;
  scores: [number, number];
  lastSaved: number;
  ended?: boolean;
};

type ShareResponse = {
  ok?: boolean;
  message?: string;
  status?: SoloShareResponse["status"];
};

type BrowserAudioWindow = Window &
  typeof globalThis & {
    webkitAudioContext?: typeof AudioContext;
  };

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) return error.message;
  return typeof error === "string" && error ? error : fallback;
}

function reportRequestFailure(action: string, error: unknown): void {
  console.warn(`[Euclid] ${action} failed:`, error);
}

function trapDialogTab(event: React.KeyboardEvent<HTMLElement>): void {
  if (event.key !== "Tab") return;
  const focusable = Array.from(
    event.currentTarget.querySelectorAll<HTMLElement>(
      "input:not(:disabled), button:not(:disabled), [href], [tabindex]:not([tabindex='-1'])",
    ),
  );
  if (focusable.length === 0) {
    event.preventDefault();
    event.currentTarget.focus();
    return;
  }

  const activeIndex = focusable.indexOf(document.activeElement as HTMLElement);
  const leavingStart = event.shiftKey && activeIndex <= 0;
  const leavingEnd = !event.shiftKey && activeIndex === focusable.length - 1;
  if (activeIndex === -1 || leavingStart || leavingEnd) {
    event.preventDefault();
    const target = event.shiftKey
      ? focusable[focusable.length - 1]
      : focusable[0];
    target?.focus();
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
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

const formatDisplayDate = (input: string | number | Date = Date.now()) =>
  new Date(input).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });

const boardScoringLabel = (scoring: SerializableBoard["scoring"]) =>
  scoring === "true" ? "True Area" : "Grid Footprint";

/* ===== App (UI + flows) ===== */
type Mode =
  | "ai"
  | "multiplayer"
  | "spectate"
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

export const App = () => {
  const appliedThemeRef = useRef<ThemeMode | null>(null);
  const [initState, setInitState] = useState<InitResponse | null>(null);
  const [initError, setInitError] = useState("");
  const [mode, setMode] = useState<Mode>(null);
  const [board, setBoard] = useState<Board | null>(null);
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

  // Difficulty default -> Beginner
  const [selectedDifficulty, setSelectedDifficulty] =
    useState<AiDifficulty>("beginner");
  const [soloMode, setSoloMode] = useState<SoloMode>("practice");

  // Independent W/H (even)
  const evenSizes = [4, 6, 8, 10, 12, 14, 16];
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

  // Sounds
  const [soundOn, setSoundOn] = useState(false);
  const audioContext = useMemo(() => {
    const AudioContextConstructor =
      window.AudioContext || (window as BrowserAudioWindow).webkitAudioContext;
    if (!AudioContextConstructor) {
      throw new Error("This browser does not support Web Audio.");
    }
    return new AudioContextConstructor();
  }, []);
  const SOUND_GAIN = 0.125;
  const playBeep = useCallback(() => {
    if (!soundOn) return;
    const oscillator = audioContext.createOscillator();
    const gainNode = audioContext.createGain();
    oscillator.connect(gainNode);
    gainNode.connect(audioContext.destination);
    oscillator.type = "square";
    oscillator.frequency.value = 880; // A5 note
    gainNode.gain.value = SOUND_GAIN;
    oscillator.start();
    setTimeout(() => oscillator.stop(), 100);
  }, [audioContext, soundOn]);
  const playFanfare = useCallback(() => {
    if (!soundOn) return;
    const notes = [523.25, 659.25, 783.99, 1046.5]; // C E G C
    notes.forEach((freq, i) => {
      setTimeout(() => {
        const oscillator = audioContext.createOscillator();
        const gainNode = audioContext.createGain();
        oscillator.connect(gainNode);
        gainNode.connect(audioContext.destination);
        oscillator.type = "sine";
        oscillator.frequency.value = freq;
        gainNode.gain.value = SOUND_GAIN;
        oscillator.start();
        setTimeout(() => oscillator.stop(), 200);
      }, i * 250);
    });
  }, [audioContext, soundOn]);

  // Tutorial/onboarding
  const [tutorialCompletedThisSession, setTutorialCompletedThisSession] =
    useState(false);
  useEffect(() => {
    const previewOnboardingSeen = hasStoredCompletion(PREVIEW_ONBOARDING_KEY);
    const fullTutorialCompleted = hasStoredCompletion(FULL_TUTORIAL_KEY);
    setShowTutorial(
      shouldShowFullTutorial(mode, {
        previewDemoCompleted: previewOnboardingSeen,
        fullTutorialCompleted,
        completedThisSession: tutorialCompletedThisSession,
      }),
    );
  }, [mode, tutorialCompletedThisSession]);

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
      if (payload.events.some((event) => event.type === "move")) playBeep();
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
    playBeep,
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
        if (payload.events.some((event) => event.type === "move")) playBeep();
        const presentation = getSoloResultPresentation(payload.snapshot);
        if (
          shouldRunVictoryEffects(
            presentation.terminal,
            presentation.isLocalVictory,
          )
        ) {
          playFanfare();
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
    [adoptSoloSnapshot, enqueueScoreFeedback, playBeep, playFanfare],
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
      reportRequestFailure("refreshing the multiplayer game", error);
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
  }, [adoptHomeH2HPresence, enterH2HGame, stopPolling]);

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
  const [games, setGames] = useState<LiveGameSummary[]>([]);
  const [loadingGames, setLoadingGames] = useState(true);
  const gamesRequestRef = useRef(0);
  const loadGames = useCallback(async () => {
    const request = ++gamesRequestRef.current;
    setLoadingGames(true);
    try {
      const r = await fetch("/api/games/list");
      const j = (await r.json()) as { games?: LiveGameSummary[] };
      if (gamesRequestRef.current !== request) return;
      setGames(
        (j.games ?? []).slice().sort((a, b) => b.lastSaved - a.lastSaved),
      );
    } catch (error) {
      if (gamesRequestRef.current !== request) return;
      reportRequestFailure("loading live games", error);
      setGames([]);
    } finally {
      if (gamesRequestRef.current === request) setLoadingGames(false);
    }
  }, []);

  /* ===== Rankings ===== */
  const [rankings, setRankings] = useState<{
    hvh: RankingsShareRow[];
    hva: RankingsShareRow[];
    hvaRules?: RankingsResponse["hvaRules"];
  }>({ hvh: [], hva: [] });
  const rankingsRequestRef = useRef(0);
  const loadRankings = useCallback(async () => {
    const request = ++rankingsRequestRef.current;
    try {
      const r = await fetch("/api/rankings");
      const j = (await r.json()) as RankingsResponse;
      if (rankingsRequestRef.current !== request) return;
      setRankings({
        hvh: j.hvh ?? [],
        hva: j.hva ?? [],
        ...(j.hvaRules ? { hvaRules: j.hvaRules } : {}),
      });
    } catch (error) {
      if (rankingsRequestRef.current !== request) return;
      reportRequestFailure("loading rankings", error);
      setRankings({ hvh: [], hva: [] });
    }
  }, []);

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
      if (enterH2HGame(payload)) return true;
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
    void loadGames();
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

        playBeep();
        const localSide: PlayerColor = isPlayer1Ref.current ? 1 : 2;
        if (
          shouldRunVictoryEffects(
            payload.ended,
            isLocalVictory(payload.victorSide, localSide, false),
          )
        ) {
          playFanfare();
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
    [
      adoptH2HState,
      flushDeferredH2HScoreFeedback,
      playBeep,
      playFanfare,
      refreshStateOnce,
    ],
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
        !getSoloAssistancePolicy(snapshot.mode).allowSecretAutoMove ||
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

  /* ===== Rules Overlay ===== */
  const RulesOverlay = showRules ? (
    <div
      className="anim__animated anim__zoomIn"
      onClick={() => setShowRules(false)}
      style={{
        position: "fixed",
        inset: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 60,
        background: "rgba(0,0,0,.55)",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "var(--card-bg)",
          color: "var(--text)",
          border: `1px solid var(--card-border)`,
          borderRadius: 12,
          padding: "16px 22px",
          maxWidth: 680,
          width: "min(92vw, 680px)",
          maxHeight: "82vh",
          overflowY: "auto",
          fontSize: "0.95rem",
        }}
      >
        <div style={{ fontSize: "1.125rem", fontWeight: 800, marginBottom: 8 }}>
          How to Play — Euclid
        </div>
        <ul style={{ paddingLeft: "1.2em", listStyle: "disc" }}>
          <li>Players take turns placing a dot on a grid.</li>
          <li>
            A <b>square</b> is completed when all four of its corner cells are
            your color. The four corners don't need to be axis-aligned — they
            can form a rotated square.
          </li>
          <li>
            <b>Scoring ({HUMAN_VS_EUCLID_LABEL} mode configurable):</b>{" "}
            <i>Grid Footprint</i> counts every grid position in the smallest
            grid-aligned square containing the four corner dots.{" "}
            <i>True Area</i> uses the geometric side².
          </li>
          <li>One move can complete multiple squares; you score the sum.</li>
          <li>
            First to the selected <b>Win Score</b> wins; if the board fills with
            unequal points, higher total wins.
          </li>
        </ul>
        <div
          className="mt-3"
          style={{ display: "flex", justifyContent: "flex-end", marginTop: 12 }}
        >
          <button
            className="rounded cursor-pointer"
            style={{
              background: "#d93900",
              color: "#fff",
              padding: "6px 12px",
            }}
            onClick={() => setShowRules(false)}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  ) : null;

  /* ===== Tutorial Modal ===== */
  const TutorialModal = showTutorial ? (
    <div
      className="anim__animated anim__zoomIn"
      onClick={completeTutorial}
      style={{
        position: "fixed",
        inset: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 60,
        background: "rgba(0,0,0,.55)",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "var(--card-bg)",
          color: "var(--text)",
          border: `1px solid var(--card-border)`,
          borderRadius: 12,
          padding: "16px 22px",
          maxWidth: 680,
          width: "min(92vw, 680px)",
          maxHeight: "82vh",
          overflowY: "auto",
          fontSize: "0.95rem",
        }}
      >
        <div style={{ fontSize: "1.125rem", fontWeight: 800, marginBottom: 8 }}>
          Welcome to Euclid — Tutorial
        </div>
        <ol style={{ paddingLeft: "1.2em", listStyle: "decimal" }}>
          <li>Place dots on the grid alternately with the other side.</li>
          <li>
            Form squares by connecting four dots of your color (can be rotated).
          </li>
          <li>
            Score Grid Footprint points (grid positions²), or choose True Area
            (geometric side²).
          </li>
          <li>Reach the win score first to victory!</li>
        </ol>
        <div
          style={{ display: "flex", justifyContent: "flex-end", marginTop: 12 }}
        >
          <button
            className="rounded cursor-pointer"
            style={{
              background: "#2563eb",
              color: "#fff",
              padding: "6px 12px",
            }}
            onClick={completeTutorial}
          >
            Start Playing
          </button>
        </div>
      </div>
    </div>
  ) : null;

  /* ===== Chat Input Overlay ===== */
  const ChatOverlay =
    !chatOpen || chatBlockedByOverlay ? null : (
      <div
        className="euclid-chat-backdrop"
        style={{
          position: "fixed",
          inset: 0,
          display: "flex",
          alignItems: "flex-end",
          justifyContent: "center",
          zIndex: 100,
          background: "rgba(0,0,0,.18)",
        }}
        onClick={() => {
          if (h2hMutation !== "chat") closeChat();
        }}
      >
        <div
          id="euclid-game-chat-dialog"
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
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 8,
            width: "min(720px, 96vw)",
            background: "var(--card-bg)",
            border: `1px solid var(--card-border)`,
            borderRadius: 10,
            padding: 8,
          }}
        >
          <h2 id="euclid-game-chat-title" className="euclid-sr-only">
            Game chat
          </h2>
          <div className="euclid-chat-composer">
            <input
              autoFocus
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
              className="euclid-chat-composer__cancel rounded cursor-pointer"
              disabled={h2hMutation === "chat"}
              onClick={() => closeChat()}
            >
              Cancel
            </button>
            <button
              type="button"
              className={`euclid-chat-composer__send rounded ${h2hMutation === "chat" ? "" : "cursor-pointer"}`}
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
        {RulesOverlay}
        <HomeScreen
          username={initState?.username ?? ""}
          playEuclidSubtitle={getPlayEuclidSubtitle(soloMode)}
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
          onPlayEuclid={() => void startSoloFromHome()}
          onPlayRedditor={() => void startMultiplayerQueue()}
          onContinueSolo={() => void continueSoloFromHome()}
          onContinueH2H={() => void continueH2HFromHome()}
          onCancelSearch={() => void cancelMultiplayerQueue()}
          onWatchGames={() => {
            if (navigationLocked) return;
            stopHomePresenceMonitoring();
            setMode("spectate");
            void loadGames();
          }}
          onLeaderboard={() => {
            if (navigationLocked) return;
            stopHomePresenceMonitoring();
            setMode("rankings");
            void loadRankings();
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
  } else if (mode === "options") {
    /* ===== Options Page (mobile scrollable) ===== */
    content = (
      <div
        className="flex flex-col items-center"
        style={{ background: "var(--bg)", height: "100vh", overflow: "hidden" }}
      >
        <div style={{ paddingTop: 16, paddingBottom: 8 }}>
          <h1
            className="text-2xl font-bold text-center"
            style={{ color: "var(--text)" }}
          >
            Euclid — Options
          </h1>
        </div>

        {/* Scrollable content area */}
        <div
          className="flex-1 overflow-y-auto w-full flex flex-col items-center"
          style={{ paddingBottom: 8 }}
        >
          <div
            className="w-[min(760px,96vw)]"
            style={{
              background: "var(--card-bg)",
              border: `1px solid var(--card-border)`,
              borderRadius: 12,
              padding: "12px 16px",
            }}
          >
            <div className="font-bold mb-2" style={{ color: "var(--muted)" }}>
              {HUMAN_VS_EUCLID_LABEL} Settings
            </div>
            <div
              role="radiogroup"
              aria-label="Solo game type"
              className="flex gap-2 mb-3"
            >
              {(["ranked", "practice"] as const).map((choice) => {
                const selected = soloMode === choice;
                return (
                  <button
                    key={choice}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    className="rounded cursor-pointer"
                    style={{
                      padding: "7px 14px",
                      background: selected ? "#2563eb" : "var(--card-bg)",
                      color: selected ? "#fff" : "var(--text)",
                      border: `1px solid ${selected ? "#2563eb" : "var(--card-border)"}`,
                    }}
                    onClick={() => setSoloMode(choice)}
                  >
                    {choice === "ranked" ? "Ranked" : "Practice"}
                  </button>
                );
              })}
            </div>
            {soloMode === "ranked" && (
              <div
                style={{
                  color: "var(--text)",
                  background: "var(--bg)",
                  border: `1px solid var(--card-border)`,
                  borderRadius: 8,
                  padding: "10px 12px",
                }}
              >
                Ranked uses one comparable preset: 8×8, Grid Footprint, first to
                150, you move first, and Brutal Euclid. Assistance is off.
              </div>
            )}
            <div
              className="grid"
              style={{
                display: soloMode === "practice" ? "grid" : "none",
                gridTemplateColumns: "repeat(auto-fit, minmax(220px,1fr))",
                gap: 12,
              }}
            >
              <div>
                <label
                  className="font-medium block mb-1"
                  style={{ color: "var(--muted)" }}
                >
                  Difficulty
                </label>
                <select
                  className="rounded px-3 py-2 w-full"
                  style={{
                    background: "var(--card-bg)",
                    color: "var(--text)",
                    border: `1px solid var(--card-border)`,
                  }}
                  value={selectedDifficulty}
                  onChange={(event) => {
                    const difficulty = event.target.value;
                    if (isAiDifficulty(difficulty)) {
                      setSelectedDifficulty(difficulty);
                    }
                  }}
                >
                  {AI_DIFFICULTIES.map((difficulty) => (
                    <option key={difficulty} value={difficulty}>
                      {AI_DIFFICULTY_LABELS[difficulty]}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label
                  className="font-medium block mb-1"
                  style={{ color: "var(--muted)" }}
                >
                  Board Width
                </label>
                <select
                  className="rounded px-3 py-2 w-full"
                  style={{
                    background: "var(--card-bg)",
                    color: "var(--text)",
                    border: `1px solid var(--card-border)`,
                  }}
                  value={boardW}
                  onChange={(e) => setBoardW(Number(e.target.value))}
                >
                  {evenSizes.map((n) => (
                    <option key={"w" + n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label
                  className="font-medium block mb-1"
                  style={{ color: "var(--muted)" }}
                >
                  Board Height
                </label>
                <select
                  className="rounded px-3 py-2 w-full"
                  style={{
                    background: "var(--card-bg)",
                    color: "var(--text)",
                    border: `1px solid var(--card-border)`,
                  }}
                  value={boardH}
                  onChange={(e) => setBoardH(Number(e.target.value))}
                >
                  {evenSizes.map((n) => (
                    <option key={"h" + n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label
                  className="font-medium block mb-1"
                  style={{ color: "var(--muted)" }}
                >
                  Scoring
                </label>
                <select
                  className="rounded px-3 py-2 w-full"
                  style={{
                    background: "var(--card-bg)",
                    color: "var(--text)",
                    border: `1px solid var(--card-border)`,
                  }}
                  value={scoringMode}
                  onChange={(e) =>
                    setScoringMode(e.target.value as "bbox" | "true")
                  }
                >
                  <option value="bbox">Grid Footprint (grid positions²)</option>
                  <option value="true">True Area (side²)</option>
                </select>
              </div>

              <div>
                <label
                  className="font-medium block mb-1"
                  style={{ color: "var(--muted)" }}
                >
                  Win Score
                </label>
                <input
                  type="number"
                  min={1}
                  max={bestCase}
                  value={winScore}
                  onChange={(e) =>
                    setWinScore(
                      Math.max(
                        1,
                        Math.min(bestCase, Number(e.target.value) || 0),
                      ),
                    )
                  }
                  className="rounded px-3 py-2 w-full"
                  style={{
                    background: "var(--card-bg)",
                    color: "var(--text)",
                    border: `1px solid var(--card-border)`,
                  }}
                />
                <div className="text-xs mt-1" style={{ color: "var(--muted)" }}>
                  Best-case per player for {boardW}×{boardH} (
                  {boardScoringLabel(scoringMode)}): <b>{bestCase}</b>
                  <br />
                  Recommended win (8×8→150 scaled): <b>{recommended}</b>
                </div>
              </div>

              <div>
                <label
                  className="font-medium block mb-1"
                  style={{ color: "var(--muted)" }}
                >
                  Assist Highlights (hover)
                </label>
                <div className="flex items-center gap-2">
                  <input
                    id="assistChk"
                    type="checkbox"
                    checked={assistOn}
                    onChange={(e) => setAssistOn(e.target.checked)}
                  />
                  <label
                    htmlFor="assistChk"
                    className="text-sm"
                    style={{ color: "var(--muted)" }}
                  >
                    Show 1–2 move-away spots when hovering your pieces
                  </label>
                </div>
              </div>
            </div>
          </div>

          <div
            className="w-[min(760px,96vw)]"
            style={{
              background: "var(--card-bg)",
              border: `1px solid var(--card-border)`,
              borderRadius: 12,
              padding: "12px 16px",
              marginTop: 12,
            }}
          >
            <div className="font-bold mb-2" style={{ color: "var(--muted)" }}>
              About Euclid
            </div>
            <div style={{ color: "var(--text)", lineHeight: 1.6 }}>
              Euclid is a Reddit strategy game about placing dots, completing
              squares, and outscoring {EUCLID_LABEL} or another redditor.
              Straight and rotated squares both count, and one move can complete
              multiple squares at once.
            </div>
            <div
              style={{
                color: "var(--muted)",
                fontSize: "0.875rem",
                marginTop: 10,
              }}
            >
              Version:{" "}
              <b style={{ color: "var(--text)" }}>
                {initState?.appVersion || "loading"}
              </b>
            </div>
          </div>
        </div>

        {/* Footer / OK */}
        <div style={{ padding: 12 }}>
          <button
            className="rounded cursor-pointer"
            style={{
              background: "#6b7280",
              color: "#fff",
              padding: "8px 16px",
            }}
            onClick={returnHome}
          >
            Done
          </button>
        </div>
      </div>
    );
  } else if (mode === "rankings") {
    /* ===== Rankings ===== */
    const rankingsSharePending = shareBusy?.startsWith("rankings:") ?? false;
    const numCell = {
      color: "var(--text)",
      textAlign: "right" as const,
      fontVariantNumeric: "tabular-nums" as const,
    };
    const headCell = {
      color: "var(--muted)",
      fontWeight: 700,
      textAlign: "right" as const,
    };
    const Section = ({
      title,
      subtitle,
      rows,
      accent,
      bucket,
    }: {
      title: string;
      subtitle?: string;
      rows: RankingsShareRow[];
      accent: "red" | "blue";
      bucket: ShareBucket;
    }) => (
      <div className="w-[min(720px,92vw)]">
        <div>
          <div className="flex items-center justify-between mb-2">
            <h2
              className="text-xl font-extrabold"
              style={{ color: "var(--text)" }}
            >
              {title}
            </h2>
          </div>
          {subtitle && (
            <div className="text-sm mb-2" style={{ color: "var(--muted)" }}>
              {subtitle}
            </div>
          )}
          <div
            className="rounded-lg overflow-hidden overflow-x-auto"
            style={{ border: `1px solid var(--card-border)` }}
          >
            <table
              style={{
                width: "100%",
                borderCollapse: "collapse",
                background: "var(--card-bg)",
                minWidth: 620,
              }}
            >
              <thead>
                <tr>
                  <th
                    style={{
                      padding: "8px 12px",
                      borderBottom: `1px solid var(--card-border)`,
                      ...headCell,
                      textAlign: "left" as const,
                    }}
                  >
                    Rank
                  </th>
                  <th
                    style={{
                      padding: "8px 12px",
                      borderBottom: `1px solid var(--card-border)`,
                      ...headCell,
                      textAlign: "left" as const,
                    }}
                  >
                    Redditor
                  </th>
                  <th
                    style={{
                      padding: "8px 12px",
                      borderBottom: `1px solid var(--card-border)`,
                      ...headCell,
                    }}
                  >
                    Rating
                  </th>
                  <th
                    style={{
                      padding: "8px 12px",
                      borderBottom: `1px solid var(--card-border)`,
                      ...headCell,
                    }}
                  >
                    Games
                  </th>
                  <th
                    style={{
                      padding: "8px 12px",
                      borderBottom: `1px solid var(--card-border)`,
                      ...headCell,
                    }}
                  >
                    Wins
                  </th>
                  <th
                    style={{
                      padding: "8px 12px",
                      borderBottom: `1px solid var(--card-border)`,
                      ...headCell,
                    }}
                  >
                    Losses
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => {
                  const top3 = i < 3;
                  const pill =
                    accent === "red" ? "var(--pill-red)" : "var(--pill-blue)";
                  return (
                    <tr
                      key={r.userId}
                      style={{
                        background: top3 ? pill : "transparent",
                        borderTop: `1px solid var(--card-border)`,
                      }}
                    >
                      <td
                        style={{
                          padding: "8px 12px",
                          fontWeight: 700,
                          color: accent === "red" ? "#b91c1c" : "#1d4ed8",
                        }}
                      >
                        {i + 1}
                      </td>
                      <td
                        style={{
                          padding: "8px 12px",
                          display: "flex",
                          alignItems: "center",
                          gap: 8,
                          color: "var(--text)",
                        }}
                      >
                        {r.avatar ? (
                          <img
                            src={r.avatar}
                            alt=""
                            crossOrigin="anonymous"
                            style={{
                              width: 24,
                              height: 24,
                              borderRadius: "50%",
                            }}
                          />
                        ) : (
                          <span
                            style={{
                              width: 24,
                              height: 24,
                              borderRadius: "50%",
                              background: "var(--empty-stroke)",
                            }}
                          />
                        )}
                        <span className="truncate" title={r.name || r.userId}>
                          {r.name || r.userId}
                        </span>
                      </td>
                      <td style={{ padding: "8px 12px", ...numCell }}>
                        {r.rating}
                      </td>
                      <td style={{ padding: "8px 12px", ...numCell }}>
                        {r.games}
                      </td>
                      <td style={{ padding: "8px 12px", ...numCell }}>
                        {r.wins}
                      </td>
                      <td style={{ padding: "8px 12px", ...numCell }}>
                        {r.losses}
                      </td>
                    </tr>
                  );
                })}
                {rows.length === 0 && (
                  <tr>
                    <td
                      colSpan={6}
                      style={{
                        padding: "16px",
                        color: "var(--muted)",
                        textAlign: "center",
                      }}
                    >
                      No ranked players yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
        <div
          style={{ marginTop: 8, display: "flex", justifyContent: "flex-end" }}
        >
          <button
            className="rounded cursor-pointer"
            disabled={rankingsSharePending}
            style={{
              background: "#16a34a",
              color: "#fff",
              padding: "6px 12px",
              opacity: rankingsSharePending ? 0.7 : 1,
            }}
            onClick={() => shareRankings(bucket)}
          >
            {shareBusy === `rankings:${bucket}`
              ? "Sharing…"
              : `Share ${LEADERBOARD_LABEL}`}
          </button>
        </div>
      </div>
    );

    content = (
      <div
        className="flex flex-col items-center"
        style={{ background: "var(--bg)", height: "100vh", overflow: "hidden" }}
      >
        {notice && (
          <div className="text-sm mb-2" style={{ color: "var(--muted)" }}>
            {notice}
          </div>
        )}
        <div style={{ paddingTop: 16, paddingBottom: 8 }}>
          <h1
            className="text-2xl font-bold text-center"
            style={{ color: "var(--text)" }}
          >
            Euclid — {LEADERBOARD_LABEL}
          </h1>
        </div>
        <div
          className="flex-1 overflow-y-auto w-full flex flex-col items-center gap-6"
          style={{ paddingBottom: 8 }}
        >
          <Section
            title={HUMAN_VS_HUMAN_LABEL}
            rows={rankings.hvh}
            accent="red"
            bucket="hvh"
          />
          <Section
            title={`${HUMAN_VS_EUCLID_LABEL} — Ranked`}
            subtitle={
              rankings.hvaRules
                ? `${rankings.hvaRules.rules.W}×${rankings.hvaRules.rules.H} • ${boardScoringLabel(rankings.hvaRules.rules.scoring)} • First to ${rankings.hvaRules.rules.winScore} • ${AI_DIFFICULTY_LABELS[rankings.hvaRules.rules.difficulty]}`
                : "8×8 • Grid Footprint • First to 150 • Brutal"
            }
            rows={rankings.hva}
            accent="blue"
            bucket="hva"
          />
        </div>
        <div style={{ padding: 12 }}>
          <button
            className="rounded cursor-pointer"
            style={{
              background: "#6b7280",
              color: "#fff",
              padding: "6px 12px",
            }}
            onClick={returnHome}
            disabled={rankingsSharePending}
            aria-busy={rankingsSharePending || undefined}
          >
            {rankingsSharePending ? "Sharing…" : "Back"}
          </button>
        </div>
      </div>
    );
  } else if (mode === "spectate") {
    /* ===== Spectate ===== */
    content = (
      <div
        className="flex flex-col items-center"
        style={{ background: "var(--bg)", height: "100vh", overflow: "hidden" }}
      >
        <div style={{ paddingTop: 16, paddingBottom: 8 }}>
          <h1
            className="text-2xl font-bold text-center"
            style={{ color: "var(--text)" }}
          >
            Euclid — {WATCH_OTHER_REDDITORS_LIVE_GAMES_LABEL}
          </h1>
        </div>
        <div
          className="flex-1 overflow-y-auto w-full flex flex-col items-center gap-4"
          style={{ paddingBottom: 8 }}
        >
          {loadingGames ? (
            <div style={{ color: "var(--text)" }}>Loading active games…</div>
          ) : games.length === 0 ? (
            <div style={{ color: "var(--muted)" }}>
              No active games right now.
            </div>
          ) : (
            games.map((g) => {
              const p1Id = Object.keys(g.names)[0] || "";
              const p2Id = Object.keys(g.names)[1] || "";
              const p1Name = g.names[p1Id] || "Redditor 1";
              const p2Name = g.names[p2Id] || "Redditor 2";
              return (
                <div
                  key={g.gameId}
                  className="w-[min(720px,92vw)]"
                  style={{
                    background: "var(--card-bg)",
                    border: `1px solid var(--card-border)`,
                    borderRadius: 12,
                    padding: "12px 16px",
                  }}
                >
                  <div className="flex justify-between items-center">
                    <div>
                      <span style={{ fontWeight: 700 }}>{p1Name}</span> (
                      {g.scores[0]}) vs{" "}
                      <span style={{ fontWeight: 700 }}>{p2Name}</span> (
                      {g.scores[1]})
                    </div>
                    <button
                      className="rounded cursor-pointer"
                      style={{
                        background: "#7c3aed",
                        color: "#fff",
                        padding: "4px 10px",
                      }}
                      onClick={() => {
                        clearScoreFeedback();
                        h2hSessionRef.current++;
                        h2hMutationRef.current = null;
                        setH2HMutation(null);
                        h2hRefreshPendingRef.current = false;
                        h2hMappingPendingRef.current = false;
                        stopPolling();
                        pollActiveRef.current = "none";
                        setGameId(g.gameId);
                        gameIdRef.current = g.gameId;
                        gameRevisionRef.current = 0;
                        setBoard(null);
                        setWinner(null);
                        setFinalSide(null);
                        setFinalReason("");
                        setNotice("");
                        setStatus("Loading live game…");
                        spectatingRef.current = true;
                        setSpectating(true);
                        setMode("multiplayer");
                        void refreshStateOnce();
                        pollGame();
                      }}
                    >
                      Watch
                    </button>
                  </div>
                  <div
                    className="text-xs"
                    style={{ color: "var(--muted)", marginTop: 4 }}
                  >
                    Last updated: {new Date(g.lastSaved).toLocaleTimeString()}
                  </div>
                </div>
              );
            })
          )}
        </div>
        <div style={{ padding: 12 }}>
          <button
            className="rounded cursor-pointer"
            style={{
              background: "#6b7280",
              color: "#fff",
              padding: "6px 12px",
            }}
            onClick={returnHome}
          >
            Back
          </button>
        </div>
      </div>
    );
  } else if (mode === "admin") {
    /* ===== Admin ===== */
    content = (
      <div
        className="flex flex-col items-center"
        style={{ background: "var(--bg)", height: "100vh", overflow: "hidden" }}
      >
        <div style={{ paddingTop: 16, paddingBottom: 8 }}>
          <h1
            className="text-2xl font-bold text-center"
            style={{ color: "var(--text)" }}
          >
            Euclid — Admin Metrics
          </h1>
        </div>

        <div
          className="w-[min(860px,94vw)] rounded-lg flex-1 overflow-y-auto"
          style={{
            background: "var(--card-bg)",
            border: `1px solid var(--card-border)`,
            padding: "4px 2px",
          }}
        >
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

        <div style={{ padding: 12 }}>
          <button
            className="rounded cursor-pointer"
            style={{
              background: "#2563eb",
              color: "#fff",
              padding: "6px 12px",
            }}
            onClick={returnHome}
          >
            ok
          </button>
        </div>
      </div>
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
              ? "Spectating — read only"
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

    const overlay =
      (notice &&
        !showTerminalResult &&
        !h2hScoreFeedback &&
        !h2hScoreFeedbackSettling) ||
      (showTerminalResult && !h2hScoreFeedback && !h2hScoreFeedbackSettling) ? (
        <div
          className="anim__animated anim__zoomIn"
          style={{
            position: "fixed",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 50,
            background: "rgba(0,0,0,.55)",
          }}
        >
          <Confetti show={shouldRunVictoryEffects(showWinner, youAreWinner)} />
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="euclid-h2h-result-title"
            tabIndex={-1}
            onKeyDown={trapDialogTab}
            style={{
              background: "var(--card-bg)",
              color: "var(--text)",
              border: `1px solid var(--card-border)`,
              borderRadius: 12,
              padding: "16px 22px",
              textAlign: "center",
              maxWidth: 520,
              zIndex: 60,
            }}
          >
            {showWinner ? (
              <>
                <div
                  id="euclid-h2h-result-title"
                  style={{
                    fontSize: "1.2rem",
                    fontWeight: 800,
                    marginBottom: 8,
                  }}
                >
                  {winnerText}
                </div>
                <div style={{ color: "var(--muted)", marginBottom: 12 }}>
                  Final: {p1Name} {board.m_players[0].m_score} —{" "}
                  {board.m_players[1].m_score} {p2Name}
                </div>
                {notice && (
                  <div style={{ color: "var(--muted)", marginBottom: 12 }}>
                    {notice}
                  </div>
                )}
              </>
            ) : finalReason === "tie" ? (
              <>
                <div
                  id="euclid-h2h-result-title"
                  style={{
                    fontSize: "1.2rem",
                    fontWeight: 800,
                    marginBottom: 8,
                  }}
                >
                  Tie game!
                </div>
                <div style={{ color: "var(--muted)", marginBottom: 12 }}>
                  Final: {p1Name} {board.m_players[0].m_score} —{" "}
                  {board.m_players[1].m_score} {p2Name}
                </div>
              </>
            ) : (
              <div
                id="euclid-h2h-result-title"
                style={{ fontSize: "1.1rem", fontWeight: 800, marginBottom: 8 }}
              >
                {notice || "Game over."}
              </div>
            )}
            {rematchAvailable && (
              <H2HRematchButton
                disabled={h2hExitPending}
                pending={h2hMutation === "rematch"}
                onClick={() => void requestH2HRematch()}
              />
            )}
            <button
              autoFocus
              type="button"
              className="rounded cursor-pointer"
              style={{
                background: "#ef4444",
                color: "#fff",
                padding: "6px 12px",
                cursor: h2hExitPending ? "wait" : "pointer",
                opacity: h2hExitPending ? 0.65 : 1,
              }}
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
              {showTerminalResult
                ? h2hExitPending && h2hMutation !== "rematch"
                  ? h2hExitPendingLabel
                  : "Close"
                : "OK"}
            </button>
            {mode === "multiplayer" &&
              showWinner &&
              youAreWinner &&
              !spectating &&
              !sharedWins.multiplayer && (
                <button
                  className="rounded cursor-pointer ml-2"
                  disabled={h2hExitPending}
                  style={{
                    background: "#16a34a",
                    color: "#fff",
                    padding: "6px 12px",
                    opacity: h2hExitPending ? 0.7 : 1,
                  }}
                  onClick={shareMultiplayerWin}
                >
                  {shareBusy === "multiplayer"
                    ? "Sharing…"
                    : h2hExitPending
                      ? "Please wait…"
                      : "Share Win"}
                </button>
              )}
          </div>
        </div>
      ) : null;

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
        p1Name={p1Name}
        p2Name={p2Name}
        midText={midText}
        glowSide={
          finalSide
            ? null
            : spectating
              ? null
              : isMyTurn
                ? isPlayer1
                  ? "red"
                  : "blue"
                : null
        }
        dimSide={
          finalSide
            ? null
            : spectating
              ? null
              : isMyTurn
                ? isPlayer1
                  ? "blue"
                  : "red"
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
      />
    );
  } else if (mode === "ai" && (!isBoardValid(board) || !soloSnapshot)) {
    content = (
      <div
        className="flex flex-col justify-center items-center gap-4"
        style={{ background: "var(--bg)", height: "100vh", overflow: "hidden" }}
      >
        <h1 className="text-2xl font-bold" style={{ color: "var(--text)" }}>
          Euclid
        </h1>
        <div style={{ color: "var(--muted)" }}>
          {status || "Loading your solo game…"}
        </div>
      </div>
    );
  } else if (mode === "ai" && isBoardValid(board) && soloSnapshot) {
    /* ===== Canonical Ranked / Practice solo ===== */
    const presentation = getSoloResultPresentation(soloSnapshot);
    const assistance = getSoloAssistancePolicy(soloSnapshot.mode);
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
    const overlay =
      presentation.terminal && !soloScoreFeedback ? (
        <div
          className="anim__animated anim__zoomIn"
          style={{
            position: "fixed",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 50,
            background: "rgba(0,0,0,.55)",
          }}
        >
          <Confetti
            show={shouldRunVictoryEffects(
              presentation.terminal,
              presentation.isLocalVictory,
            )}
          />
          <div
            style={{
              background: "var(--card-bg)",
              color: "var(--text)",
              border: `1px solid var(--card-border)`,
              borderRadius: 12,
              padding: "16px 22px",
              textAlign: "center",
            }}
          >
            <div
              style={{ fontSize: "1.2rem", fontWeight: 800, marginBottom: 8 }}
            >
              {presentation.headline}
            </div>
            <div style={{ color: "var(--muted)", marginBottom: 10 }}>
              {soloSnapshot.mode === "ranked" ? "Ranked" : "Practice"} •{" "}
              {board.W}×{board.H} • {boardScoringLabel(board.scoring)} • First
              to {board.winScore}
            </div>
            {soloSnapshot.rating && (
              <div style={{ color: "var(--muted)", marginBottom: 10 }}>
                Rating: {soloSnapshot.rating.before} →{" "}
                {soloSnapshot.rating.after}
              </div>
            )}
            {notice && (
              <div style={{ color: "var(--muted)", marginBottom: 12 }}>
                {notice}
              </div>
            )}
            <button
              className="rounded cursor-pointer"
              style={{
                background: "#ef4444",
                color: "#fff",
                padding: "6px 12px",
              }}
              onClick={() => void exitSoloGame()}
              disabled={soloExitPending}
              aria-busy={soloExitPending || undefined}
            >
              {soloExitPending ? soloExitPendingLabel : "Close"}
            </button>
            {soloSnapshot.canShare &&
              presentation.isLocalVictory &&
              !sharedWins.ai && (
                <button
                  className="rounded cursor-pointer ml-2"
                  disabled={soloExitPending}
                  style={{
                    background: "#16a34a",
                    color: "#fff",
                    padding: "6px 12px",
                    opacity: soloExitPending ? 0.7 : 1,
                  }}
                  onClick={() => void shareAiWin()}
                >
                  {shareBusy === "ai"
                    ? "Sharing…"
                    : soloExitPending
                      ? "Please wait…"
                      : "Share Win"}
                </button>
              )}
          </div>
        </div>
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
        p1Name={p1Name}
        p2Name={p2Name}
        midText={midText}
        glowSide={
          presentation.terminal ? null : board.m_turn === 0 ? "red" : "blue"
        }
        dimSide={
          presentation.terminal ? null : board.m_turn === 0 ? "blue" : "red"
        }
        overlay={overlay}
        chatItems={localChat.slice(-8)}
        chatCanCompose={soloChatAvailable}
        assistOn={assistance.allowAssistHighlights && assistOn}
        myColor={presentation.humanSide}
        scoreFeedback={soloScoreFeedback}
        futureScoreFeedback={soloScoreFeedbackQueue.slice(1)}
      />
    );
  }

  // Defensive fallback for a transient mode/state combination not routed above.
  else {
    content = (
      <div
        className="flex flex-col justify-center items-center gap-5"
        style={{ background: "var(--bg)", height: "100vh", overflow: "hidden" }}
      >
        <div style={{ color: "var(--text)" }}>Loading…</div>
      </div>
    );
  }

  const showH2HChatTrigger = !chatOpen && h2hChatAvailable;
  const globalControlsBlocked =
    chatOpen ||
    showRules ||
    showTutorial ||
    notice !== "" ||
    winner !== null ||
    finalReason !== "";

  /* ===== Unconditional globals + content + chat overlay ===== */
  return (
    <>
      <GlobalStyles />
      <VersionStamp version={initState?.appVersion} />
      {content}
      {!sharedPost && !!initState && !initError && ChatOverlay}
      {!sharedPost && !!initState && !initError && TutorialModal}
      {!sharedPost && !!initState && !initError && showH2HChatTrigger && (
        <H2HChatTrigger
          ref={chatTriggerRef}
          disabled={h2hMutation !== null}
          onClick={() => {
            openChat();
          }}
        />
      )}
      {!sharedPost && !!initState && !initError && !globalControlsBlocked && (
        <button
          type="button"
          className="euclid-sound-toggle"
          aria-label={soundOn ? "Mute game sounds" : "Turn on game sounds"}
          aria-pressed={soundOn}
          title={soundOn ? "Mute game sounds" : "Turn on game sounds"}
          onClick={() => setSoundOn(!soundOn)}
        >
          <span aria-hidden="true">{soundOn ? "🔊" : "🔇"}</span>
        </button>
      )}
    </>
  );
};

/* ===== Screen (board renderer) ===== */
const GameScreen: React.FC<{
  exitLabel:
    | "Back"
    | "Leave Game"
    | "Stop Watching"
    | "Close"
    | "End Practice"
    | "Cancel Ranked"
    | "Abandon Ranked";
  viewport: ViewportSize;
  board: Board;
  onCellClick: (x: number, y: number) => void;
  onLeave: () => void;
  exitPending?: boolean;
  exitPendingLabel?: string;
  p1Name: string;
  p2Name: string;
  midText: string;
  glowSide?: "red" | "blue" | null;
  dimSide?: "red" | "blue" | null;
  overlay: React.ReactNode;
  p1Avatar?: string | undefined;
  p2Avatar?: string | undefined;
  chatItems: Array<Pick<ShareChatItem, "id" | "sender" | "text">>;
  chatReadOnly?: boolean;
  chatCanCompose?: boolean;
  chatHasVisibleTrigger?: boolean;
  assistOn: boolean;
  myColor: PlayerColor | null;
  scoreFeedback: ScoreFeedbackEvent | null;
  futureScoreFeedback: readonly ScoreFeedbackEvent[];
}> = ({
  exitLabel,
  viewport,
  board,
  onCellClick,
  onLeave,
  exitPending = false,
  exitPendingLabel = "Finishing action…",
  p1Name,
  p2Name,
  midText,
  glowSide,
  dimSide,
  overlay,
  p1Avatar,
  p2Avatar,
  chatItems,
  chatReadOnly = false,
  chatCanCompose = false,
  chatHasVisibleTrigger = false,
  assistOn,
  myColor,
  scoreFeedback,
  futureScoreFeedback,
}) => {
  const screenRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const boardRef = useRef<HTMLDivElement>(null);
  const [boardSpace, setBoardSpace] = useState({ width: 0, height: 0 });
  // Keep score arrangement independent of board size so measurement cannot
  // alternate between stacked and side-by-side layouts.
  const isMobile = viewport.width <= 768;
  const layout = useMemo(
    () =>
      calculateBoardLayout(
        boardSpace.width,
        boardSpace.height,
        board.W,
        board.H,
      ),
    [board.H, board.W, boardSpace.height, boardSpace.width],
  );
  const {
    cellSize: cell,
    dotSize: DOT,
    boardWidth: bw,
    boardHeight: bh,
  } = layout;

  useLayoutEffect(() => {
    const screen = screenRef.current;
    const content = contentRef.current;
    const boardElement = boardRef.current;
    if (!screen || !content || !boardElement) return;

    const measure = () => {
      const style = getComputedStyle(screen);
      const horizontalPadding =
        parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
      const verticalPadding =
        parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
      // Subtract the actual title, scores, chat, controls and gaps. Their height
      // changes with wrapping, fonts and chat; a fixed allowance cannot fit them.
      const reservedHeight =
        content.getBoundingClientRect().height -
        boardElement.getBoundingClientRect().height;
      const width = Math.max(
        0,
        Math.floor(screen.clientWidth - horizontalPadding),
      );
      const height = Math.max(
        0,
        Math.floor(screen.clientHeight - verticalPadding - reservedHeight),
      );
      setBoardSpace((current) =>
        current.width === width && current.height === height
          ? current
          : { width, height },
      );
    };

    measure();
    const observer = new ResizeObserver(measure);
    for (const element of [screen, content, boardElement])
      observer.observe(element);
    return () => observer.disconnect();
  }, [viewport.width, viewport.height]);

  const [showHistoricalSquares, setShowHistoricalSquares] = useState(true);

  const orderByAngle = (
    points: readonly [SharePoint, SharePoint, SharePoint, SharePoint],
  ) => {
    const centerX =
      points.reduce((sum, point) => sum + point.x, 0) / points.length;
    const centerY =
      points.reduce((sum, point) => sum + point.y, 0) / points.length;
    return points
      .slice()
      .sort(
        (left, right) =>
          Math.atan2(left.y - centerY, left.x - centerX) -
          Math.atan2(right.y - centerY, right.x - centerX),
      );
  };

  const squarePolygonPoints = (square: ShareSquare): string =>
    orderByAngle([square.p1, square.p2, square.p3, square.p4])
      .map((point) => `${(point.x + 0.5) * cell},${(point.y + 0.5) * cell}`)
      .join(" ");

  const historicalEdges = (
    squares: readonly ShareSquare[],
    player: PlayerIndex,
    rgbVar: "--line-red" | "--line-blue",
  ): React.ReactElement[] => {
    const edges: React.ReactElement[] = [];
    const minAlpha = 0.14,
      maxAlpha = 0.9;
    for (const [squareIndex, square] of squares.entries()) {
      const alpha =
        squares.length <= 1
          ? maxAlpha
          : minAlpha +
            (squareIndex / (squares.length - 1)) * (maxAlpha - minAlpha);
      const ordered = orderByAngle([
        square.p1,
        square.p2,
        square.p3,
        square.p4,
      ]).map((point) => ({
        x: (point.x + 0.5) * cell,
        y: (point.y + 0.5) * cell,
      }));
      for (let pointIndex = 0; pointIndex < ordered.length; pointIndex++) {
        const start = ordered[pointIndex];
        const end = ordered[(pointIndex + 1) % ordered.length];
        if (!start || !end) continue;
        edges.push(
          <line
            key={`history-${player}-${squareSignature(square)}-${pointIndex}`}
            x1={start.x}
            y1={start.y}
            x2={end.x}
            y2={end.y}
            stroke={`rgba(var(${rgbVar}), ${alpha})`}
            strokeWidth="2"
          />,
        );
      }
    }
    return edges;
  };

  const firstActiveSquares =
    scoreFeedback?.player === 0 ? scoreFeedback.completedSquares : [];
  const secondActiveSquares =
    scoreFeedback?.player === 1 ? scoreFeedback.completedSquares : [];
  const futureSquareSignatures = new Set(
    futureScoreFeedback.flatMap((feedback) =>
      feedback.completedSquares.map(squareSignature),
    ),
  );
  const firstHistoricalSquares = board.m_players[0].m_squares.filter(
    (square) => !futureSquareSignatures.has(squareSignature(square)),
  );
  const secondHistoricalSquares = board.m_players[1].m_squares.filter(
    (square) => !futureSquareSignatures.has(squareSignature(square)),
  );
  const firstSquareLayers = selectSquareLines(
    firstHistoricalSquares,
    firstActiveSquares,
    showHistoricalSquares,
  );
  const secondSquareLayers = selectSquareLines(
    secondHistoricalSquares,
    secondActiveSquares,
    showHistoricalSquares,
  );
  const lines = [
    ...historicalEdges(firstSquareLayers.historical, 0, "--line-red"),
    ...historicalEdges(secondSquareLayers.historical, 1, "--line-blue"),
  ];
  const activePolygons = [
    ...firstSquareLayers.active.map((square) => (
      <polygon
        key={`active-${scoreFeedback?.id ?? "none"}-0-${squareSignature(square)}`}
        className="euclid-score-square euclid-score-square--red"
        points={squarePolygonPoints(square)}
        vectorEffect="non-scaling-stroke"
      />
    )),
    ...secondSquareLayers.active.map((square) => (
      <polygon
        key={`active-${scoreFeedback?.id ?? "none"}-1-${squareSignature(square)}`}
        className="euclid-score-square euclid-score-square--blue"
        points={squarePolygonPoints(square)}
        vectorEffect="non-scaling-stroke"
      />
    )),
  ];
  const footprintRects =
    board.scoring === "bbox" && scoreFeedback
      ? scoreFeedback.footprintBounds.map((bounds, index) => (
          <rect
            key={`${scoreFeedback.id}-footprint-${index}`}
            className={`euclid-score-footprint euclid-score-footprint--${scoreFeedback.player === 0 ? "red" : "blue"}`}
            x={bounds.x * cell + 2}
            y={bounds.y * cell + 2}
            width={Math.max(0, bounds.width * cell - 4)}
            height={Math.max(0, bounds.height * cell - 4)}
            rx={Math.max(3, Math.min(8, cell * 0.15))}
            vectorEffect="non-scaling-stroke"
          />
        ))
      : [];

  const leftGlow = glowSide === "red" ? "red" : null;
  const rightGlow = glowSide === "blue" ? "blue" : null;
  const leftDim = dimSide === "red" ? 0.5 : 1;
  const rightDim = dimSide === "blue" ? 0.5 : 1;
  const scoreBadgePosition = scoreFeedback
    ? {
        left: Math.min(
          bw - Math.min(30, bw / 2),
          Math.max(Math.min(30, bw / 2), (scoreFeedback.point.x + 0.5) * cell),
        ),
        top: Math.max(4, (scoreFeedback.point.y + 0.5) * cell - DOT / 2),
      }
    : null;

  // ===== Assist highlight logic (hover over your placed piece) =====
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  const { oneMoveTargets, twoMoveTargets } = useMemo(() => {
    const one = new Set<number>();
    const two = new Set<number>();
    if (!assistOn || hoverIdx == null || myColor == null)
      return { oneMoveTargets: one, twoMoveTargets: two };
    const W = board.W,
      H = board.H,
      arr = board.m_board;
    if (arr[hoverIdx] !== myColor)
      return { oneMoveTargets: one, twoMoveTargets: two };
    const opp = myColor === 1 ? 2 : 1;
    const x0 = hoverIdx % W,
      y0 = Math.floor(hoverIdx / W);

    for (let row = 0; row < H; row++) {
      for (let col = 0; col < W; col++) {
        const dx = col - x0,
          dy = row - y0;
        const x1 = x0 - dy,
          y1 = y0 + dx;
        const x2 = col - dy,
          y2 = row + dx;
        if (
          x1 < 0 ||
          x1 >= W ||
          y1 < 0 ||
          y1 >= H ||
          x2 < 0 ||
          x2 >= W ||
          y2 < 0 ||
          y2 >= H
        )
          continue;
        if (col === x0 && row === y0) continue;

        const idxA = row * W + col;
        const idxB = y1 * W + x1;
        const idxC = y2 * W + x2;

        const vA = arr[idxA];
        const vB = arr[idxB];
        const vC = arr[idxC];
        if (vA === undefined || vB === undefined || vC === undefined) continue;

        // Any opponent piece in the corners blocks this square for us
        if (vA === opp || vB === opp || vC === opp) continue;

        // Count empties among the three others (v0 is ours)
        const emptiesCount =
          (vA === 0 ? 1 : 0) + (vB === 0 ? 1 : 0) + (vC === 0 ? 1 : 0);

        // One or two moves away
        if (emptiesCount === 1) {
          if (vA === 0) one.add(idxA);
          if (vB === 0) one.add(idxB);
          if (vC === 0) one.add(idxC);
        } else if (emptiesCount === 2) {
          if (vA === 0) two.add(idxA);
          if (vB === 0) two.add(idxB);
          if (vC === 0) two.add(idxC);
        }
      }
    }
    return { oneMoveTargets: one, twoMoveTargets: two };
  }, [assistOn, hoverIdx, myColor, board.W, board.H, board.m_board]);

  const onCellEnter = (idx: number, v: number) => {
    if (!assistOn || myColor == null) return;
    if (v === myColor) setHoverIdx(idx);
    else setHoverIdx(null);
  };
  const clearHover = () => setHoverIdx(null);

  // Mobile touch for assist
  useEffect(() => {
    if (!assistOn || !isMobile || !boardRef.current) return;
    const boardElement = boardRef.current;
    const handleTouchMove = (e: TouchEvent) => {
      const touch = e.touches.item(0);
      if (!touch) return;
      const rect = boardElement.getBoundingClientRect();
      const tx = Math.floor((touch.clientX - rect.left) / cell);
      const ty = Math.floor((touch.clientY - rect.top) / cell);
      const idx = ty * board.W + tx;
      if (
        idx >= 0 &&
        idx < board.m_board.length &&
        board.m_board[idx] === myColor
      ) {
        setHoverIdx(idx);
      } else {
        clearHover();
      }
    };
    const handleTouchStart = (e: TouchEvent) => {
      e.preventDefault();
      handleTouchMove(e);
    };
    const handleTouchEnd = () => clearHover();
    boardElement.addEventListener("touchstart", handleTouchStart);
    boardElement.addEventListener("touchmove", handleTouchMove);
    boardElement.addEventListener("touchend", handleTouchEnd);
    boardElement.addEventListener("touchcancel", handleTouchEnd);
    return () => {
      boardElement.removeEventListener("touchstart", handleTouchStart);
      boardElement.removeEventListener("touchmove", handleTouchMove);
      boardElement.removeEventListener("touchend", handleTouchEnd);
      boardElement.removeEventListener("touchcancel", handleTouchEnd);
    };
  }, [assistOn, isMobile, cell, board.W, board.m_board, myColor]);

  const chatLogRef = useRef<HTMLDivElement>(null);
  const newestChatId = chatItems.at(-1)?.id ?? null;
  useEffect(() => {
    if (newestChatId === null || !chatLogRef.current) return;
    chatLogRef.current.scrollTop = chatLogRef.current.scrollHeight;
  }, [newestChatId]);

  return (
    <div
      ref={screenRef}
      className="euclid-game-screen"
      role="region"
      aria-label="Euclid game"
      tabIndex={overlay ? -1 : 0}
      style={{ maxHeight: viewport.height }}
    >
      {/* overlay (winner/notice) */}
      {overlay}
      <div
        ref={contentRef}
        className="euclid-game-screen__content"
        style={{ minWidth: bw }}
        inert={overlay ? true : undefined}
        aria-hidden={overlay ? true : undefined}
      >
        <h1
          className="text-2xl font-bold text-center"
          style={{ color: "var(--text)", marginTop: -4 }}
        >
          Euclid
        </h1>

        {/* Scoreboard */}
        {p1Name && p2Name && (
          <div
            className={`euclid-game-scores${isMobile ? " euclid-game-scores--stacked" : ""}`}
          >
            {(
              [
                {
                  name: p1Name,
                  score: board.m_players[0].m_score,
                  avatar: p1Avatar,
                  glow: leftGlow,
                  dim: leftDim,
                },
                {
                  name: p2Name,
                  score: board.m_players[1].m_score,
                  avatar: p2Avatar,
                  glow: rightGlow,
                  dim: rightDim,
                },
              ] as const
            ).map((player, index) => (
              <div
                key={index}
                style={{
                  gridArea: `player${index + 1}`,
                  justifySelf: isMobile
                    ? "center"
                    : index === 0
                      ? "start"
                      : "end",
                  opacity: scoreFeedback?.player === index ? 1 : player.dim,
                }}
              >
                <ScoreCard
                  label={player.name}
                  score={player.score}
                  align={index === 1 && !isMobile ? "right" : "left"}
                  glow={player.glow}
                  avatar={player.avatar}
                  compact={isMobile}
                  feedback={
                    scoreFeedback?.player === index ? scoreFeedback : null
                  }
                />
              </div>
            ))}
            <div className="euclid-game-scores__turn">{midText}</div>
          </div>
        )}

        {/* Board */}
        <div
          ref={boardRef}
          className="relative"
          style={{ width: bw, height: bh, margin: "0 auto" }}
          onMouseLeave={clearHover}
        >
          {scoreFeedback && scoreBadgePosition && (
            <div
              key={scoreFeedback.id}
              className={`euclid-score-pop euclid-score-pop--${scoreFeedback.player === 0 ? "red" : "blue"}`}
              style={scoreBadgePosition}
              aria-hidden="true"
            >
              <strong>+{scoreFeedback.pointsScored}</strong>
              <span>
                {scoreFeedback.completedSquares.length}{" "}
                {scoreFeedback.completedSquares.length === 1
                  ? "square"
                  : "squares"}
              </span>
            </div>
          )}

          {/* Overlay lines — do not intercept clicks */}
          <svg
            className="absolute top-0 left-0 w-full h-full z-10"
            style={{ pointerEvents: "none" }}
            viewBox={`0 0 ${bw} ${bh}`}
          >
            {footprintRects}
            {lines}
            {activePolygons}
          </svg>

          <div
            className="grid"
            style={{
              gridTemplateColumns: `repeat(${board.W}, ${cell}px)`,
              gridAutoRows: `${cell}px`,
              gap: 0,
            }}
          >
            {Array.from({ length: board.H }, (_, y) =>
              Array.from({ length: board.W }, (_, x) => {
                const idx = y * board.W + x;
                const v = board.m_board[idx] ?? 0;
                const isLast =
                  v > 0 && board.m_last.x === x && board.m_last.y === y;

                let fill = "var(--empty-fill)",
                  stroke = "var(--empty-stroke)",
                  extraClass = "";
                let inlineShadow: string | undefined = undefined;

                if (v === 1) {
                  fill = "var(--dot-red-fill)";
                  stroke = "var(--dot-red-stroke)";
                  if (isLast) {
                    inlineShadow =
                      "0 0 0 5px var(--last-red-ring), 0 0 18px var(--last-red-glow)";
                    extraClass = "last__pulse";
                  }
                } else if (v === 2) {
                  fill = "var(--dot-blue-fill)";
                  stroke = "var(--dot-blue-stroke)";
                  if (isLast) {
                    inlineShadow =
                      "0 0 0 5px var(--last-blue-ring), 0 0 18px var(--last-blue-glow)";
                    extraClass = "last__pulse";
                  }
                } else if (v === 0) {
                  // Assist overlays for empty spots
                  if (assistOn && hoverIdx !== null) {
                    if (oneMoveTargets.has(idx)) {
                      extraClass +=
                        myColor === 1
                          ? " hint-red-bright"
                          : " hint-blue-bright";
                    } else if (twoMoveTargets.has(idx)) {
                      extraClass +=
                        myColor === 1 ? " hint-red-dim" : " hint-blue-dim";
                    } else {
                      extraClass += " assist__dim";
                    }
                  }
                }

                const onEnter = () => onCellEnter(idx, v);

                return (
                  <div
                    key={`${y}-${x}`}
                    className="flex items-center justify-center"
                    onClick={() => onCellClick(x, y)}
                    onMouseEnter={onEnter}
                  >
                    <div
                      className={`rounded-full ${extraClass}`}
                      style={{
                        width: DOT,
                        height: DOT,
                        background: fill,
                        border: `2px solid ${stroke}`,
                        ...(inlineShadow ? { boxShadow: inlineShadow } : {}),
                      }}
                      aria-label={isLast ? "Last move" : undefined}
                      title={isLast ? "Last move" : undefined}
                    />
                  </div>
                );
              }),
            )}
          </div>
        </div>

        {/* Chat log (if provided) */}
        {chatItems && chatItems.length > 0 && (
          <div
            className="relative w-full max-w-[720px]"
            style={{
              background: "var(--card-bg)",
              border: `1px solid var(--card-border)`,
              borderRadius: 10,
              padding: "6px 8px",
              color: "var(--text)",
            }}
          >
            <div
              ref={chatLogRef}
              role="log"
              aria-label="Game chat messages"
              aria-live="polite"
              aria-relevant="additions text"
              style={{ maxHeight: "calc(30vh - 1.5rem)", overflowY: "auto" }}
            >
              {chatItems.slice(-8).map((it) => (
                <div
                  key={it.id}
                  className="euclid-chat-log__message"
                  style={{ lineHeight: 1.5 }}
                >
                  <b style={{ color: "var(--muted)" }}>{it.sender}:</b>{" "}
                  <span>{it.text}</span>
                </div>
              ))}
            </div>
            <div className="text-xs" style={{ color: "var(--muted)" }}>
              {chatReadOnly
                ? "Chat is read only while spectating."
                : !chatCanCompose
                  ? "Chat is unavailable after the game ends."
                  : chatHasVisibleTrigger
                    ? 'Use the Chat button or press "\\".'
                    : 'Press "\\" to chat.'}
            </div>
          </div>
        )}

        {/* Leave/Back */}
        <div className="euclid-game-actions">
          <button
            type="button"
            className="euclid-square-toggle rounded cursor-pointer"
            onClick={() => setShowHistoricalSquares((visible) => !visible)}
          >
            {showHistoricalSquares ? "Hide past squares" : "Show past squares"}
          </button>
          <button
            type="button"
            className={`rounded ${exitPending ? "" : "cursor-pointer"}`}
            style={{
              background: "#ef4444",
              color: "#fff",
              padding: "6px 12px",
              cursor: exitPending ? "wait" : "pointer",
              opacity: exitPending ? 0.65 : 1,
            }}
            disabled={exitPending}
            aria-busy={exitPending || undefined}
            onClick={onLeave}
          >
            {exitPending ? exitPendingLabel : exitLabel}
          </button>
        </div>
      </div>
    </div>
  );
};

const SharedPostView: React.FC<{ share: SharedPostPayload }> = ({ share }) => {
  const panelStyle: React.CSSProperties = {
    background: "rgba(16, 27, 45, 0.94)",
    border: "1px solid #294466",
    borderRadius: 32,
    padding: "28px 28px 32px",
    boxShadow: "0 24px 60px rgba(0, 0, 0, 0.32)",
  };

  if (share.kind === "rankings") {
    const accent = share.bucket === "hvh" ? "#ef4444" : "#2563eb";
    const soft =
      share.bucket === "hvh" ? "rgba(127,29,29,0.82)" : "rgba(19,42,70,0.88)";

    return (
      <div
        style={{
          minHeight: "100vh",
          overflowY: "auto",
          background:
            "radial-gradient(circle at top right, #17304f 0%, #09111d 48%)",
        }}
      >
        <div
          style={{
            maxWidth: 1200,
            margin: "0 auto",
            padding: "32px 20px 64px",
          }}
        >
          <div style={panelStyle}>
            <div style={{ color: "#cbd5e1", fontSize: 18, fontWeight: 700 }}>
              r/{share.subredditName}
            </div>
            <div
              style={{
                marginTop: 12,
                color: "#f8fafc",
                fontSize: 42,
                fontWeight: 800,
              }}
            >
              {share.title}
            </div>
            <div style={{ marginTop: 10, color: "#94a3b8", fontSize: 20 }}>
              {share.subtitle}
            </div>

            <div
              style={{
                marginTop: 24,
                display: "flex",
                flexWrap: "wrap",
                justifyContent: "space-between",
                gap: 12,
                background: "#132b46",
                border: "1px solid #315781",
                borderRadius: 24,
                padding: "18px 22px",
              }}
            >
              <div style={{ color: "#93c5fd", fontSize: 20, fontWeight: 700 }}>
                Top players right now
              </div>
              <div style={{ color: "#60a5fa", fontSize: 16 }}>
                Shared from Euclid on {formatDisplayDate(share.sharedAt)}
              </div>
            </div>

            <div style={{ marginTop: 28, overflowX: "auto" }}>
              <table
                style={{
                  width: "100%",
                  minWidth: 720,
                  borderCollapse: "separate",
                  borderSpacing: "0 16px",
                }}
              >
                <thead>
                  <tr
                    style={{
                      color: "#94a3b8",
                      fontSize: 14,
                      textAlign: "left",
                    }}
                  >
                    <th style={{ padding: "0 12px" }}>RANK</th>
                    <th style={{ padding: "0 12px" }}>PLAYER</th>
                    <th style={{ padding: "0 12px" }}>RATING</th>
                    <th style={{ padding: "0 12px" }}>GAMES</th>
                    <th style={{ padding: "0 12px" }}>W-L</th>
                  </tr>
                </thead>
                <tbody>
                  {share.rows.map((row, index) => (
                    <tr
                      key={`${row.userId}-${index}`}
                      style={{ background: index === 0 ? soft : "#111f33" }}
                    >
                      <td
                        style={{
                          padding: "18px 16px",
                          color: index < 3 ? accent : "#94a3b8",
                          fontSize: 28,
                          fontWeight: 800,
                          borderTopLeftRadius: 22,
                          borderBottomLeftRadius: 22,
                        }}
                      >
                        {index + 1}
                      </td>
                      <td
                        style={{
                          padding: "18px 12px",
                          color: "#f8fafc",
                          fontSize: 24,
                          fontWeight: 700,
                        }}
                      >
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 12,
                          }}
                        >
                          {row.avatar ? (
                            <img
                              src={row.avatar}
                              alt=""
                              crossOrigin="anonymous"
                              style={{
                                width: 42,
                                height: 42,
                                borderRadius: "50%",
                                border: `2px solid ${accent}`,
                              }}
                            />
                          ) : (
                            <div
                              style={{
                                width: 42,
                                height: 42,
                                borderRadius: "50%",
                                background: accent,
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                color: "#fff",
                                fontWeight: 800,
                              }}
                            >
                              {(row.name || row.userId || "?")
                                .slice(0, 1)
                                .toUpperCase()}
                            </div>
                          )}
                          <span>{row.name || row.userId}</span>
                        </div>
                      </td>
                      <td
                        style={{
                          padding: "18px 12px",
                          color: "#f8fafc",
                          fontSize: 24,
                          fontWeight: 700,
                        }}
                      >
                        {row.rating}
                      </td>
                      <td
                        style={{
                          padding: "18px 12px",
                          color: "#e2e8f0",
                          fontSize: 22,
                        }}
                      >
                        {row.games}
                      </td>
                      <td
                        style={{
                          padding: "18px 16px",
                          color: "#e2e8f0",
                          fontSize: 22,
                          borderTopRightRadius: 22,
                          borderBottomRightRadius: 22,
                        }}
                      >
                        {row.wins}-{row.losses}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return <ResultShareView share={share} theme="dark" />;
};
