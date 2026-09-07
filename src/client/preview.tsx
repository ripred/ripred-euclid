import "./index.css";
import "./preview.css";

import { requestExpandedMode } from "@devvit/web/client";
import { useEffect, useRef, useState, type MouseEvent } from "react";

import type { InitResponse, RankingsShareRow } from "../shared/types/api";
import {
  DEMO_STEPS,
  IDLE_FRAME,
  type DemoFrame,
  type DemoStep,
  type Owner,
} from "./preview-demo";
import {
  isFinalDemoStep,
  PREVIEW_ONBOARDING_KEY,
  storeCompletion,
} from "./onboarding";
import { SharePreview } from "./share-preview";
import { fetchRankings, type LoadedRankings } from "./rankings-loader";
import { errorMessage } from "./error-message";
import type { ExpandedEntry } from "./expanded-entry";
import {
  applyThemeModeToDocument,
  installThemeModeSync,
  type ThemeMode,
} from "./theme";

const HUMAN_VS_EUCLID_LABEL = "Redditor vs Euclid";
const EUCLID_LABEL = "Euclid";
const DEMO_START_DELAY_MS = 7000;
const DEMO_POST_STEP_PAUSE_MS = 2000;
const DEMO_STEP_MS = 3600 + DEMO_POST_STEP_PAUSE_MS;
const DEMO_MOVE_DELAY_MS = 850;
const DEMO_SQUARE_DELAY_MS = 1650;
const DEMO_TEXT_FADE_MS = 420;
const DEMO_TO_LEADERBOARD_DELAY_MS = 5000;
const LEADERBOARD_IDLE_MS = 10000;

const boardLayout = {
  cols: 8,
  rows: 8,
  gap: 28,
  startX: 20,
  startY: 20,
};

const pointAt = (x: number, y: number) => ({
  x: boardLayout.startX + x * boardLayout.gap,
  y: boardLayout.startY + y * boardLayout.gap,
});

const boardWidth =
  boardLayout.startX * 2 + boardLayout.gap * (boardLayout.cols - 1);
const boardHeight =
  boardLayout.startY * 2 + boardLayout.gap * (boardLayout.rows - 1);
const LEADERBOARD_REFRESH_MS = 60_000;

type PreviewSurfaceMode = "intro" | "demo" | "leaderboard";

const previewPalette: Record<
  ThemeMode,
  {
    shellBg: string;
    cardBg: string;
    cardBorder: string;
    panelBg: string;
    panelBorder: string;
    title: string;
    text: string;
    accent: string;
    emptyDot: string;
    boardBg: string;
    boardLine: string;
    squareBlue: string;
    squareRed: string;
  }
> = {
  dark: {
    shellBg:
      "radial-gradient(circle at top, rgba(37,99,235,.25), transparent 34%), linear-gradient(180deg, #041124 0%, #07182f 56%, #0b2242 82%, #153b73 100%)",
    cardBg: "rgba(4,18,36,.78)",
    cardBorder: "rgba(148,163,184,.22)",
    panelBg: "rgba(15,23,42,.55)",
    panelBorder: "rgba(148,163,184,.16)",
    title: "#f8fafc",
    text: "#cbd5e1",
    accent: "#93c5fd",
    emptyDot: "rgba(148,163,184,.28)",
    boardBg:
      "radial-gradient(circle at top, rgba(59,130,246,.15), transparent 40%), rgba(2,12,27,.55)",
    boardLine: "rgba(148,163,184,.16)",
    squareBlue: "rgba(59,130,246,.88)",
    squareRed: "rgba(239,68,68,.9)",
  },
  light: {
    shellBg:
      "radial-gradient(circle at top, rgba(191,219,254,.85), transparent 34%), linear-gradient(180deg, #eff6ff 0%, #e0ecff 56%, #dbeafe 82%, #c7ddff 100%)",
    cardBg: "rgba(255,255,255,.80)",
    cardBorder: "rgba(148,163,184,.28)",
    panelBg: "rgba(248,250,252,.85)",
    panelBorder: "rgba(148,163,184,.20)",
    title: "#0f172a",
    text: "#334155",
    accent: "#0369a1",
    emptyDot: "rgba(148,163,184,.26)",
    boardBg:
      "radial-gradient(circle at top, rgba(59,130,246,.10), transparent 40%), rgba(248,250,252,.68)",
    boardLine: "rgba(100,116,139,.15)",
    squareBlue: "rgba(37,99,235,.82)",
    squareRed: "rgba(220,38,38,.86)",
  },
};

const dotColor = (owner: Owner, emptyDot: string) =>
  owner === 1 ? "#ef4444" : owner === 2 ? "#3b82f6" : emptyDot;

const squareStroke = (owner: Owner, palette: typeof previewPalette.dark) =>
  owner === 1 ? palette.squareRed : palette.squareBlue;

export function PreviewStatus({
  theme,
  title,
  body,
  onRetry,
}: {
  theme: ThemeMode;
  title: string;
  body: string;
  onRetry?: () => void;
}) {
  const palette = previewPalette[theme];

  return (
    <div
      className="euclid-preview euclid-preview-status"
      style={{
        background: palette.shellBg,
        color: palette.title,
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "center",
        padding: "8px 12px 6px",
        boxSizing: "border-box",
      }}
    >
      <div
        className="euclid-preview-status-card"
        style={{
          width: "min(760px, 100%)",
          borderRadius: 22,
          border: `1px solid ${palette.cardBorder}`,
          background: palette.cardBg,
          boxShadow:
            theme === "dark"
              ? "0 28px 64px rgba(2,8,23,.38)"
              : "0 18px 44px rgba(15,23,42,.12)",
          padding: "22px 20px",
          display: "grid",
          gap: 8,
          backdropFilter: "blur(10px)",
        }}
      >
        <div style={{ fontSize: 28, fontWeight: 900, lineHeight: 1.04 }}>
          {title}
        </div>
        <div
          className="euclid-preview-status-message"
          style={{ color: palette.text, fontSize: 14, lineHeight: 1.5 }}
        >
          {body}
        </div>
        {onRetry && (
          <button
            type="button"
            className="euclid-preview-more"
            onClick={onRetry}
            style={{ color: palette.title, borderColor: palette.panelBorder }}
          >
            Try again
          </button>
        )}
      </div>
    </div>
  );
}

function ScorePill({
  label,
  score,
  owner,
  palette,
}: {
  label: string;
  score: number;
  owner: Owner;
  palette: typeof previewPalette.dark;
}) {
  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 7,
        borderRadius: 999,
        border: `1px solid ${palette.panelBorder}`,
        background: palette.panelBg,
        padding: "4px 9px",
        color: palette.text,
        fontSize: 12,
        fontWeight: 700,
      }}
    >
      <span
        style={{
          width: 9,
          height: 9,
          borderRadius: "999px",
          background: dotColor(owner, palette.emptyDot),
          boxShadow:
            owner === 1
              ? "0 0 0 3px rgba(239,68,68,.16)"
              : "0 0 0 3px rgba(59,130,246,.16)",
        }}
      />
      <span>{label}</span>
      <span style={{ color: palette.title }}>{score}</span>
    </div>
  );
}

function PreviewBoard({
  demoStep,
  demoPhase,
  palette,
}: {
  demoStep: DemoStep | null;
  demoPhase: 0 | 1 | 2;
  palette: typeof previewPalette.dark;
}) {
  const activeFrame: DemoFrame = demoStep
    ? demoPhase >= 1
      ? demoStep.after
      : demoStep.before
    : IDLE_FRAME;
  const displayedDots = activeFrame.dots;
  const pendingMove = demoStep?.after.move;
  const visibleSquares =
    demoStep && demoPhase === 2 ? demoStep.after.newSquares : [];
  const visibleSquareKeys = new Set(visibleSquares.map((square) => square.key));
  const priorSquares = activeFrame.allSquares.filter(
    (square) => !visibleSquareKeys.has(square.key),
  );
  const displayedScores = activeFrame.allSquares.reduce<[number, number]>(
    (scores, square) => {
      if (square.owner === 1) scores[0] += square.points;
      else scores[1] += square.points;
      return scores;
    },
    [0, 0],
  );
  const squarePoints = (corners: DemoFrame["allSquares"][number]["corners"]) =>
    corners
      .map((point) => {
        const translated = pointAt(point.x, point.y);
        return `${translated.x},${translated.y}`;
      })
      .join(" ");

  return (
    <div
      aria-hidden="true"
      className="euclid-preview-board"
      style={{
        position: "relative",
        minWidth: 0,
        borderRadius: 18,
        background: palette.boardBg,
        border: `1px solid ${palette.panelBorder}`,
        padding: "8px 8px 6px",
        display: "grid",
        gap: 6,
      }}
    >
      <div
        style={{
          display: "flex",
          gap: 8,
          justifyContent: "center",
          flexWrap: "wrap",
        }}
      >
        <ScorePill
          label="Red"
          score={displayedScores[0]}
          owner={1}
          palette={palette}
        />
        <ScorePill
          label="Blue"
          score={displayedScores[1]}
          owner={2}
          palette={palette}
        />
      </div>

      <svg
        viewBox={`0 0 ${boardWidth} ${boardHeight}`}
        style={{
          width: "100%",
          maxWidth: "100%",
          height: "100%",
          minHeight: 0,
          display: "block",
          justifySelf: "center",
        }}
      >
        {Array.from({ length: boardLayout.cols }).map((_, col) => {
          const point = pointAt(col, 0);
          return (
            <line
              key={`col-${col}`}
              x1={point.x}
              y1={boardLayout.startY}
              x2={point.x}
              y2={boardLayout.startY + boardLayout.gap * (boardLayout.rows - 1)}
              stroke={palette.boardLine}
              strokeWidth="1"
            />
          );
        })}
        {Array.from({ length: boardLayout.rows }).map((_, row) => {
          const point = pointAt(0, row);
          return (
            <line
              key={`row-${row}`}
              x1={boardLayout.startX}
              y1={point.y}
              x2={boardLayout.startX + boardLayout.gap * (boardLayout.cols - 1)}
              y2={point.y}
              stroke={palette.boardLine}
              strokeWidth="1"
            />
          );
        })}

        {priorSquares.map((square) => (
          <polygon
            key={`prior-${square.key}`}
            points={squarePoints(square.corners)}
            fill="none"
            stroke={squareStroke(square.owner, palette)}
            strokeWidth="2.2"
            strokeOpacity="0.52"
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        ))}

        {displayedDots.map((piece, index) => {
          const point = pointAt(piece.x, piece.y);
          const isLastMove = Boolean(
            demoStep &&
              demoPhase >= 1 &&
              pendingMove &&
              piece.x === pendingMove.x &&
              piece.y === pendingMove.y &&
              piece.owner === pendingMove.owner &&
              index === displayedDots.length - 1,
          );

          return (
            <circle
              key={`${piece.x}-${piece.y}-${piece.owner}-${index}`}
              cx={point.x}
              cy={point.y}
              r="7.25"
              fill={dotColor(piece.owner, palette.emptyDot)}
              stroke="rgba(255,255,255,.18)"
              strokeWidth="1.6"
              style={
                isLastMove
                  ? { animation: "previewPlaceDot .7s ease-out both" }
                  : undefined
              }
            />
          );
        })}

        {demoStep && demoPhase === 0 && pendingMove ? (
          <circle
            cx={pointAt(pendingMove.x, pendingMove.y).x}
            cy={pointAt(pendingMove.x, pendingMove.y).y}
            r="15"
            fill="none"
            stroke={
              pendingMove.owner === 1
                ? "rgba(239,68,68,.58)"
                : "rgba(59,130,246,.58)"
            }
            strokeWidth="3"
            style={{ animation: "previewPulseRing 1.2s ease-in-out infinite" }}
          />
        ) : null}

        {visibleSquares.map((square, index) => (
          <polygon
            key={`${square.key}-${index}`}
            points={squarePoints(square.corners)}
            fill="none"
            stroke={squareStroke(square.owner, palette)}
            strokeWidth="4.5"
            strokeLinejoin="round"
            strokeLinecap="round"
            pathLength={1}
            strokeDasharray="1"
            strokeDashoffset="1"
            style={{ animation: "previewDrawSquare .6s ease-out forwards" }}
          />
        ))}
      </svg>
    </div>
  );
}

function LeaderboardRow({
  row,
  index,
  palette,
}: {
  row: RankingsShareRow;
  index: number;
  palette: typeof previewPalette.dark;
}) {
  const initial = row.name.trim().charAt(0).toUpperCase() || "?";

  return (
    <div
      className="euclid-preview-leader-row"
      style={{
        gridTemplateColumns: "auto minmax(0, 1fr) auto",
        gap: 10,
        alignItems: "center",
        padding: "8px 10px",
        borderRadius: 12,
        background: palette.panelBg,
        border: `1px solid ${palette.panelBorder}`,
      }}
    >
      <div
        style={{
          width: 28,
          height: 28,
          borderRadius: "999px",
          background:
            index < 3
              ? "linear-gradient(135deg, #f59e0b 0%, #f97316 100%)"
              : "rgba(59,130,246,.18)",
          color: index < 3 ? "#1f2937" : palette.accent,
          display: "grid",
          placeItems: "center",
          fontSize: 12,
          fontWeight: 900,
        }}
      >
        {initial}
      </div>

      <div style={{ minWidth: 0, display: "grid", gap: 1 }}>
        <div
          style={{
            color: palette.title,
            fontSize: 13,
            fontWeight: 800,
            lineHeight: 1.2,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {row.name}
        </div>
        <div
          className="euclid-preview-leader-record"
          style={{ color: palette.text, fontSize: 11, lineHeight: 1.25 }}
        >
          {row.wins}W · {row.losses}L · {row.draws}D · {row.games}G
        </div>
      </div>

      <div style={{ textAlign: "right", minWidth: 48 }}>
        <div style={{ color: palette.title, fontSize: 13, fontWeight: 900 }}>
          {row.rating}
        </div>
        <div
          style={{
            color: palette.text,
            fontSize: 10,
            letterSpacing: "0.08em",
          }}
        >
          rating
        </div>
      </div>
    </div>
  );
}

function LeaderboardBucket({
  title,
  subtitle,
  rows,
  palette,
}: {
  title: string;
  subtitle: string;
  rows: RankingsShareRow[];
  palette: typeof previewPalette.dark;
}) {
  return (
    <div
      className="euclid-preview-bucket"
      style={{
        minHeight: 0,
        display: "grid",
      }}
    >
      <div
        className="euclid-preview-bucket-heading"
        style={{ display: "grid", gap: 2 }}
      >
        <div style={{ color: palette.title, fontSize: 14, fontWeight: 900 }}>
          {title}
        </div>
        <div
          className="euclid-preview-secondary"
          style={{ color: palette.text, fontSize: 11, lineHeight: 1.35 }}
        >
          {subtitle}
        </div>
      </div>

      {rows.length ? (
        <div
          className="euclid-preview-leaders"
          style={{ display: "grid", gap: 6 }}
        >
          {rows.slice(0, 3).map((row, index) => (
            <LeaderboardRow
              key={`${title}-${row.userId}-${index}`}
              row={row}
              index={index}
              palette={palette}
            />
          ))}
        </div>
      ) : (
        <div
          style={{
            borderRadius: 12,
            border: `1px dashed ${palette.panelBorder}`,
            padding: "12px 10px",
            color: palette.text,
            fontSize: 12,
            lineHeight: 1.45,
          }}
        >
          No entries yet.
          <span className="euclid-preview-secondary">
            {" "}
            Be the first redditor to claim this board.
          </span>
        </div>
      )}
    </div>
  );
}

export function PreviewLeaderboard({
  theme,
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
  const palette = previewPalette[theme];
  const [bucket, setBucket] = useState<"hvh" | "hva">("hvh");
  const hasRows = rankings[bucket].length > 0;

  return (
    <div
      className="euclid-preview-standings"
      style={{
        display: "grid",
        gridTemplateRows: "auto minmax(0, 1fr)",
        gap: 10,
        flex: "1 1 100%",
        minHeight: 0,
      }}
    >
      <div style={{ display: "grid", gap: 6 }}>
        <div
          className="euclid-preview-standings-eyebrow"
          style={{
            fontSize: 12,
            fontWeight: 800,
            letterSpacing: "0.16em",
            color: palette.accent,
          }}
        >
          Euclid Leaderboard
        </div>
        <div
          className="euclid-preview-standings-title"
          style={{ fontWeight: 900, lineHeight: 1 }}
        >
          Top Redditors
        </div>
        <div
          className="euclid-preview-secondary"
          style={{ color: palette.text, fontSize: 14, maxWidth: 520 }}
        >
          A quick look at the leaders. Open the full leaderboard for all
          standings.
        </div>
      </div>

      <div
        className="euclid-preview-standings-panel"
        style={{
          borderRadius: 18,
          background: palette.panelBg,
          border: `1px solid ${palette.panelBorder}`,
          minHeight: 0,
          display: "grid",
          gridTemplateRows: "auto minmax(0, 1fr)",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            gap: 10,
            flexWrap: "wrap",
          }}
        >
          <div
            className="euclid-preview-rank-tabs"
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
                style={{
                  color: palette.title,
                  borderColor: palette.panelBorder,
                  background:
                    bucket === value ? palette.boardBg : "transparent",
                }}
              >
                {value === "hvh" ? "vs Redditors" : "vs Euclid"}
              </button>
            ))}
          </div>
        </div>

        {rankingsLoading && !hasRows ? (
          <div style={{ color: palette.text, fontSize: 13, lineHeight: 1.5 }}>
            Loading leaderboard…
          </div>
        ) : rankingsError && !hasRows ? (
          <div style={{ color: palette.text, fontSize: 13, lineHeight: 1.5 }}>
            Unable to load standings.
            <span className="euclid-preview-secondary">
              {" "}
              Open the full leaderboard to retry.
            </span>
          </div>
        ) : (
          <div
            style={{
              minHeight: 0,
            }}
          >
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "minmax(0, 1fr)",
                gap: 10,
                alignItems: "start",
              }}
            >
              <LeaderboardBucket
                title={
                  bucket === "hvh"
                    ? "Redditor vs Redditor"
                    : `${HUMAN_VS_EUCLID_LABEL} — Ranked`
                }
                subtitle={
                  bucket === "hvh"
                    ? "Competitive matches between two human players."
                    : rankings.hvaRules
                      ? `${rankings.hvaRules.rules.W}×${rankings.hvaRules.rules.H} Grid Footprint, first to ${rankings.hvaRules.rules.winScore}, ${EUCLID_LABEL} on Brutal.`
                      : `8×8 Grid Footprint, first to 150, ${EUCLID_LABEL} on Brutal.`
                }
                rows={rankings[bucket]}
                palette={palette}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export function PreviewActions({
  theme,
  surfaceMode,
  expansionError,
  onExpand,
}: {
  theme: ThemeMode;
  surfaceMode: PreviewSurfaceMode;
  expansionError: string | null;
  onExpand: (
    event: MouseEvent<HTMLButtonElement>,
    entry: ExpandedEntry,
  ) => void;
}) {
  const palette = previewPalette[theme];
  const actions = [
    {
      entry: "game",
      label: "Start Playing!",
      className: "euclid-preview-start",
    },
    { entry: "watch", label: "Watch Live", className: "euclid-preview-watch" },
    {
      entry: "leaderboard",
      label: "Full leaderboard",
      className: "euclid-preview-more",
    },
  ] as const;

  // This bar is outside the carousel, so its actions keep their focus and place.
  return (
    <div
      className="euclid-preview-actions"
      style={{
        borderRadius: 16,
        background: palette.panelBg,
        border: `1px solid ${palette.panelBorder}`,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 10,
      }}
    >
      <div
        className="euclid-preview-action-copy"
        style={{
          color: palette.accent,
          fontSize: 13,
          fontWeight: 700,
          flex: "1 1 320px",
          minWidth: 0,
        }}
      >
        Play, watch live games, and explore the full leaderboard.
      </div>
      <div className="euclid-preview-action-buttons">
        {actions
          .filter(
            ({ entry }) =>
              entry !== "leaderboard" || surfaceMode === "leaderboard",
          )
          .map(({ entry, label, className }) => (
            <button
              key={entry}
              type="button"
              className={className}
              data-entry={entry}
              onClick={(event) => onExpand(event, entry)}
              style={
                entry === "game"
                  ? {
                      border: "none",
                      cursor: "pointer",
                      borderRadius: 999,
                      background:
                        "linear-gradient(135deg, #22c55e 0%, #16a34a 100%)",
                      color: "#f8fafc",
                      fontWeight: 800,
                      boxShadow: "0 10px 24px rgba(22,163,74,.32)",
                    }
                  : {
                      color: entry === "watch" ? palette.accent : palette.title,
                      borderColor:
                        entry === "watch"
                          ? palette.accent
                          : palette.panelBorder,
                    }
              }
            >
              {label}
            </button>
          ))}
      </div>
      {expansionError && (
        <div className="euclid-preview-open-error" role="alert">
          {expansionError}
        </div>
      )}
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
  const [demoStepIndex, setDemoStepIndex] = useState(0);
  const [demoPhase, setDemoPhase] = useState<0 | 1 | 2>(0);
  const [displayedDemoStep, setDisplayedDemoStep] = useState<DemoStep | null>(
    null,
  );
  const [demoTextVisible, setDemoTextVisible] = useState(true);
  const [rankings, setRankings] = useState<LoadedRankings>({
    hvh: [],
    hva: [],
  });
  const [rankingsLoading, setRankingsLoading] = useState(false);
  const [rankingsError, setRankingsError] = useState<string | null>(null);
  const [leaderboardActivityVersion, setLeaderboardActivityVersion] =
    useState(0);
  const [reduceMotion, setReduceMotion] = useState(false);
  const [isDocumentVisible, setIsDocumentVisible] = useState(
    typeof document === "undefined"
      ? true
      : document.visibilityState === "visible",
  );
  const rankingsLoadedAtRef = useRef(0);
  const rankingsPendingRef = useRef(false);
  const [rankingsRefresh, setRankingsRefresh] = useState(0);
  const isPreviewActive = initState?.type === "init" && isDocumentVisible;

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
    const media = window.matchMedia
      ? window.matchMedia("(prefers-reduced-motion: reduce)")
      : null;
    const sync = () => setReduceMotion(Boolean(media?.matches));
    sync();
    if (!media) return;
    if (typeof media.addEventListener === "function")
      media.addEventListener("change", sync);
    else if (typeof media.addListener === "function") media.addListener(sync);
    return () => {
      if (typeof media.removeEventListener === "function")
        media.removeEventListener("change", sync);
      else if (typeof media.removeListener === "function")
        media.removeListener(sync);
    };
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

  useEffect(() => {
    if (surfaceMode !== "intro" || !isPreviewActive) return;
    const timer = window.setTimeout(() => {
      setDemoStepIndex(0);
      setDemoPhase(0);
      setSurfaceMode("demo");
    }, DEMO_START_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [isPreviewActive, surfaceMode]);

  useEffect(() => {
    if (surfaceMode !== "demo" || !isPreviewActive) return;
    setDemoPhase(0);
    const moveTimer = window.setTimeout(
      () => setDemoPhase(1),
      DEMO_MOVE_DELAY_MS,
    );
    const squareTimer = window.setTimeout(
      () => setDemoPhase(2),
      DEMO_SQUARE_DELAY_MS,
    );
    const isLastStep = isFinalDemoStep(demoStepIndex, DEMO_STEPS.length);
    const nextTimer = window.setTimeout(
      () => {
        if (isLastStep) {
          storeCompletion(PREVIEW_ONBOARDING_KEY);
          setSurfaceMode("leaderboard");
          setLeaderboardActivityVersion(0);
          return;
        }
        setDemoStepIndex((current) => current + 1);
      },
      isLastStep
        ? DEMO_SQUARE_DELAY_MS + DEMO_TO_LEADERBOARD_DELAY_MS
        : DEMO_STEP_MS,
    );

    return () => {
      window.clearTimeout(moveTimer);
      window.clearTimeout(squareTimer);
      window.clearTimeout(nextTimer);
    };
  }, [demoStepIndex, isPreviewActive, surfaceMode]);

  const palette = previewPalette[theme];
  const demoStep =
    surfaceMode === "demo" ? (DEMO_STEPS[demoStepIndex] ?? null) : null;
  const textStep = displayedDemoStep ?? demoStep;
  const sharedPost = initState?.type === "share" ? initState.share : null;

  useEffect(() => {
    if (surfaceMode !== "demo" || !isPreviewActive) {
      setDisplayedDemoStep(null);
      setDemoTextVisible(true);
      return;
    }
    if (!demoStep) return;
    if (!displayedDemoStep) {
      setDisplayedDemoStep(demoStep);
      setDemoTextVisible(true);
      return;
    }
    if (displayedDemoStep.id === demoStep.id) return;

    setDemoTextVisible(false);
    const timer = window.setTimeout(() => {
      setDisplayedDemoStep(demoStep);
      window.requestAnimationFrame(() => setDemoTextVisible(true));
    }, DEMO_TEXT_FADE_MS);

    return () => window.clearTimeout(timer);
  }, [demoStep, displayedDemoStep, isPreviewActive, reduceMotion, surfaceMode]);

  useEffect(() => {
    if (surfaceMode !== "leaderboard" || !isPreviewActive) return;
    const timer = window.setTimeout(() => {
      setSurfaceMode("intro");
      setDemoStepIndex(0);
      setDemoPhase(0);
      setDisplayedDemoStep(null);
      setDemoTextVisible(true);
    }, LEADERBOARD_IDLE_MS);
    return () => window.clearTimeout(timer);
  }, [isPreviewActive, leaderboardActivityVersion, surfaceMode]);

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
      requestExpandedMode(event.nativeEvent, entry);
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

  if (sharedPost) {
    return (
      <SharePreview
        share={sharedPost}
        theme={theme}
        onExpand={(event) => requestExpandedMode(event.nativeEvent, "game")}
      />
    );
  }

  return (
    <div
      className="euclid-preview"
      style={{
        background: palette.shellBg,
        color: palette.title,
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "center",
        padding: "8px 12px 6px",
      }}
    >
      <style>{`
        @keyframes previewPulseRing {
          0%, 100% { transform: scale(.86); opacity: .38; }
          50% { transform: scale(1.06); opacity: 1; }
        }
        @keyframes previewPlaceDot {
          0% { opacity: 0; transform: scale(.2); }
          70% { opacity: 1; transform: scale(1.18); }
          100% { opacity: 1; transform: scale(1); }
        }
        @keyframes previewDrawSquare {
          to { stroke-dashoffset: 0; }
        }
      `}</style>

      <div
        className="euclid-preview-card"
        data-demo-steps={DEMO_STEPS.length}
        style={{
          width: "min(760px, 100%)",
          height: "100%",
          borderRadius: 22,
          border: `1px solid ${palette.cardBorder}`,
          background: `${
            theme === "dark"
              ? "linear-gradient(180deg, rgba(4,18,36,.76), rgba(4,18,36,.76))"
              : "linear-gradient(180deg, rgba(255,255,255,.78), rgba(255,255,255,.78))"
          }, ${palette.shellBg}`,
          boxShadow:
            theme === "dark"
              ? "0 28px 64px rgba(2,8,23,.38)"
              : "0 18px 44px rgba(15,23,42,.12)",
          display: "grid",
          overflow: "hidden",
          backdropFilter: "blur(10px)",
          boxSizing: "border-box",
        }}
      >
        {surfaceMode === "leaderboard" ? (
          <PreviewLeaderboard
            theme={theme}
            rankings={rankings}
            rankingsLoading={rankingsLoading}
            rankingsError={rankingsError}
            onInteract={noteLeaderboardInteraction}
          />
        ) : (
          <div
            className="euclid-preview-content"
            style={{
              alignItems: "stretch",
              gap: 10,
              minHeight: 0,
            }}
          >
            <div
              className="euclid-preview-copy"
              style={{
                display: "grid",
                alignSelf: "stretch",
                minWidth: 0,
              }}
            >
              <div style={{ display: "grid", gap: 6 }}>
                <div
                  className="euclid-preview-title"
                  style={{ fontWeight: 900, lineHeight: 1 }}
                >
                  Euclid
                </div>
                <div
                  className="euclid-preview-tagline"
                  style={{ color: palette.text, fontSize: 14, maxWidth: 420 }}
                >
                  Place dots. Complete squares. Rotated shapes count. Beat{" "}
                  {EUCLID_LABEL} or outplay another redditor.
                </div>
              </div>

              <div
                className="euclid-preview-demo-copy"
                style={{
                  borderRadius: 16,
                  background: palette.panelBg,
                  border: `1px solid ${palette.panelBorder}`,
                  color: palette.text,
                  fontSize: 13,
                  lineHeight: 1.5,
                  overflow: "hidden",
                  display: "grid",
                  alignContent: "center",
                }}
              >
                <div
                  className="euclid-preview-demo-label"
                  style={{
                    color: palette.accent,
                    fontSize: 12,
                    fontWeight: 800,
                    letterSpacing: "0.12em",
                  }}
                >
                  <span
                    style={{
                      display: "inline-block",
                    }}
                  >
                    {textStep ? "Quick Demo" : "First Time Here?"}
                  </span>
                </div>
                <div
                  style={{
                    display: "grid",
                    gap: 6,
                    opacity: demoTextVisible ? 1 : 0,
                    transition:
                      reduceMotion || !textStep
                        ? "none"
                        : `opacity ${DEMO_TEXT_FADE_MS}ms ease`,
                  }}
                >
                  <div
                    className="euclid-preview-demo-title"
                    style={{ fontWeight: 800, color: palette.title }}
                  >
                    {textStep?.title ?? "8×8 Demo"}
                  </div>
                  <div className="euclid-preview-demo-description">
                    {textStep?.body ??
                      "Pause here for a few seconds and Euclid will replay a short 8×8 game sequence to explain the rules."}
                  </div>
                </div>
              </div>
            </div>

            <PreviewBoard
              demoStep={demoStep}
              demoPhase={demoPhase}
              palette={palette}
            />
          </div>
        )}
        <PreviewActions
          theme={theme}
          surfaceMode={surfaceMode}
          expansionError={expansionError}
          onExpand={openExpanded}
        />

        <div
          className="euclid-preview-rules"
          style={{
            gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
            gap: 6,
          }}
        >
          {[
            "Take turns placing one dot on an empty space.",
            "A move scores when it completes a square in your color.",
            "Straight or rotated squares both count toward your total.",
          ].map((line) => (
            <div
              key={line}
              style={{
                borderRadius: 16,
                background: palette.panelBg,
                border: `1px solid ${palette.panelBorder}`,
                padding: "8px 10px",
                color: palette.text,
                fontSize: 13,
                lineHeight: 1.45,
              }}
            >
              {line}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
