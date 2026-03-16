import './index.css';

import { requestExpandedMode } from '@devvit/web/client';
import { StrictMode, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';

import type { InitResponse, RankingsShareRow } from '../shared/types/api';
import {
  DEMO_STEPS,
  IDLE_FRAME,
  type DemoFrame,
  type DemoStep,
  type Owner,
} from './preview-demo';
import { SharePreview } from './share-preview';
import {
  applyThemeModeToDocument,
  installThemeModeSync,
  type ThemeMode,
} from './theme';

const PREVIEW_ONBOARDING_KEY = 'euclid_launch_onboarding_seen';
const HUMAN_VS_EUCLID_LABEL = 'Redditor vs Euclid';
const EUCLID_LABEL = 'Euclid';
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

const boardWidth = boardLayout.startX * 2 + boardLayout.gap * (boardLayout.cols - 1);
const boardHeight = boardLayout.startY * 2 + boardLayout.gap * (boardLayout.rows - 1);
const PREVIEW_BOARD_LANE_WIDTH = 218;
const LEADERBOARD_REFRESH_MS = 60_000;

type PreviewSurfaceMode = 'intro' | 'demo' | 'leaderboard';
type PreviewRankings = {
  hvh: RankingsShareRow[];
  hva: RankingsShareRow[];
};

const previewPalette: Record<ThemeMode, {
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
}> = {
  dark: {
    shellBg: 'radial-gradient(circle at top, rgba(37,99,235,.25), transparent 34%), linear-gradient(180deg, #041124 0%, #07182f 56%, #0b2242 82%, #153b73 100%)',
    cardBg: 'rgba(4,18,36,.78)',
    cardBorder: 'rgba(148,163,184,.22)',
    panelBg: 'rgba(15,23,42,.55)',
    panelBorder: 'rgba(148,163,184,.16)',
    title: '#f8fafc',
    text: '#cbd5e1',
    accent: '#93c5fd',
    emptyDot: 'rgba(148,163,184,.28)',
    boardBg: 'radial-gradient(circle at top, rgba(59,130,246,.15), transparent 40%), rgba(2,12,27,.55)',
    boardLine: 'rgba(148,163,184,.16)',
    squareBlue: 'rgba(59,130,246,.88)',
    squareRed: 'rgba(239,68,68,.9)',
  },
  light: {
    shellBg: 'radial-gradient(circle at top, rgba(191,219,254,.85), transparent 34%), linear-gradient(180deg, #eff6ff 0%, #e0ecff 56%, #dbeafe 82%, #c7ddff 100%)',
    cardBg: 'rgba(255,255,255,.80)',
    cardBorder: 'rgba(148,163,184,.28)',
    panelBg: 'rgba(248,250,252,.85)',
    panelBorder: 'rgba(148,163,184,.20)',
    title: '#0f172a',
    text: '#334155',
    accent: '#0369a1',
    emptyDot: 'rgba(148,163,184,.26)',
    boardBg: 'radial-gradient(circle at top, rgba(59,130,246,.10), transparent 40%), rgba(248,250,252,.68)',
    boardLine: 'rgba(100,116,139,.15)',
    squareBlue: 'rgba(37,99,235,.82)',
    squareRed: 'rgba(220,38,38,.86)',
  },
};

const dotColor = (owner: Owner, emptyDot: string) =>
  owner === 1 ? '#ef4444' : owner === 2 ? '#3b82f6' : emptyDot;

const squareStroke = (owner: Owner, palette: typeof previewPalette.dark) =>
  owner === 1 ? palette.squareRed : palette.squareBlue;

function PreviewStatus({
  theme,
  title,
  body,
}: {
  theme: ThemeMode;
  title: string;
  body: string;
}) {
  const palette = previewPalette[theme];

  return (
    <div
      style={{
        background: palette.shellBg,
        color: palette.title,
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
        padding: '8px 12px 6px',
        minHeight: '100vh',
        boxSizing: 'border-box',
      }}
    >
      <div
        style={{
          width: 'min(760px, 100%)',
          borderRadius: 22,
          border: `1px solid ${palette.cardBorder}`,
          background: palette.cardBg,
          boxShadow: theme === 'dark' ? '0 28px 64px rgba(2,8,23,.38)' : '0 18px 44px rgba(15,23,42,.12)',
          padding: '22px 20px',
          display: 'grid',
          gap: 8,
          backdropFilter: 'blur(10px)',
        }}
      >
        <div style={{ color: palette.accent, fontSize: 12, fontWeight: 800, letterSpacing: '0.14em', textTransform: 'uppercase' }}>
          Euclid
        </div>
        <div style={{ fontSize: 28, fontWeight: 900, lineHeight: 1.04 }}>
          {title}
        </div>
        <div style={{ color: palette.text, fontSize: 14, lineHeight: 1.5 }}>
          {body}
        </div>
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
        display: 'inline-flex',
        alignItems: 'center',
        gap: 7,
        borderRadius: 999,
        border: `1px solid ${palette.panelBorder}`,
        background: palette.panelBg,
        padding: '4px 9px',
        color: palette.text,
        fontSize: 12,
        fontWeight: 700,
      }}
    >
      <span
        style={{
          width: 9,
          height: 9,
          borderRadius: '999px',
          background: dotColor(owner, palette.emptyDot),
          boxShadow: owner === 1 ? '0 0 0 3px rgba(239,68,68,.16)' : '0 0 0 3px rgba(59,130,246,.16)',
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
  const visibleSquares = demoStep && demoPhase === 2 ? demoStep.after.newSquares : [];
  const visibleSquareKeys = new Set(visibleSquares.map((square) => square.key));
  const priorSquares = activeFrame.allSquares.filter((square) => !visibleSquareKeys.has(square.key));
  const displayedScores = activeFrame.allSquares.reduce<[number, number]>((scores, square) => {
    scores[square.owner - 1] += square.points;
    return scores;
  }, [0, 0]);
  const squarePoints = (corners: DemoFrame['allSquares'][number]['corners']) =>
    corners.map((point) => {
      const translated = pointAt(point.x, point.y);
      return `${translated.x},${translated.y}`;
    }).join(' ');

  return (
    <div
      aria-hidden="true"
      style={{
        position: 'relative',
        minWidth: 0,
        borderRadius: 18,
        background: palette.boardBg,
        border: `1px solid ${palette.panelBorder}`,
        padding: '8px 8px 6px',
        display: 'grid',
        gap: 6,
      }}
    >
      <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
        <ScorePill label="Red" score={displayedScores[0]} owner={1} palette={palette} />
        <ScorePill label="Blue" score={displayedScores[1]} owner={2} palette={palette} />
      </div>

      <svg viewBox={`0 0 ${boardWidth} ${boardHeight}`} style={{ width: 200, maxWidth: '100%', height: 'auto', display: 'block', justifySelf: 'center' }}>
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
            demoStep
              && demoPhase >= 1
              && pendingMove
              && piece.x === pendingMove.x
              && piece.y === pendingMove.y
              && piece.owner === pendingMove.owner
              && index === displayedDots.length - 1,
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
              style={isLastMove ? { animation: 'previewPlaceDot .7s ease-out both' } : undefined}
            />
          );
        })}

        {demoStep && demoPhase === 0 && pendingMove ? (
          <circle
            cx={pointAt(pendingMove.x, pendingMove.y).x}
            cy={pointAt(pendingMove.x, pendingMove.y).y}
            r="15"
            fill="none"
            stroke={pendingMove.owner === 1 ? 'rgba(239,68,68,.58)' : 'rgba(59,130,246,.58)'}
            strokeWidth="3"
            style={{ animation: 'previewPulseRing 1.2s ease-in-out infinite' }}
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
            style={{ animation: 'previewDrawSquare .6s ease-out forwards' }}
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
  const initial = row.name.trim().charAt(0).toUpperCase() || '?';

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'auto minmax(0, 1fr) auto',
        gap: 10,
        alignItems: 'center',
        padding: '8px 10px',
        borderRadius: 12,
        background: palette.panelBg,
        border: `1px solid ${palette.panelBorder}`,
      }}
    >
      <div
        style={{
          width: 28,
          height: 28,
          borderRadius: '999px',
          background: index < 3 ? 'linear-gradient(135deg, #f59e0b 0%, #f97316 100%)' : 'rgba(59,130,246,.18)',
          color: index < 3 ? '#1f2937' : palette.accent,
          display: 'grid',
          placeItems: 'center',
          fontSize: 12,
          fontWeight: 900,
        }}
      >
        {initial}
      </div>

      <div style={{ minWidth: 0, display: 'grid', gap: 1 }}>
        <div
          style={{
            color: palette.title,
            fontSize: 13,
            fontWeight: 800,
            lineHeight: 1.2,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {row.name}
        </div>
        <div style={{ color: palette.text, fontSize: 11, lineHeight: 1.25 }}>
          {row.wins}W · {row.losses}L · {row.draws}D · {row.games}G
        </div>
      </div>

      <div style={{ textAlign: 'right', minWidth: 48 }}>
        <div style={{ color: palette.title, fontSize: 13, fontWeight: 900 }}>
          {row.rating}
        </div>
        <div style={{ color: palette.text, fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
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
      style={{
        minHeight: 0,
        display: 'grid',
        gridTemplateRows: 'auto minmax(0, 1fr)',
        gap: 8,
      }}
    >
      <div style={{ display: 'grid', gap: 2 }}>
        <div style={{ color: palette.title, fontSize: 14, fontWeight: 900 }}>
          {title}
        </div>
        <div style={{ color: palette.text, fontSize: 11, lineHeight: 1.35 }}>
          {subtitle}
        </div>
      </div>

      {rows.length ? (
        <div style={{ display: 'grid', gap: 6 }}>
          {rows.map((row, index) => (
            <LeaderboardRow key={`${title}-${row.userId}-${index}`} row={row} index={index} palette={palette} />
          ))}
        </div>
      ) : (
        <div
          style={{
            borderRadius: 12,
            border: `1px dashed ${palette.panelBorder}`,
            padding: '12px 10px',
            color: palette.text,
            fontSize: 12,
            lineHeight: 1.45,
          }}
        >
          No entries yet. Be the first redditor to claim this board.
        </div>
      )}
    </div>
  );
}

function PreviewLeaderboard({
  palette,
  rankings,
  rankingsLoading,
  rankingsError,
  onInteract,
}: {
  palette: typeof previewPalette.dark;
  rankings: PreviewRankings;
  rankingsLoading: boolean;
  rankingsError: string | null;
  onInteract: () => void;
}) {
  const hasRows = rankings.hvh.length > 0 || rankings.hva.length > 0;

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateRows: 'auto minmax(0, 1fr)',
        gap: 10,
        flex: '1 1 100%',
        minHeight: 0,
      }}
    >
      <div style={{ display: 'grid', gap: 6 }}>
        <div
          style={{
            fontSize: 12,
            fontWeight: 800,
            letterSpacing: '0.16em',
            textTransform: 'uppercase',
            color: palette.accent,
          }}
        >
          Euclid Leaderboard
        </div>
        <div style={{ fontSize: 30, fontWeight: 900, lineHeight: 1 }}>
          Top Redditors Right Now
        </div>
        <div style={{ color: palette.text, fontSize: 14, maxWidth: 520 }}>
          Watch the splash cycle into live standings, then jump into the full game whenever you’re ready.
        </div>
      </div>

      <div
        style={{
          borderRadius: 18,
          background: palette.panelBg,
          border: `1px solid ${palette.panelBorder}`,
          padding: '12px 12px 10px',
          minHeight: 0,
          display: 'grid',
          gridTemplateRows: 'auto minmax(0, 1fr)',
          gap: 10,
          overflow: 'hidden',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
          <div style={{ color: palette.title, fontSize: 15, fontWeight: 900 }}>
            Live standings
          </div>
          <div style={{ color: palette.text, fontSize: 12 }}>
            Scroll to explore both boards.
          </div>
        </div>

        {rankingsLoading && !hasRows ? (
          <div style={{ color: palette.text, fontSize: 13, lineHeight: 1.5 }}>
            Loading leaderboard…
          </div>
        ) : rankingsError && !hasRows ? (
          <div style={{ color: palette.text, fontSize: 13, lineHeight: 1.5 }}>
            Unable to load the live leaderboard right now. Open the full game to see the latest standings.
          </div>
        ) : (
          <div
            onPointerDown={onInteract}
            onTouchStart={onInteract}
            onWheel={onInteract}
            onScroll={onInteract}
            style={{
              minHeight: 0,
              overflowY: 'auto',
              paddingRight: 4,
            }}
          >
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
                gap: 10,
                alignItems: 'start',
              }}
            >
              <LeaderboardBucket
                title="Redditor vs Redditor"
                subtitle="Competitive matches between two human players."
                rows={rankings.hvh}
                palette={palette}
              />
              <LeaderboardBucket
                title={HUMAN_VS_EUCLID_LABEL}
                subtitle="Best records against Euclid."
                rows={rankings.hva}
                palette={palette}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

const PreviewApp = () => {
  const [theme, setTheme] = useState<ThemeMode>('dark');
  const [initState, setInitState] = useState<InitResponse | null>(null);
  const [initError, setInitError] = useState<string | null>(null);
  const [surfaceMode, setSurfaceMode] = useState<PreviewSurfaceMode>('intro');
  const [demoStepIndex, setDemoStepIndex] = useState(0);
  const [demoPhase, setDemoPhase] = useState<0 | 1 | 2>(0);
  const [displayedDemoStep, setDisplayedDemoStep] = useState<DemoStep | null>(null);
  const [demoTextVisible, setDemoTextVisible] = useState(true);
  const [rankings, setRankings] = useState<PreviewRankings>({ hvh: [], hva: [] });
  const [rankingsLoading, setRankingsLoading] = useState(false);
  const [rankingsError, setRankingsError] = useState<string | null>(null);
  const [leaderboardActivityVersion, setLeaderboardActivityVersion] = useState(0);
  const [reduceMotion, setReduceMotion] = useState(false);
  const [isDocumentVisible, setIsDocumentVisible] = useState(
    typeof document === 'undefined' ? true : document.visibilityState === 'visible',
  );
  const rankingsLoadedAtRef = useRef(0);

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
        const response = await fetch('/api/init');
        const data = await response.json();
        if (!response.ok) throw new Error(data?.message || 'Unable to load Euclid.');
        if (!cancelled) setInitState(data as InitResponse);
      } catch (error: any) {
        if (!cancelled) setInitError(error?.message || 'Unable to load Euclid.');
      }
    };

    void load();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const onVisibility = () => setIsDocumentVisible(document.visibilityState === 'visible');
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);

  useEffect(() => {
    const media = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
    const sync = () => setReduceMotion(Boolean(media?.matches));
    sync();
    if (!media) return;
    if (typeof media.addEventListener === 'function') media.addEventListener('change', sync);
    else if (typeof media.addListener === 'function') media.addListener(sync);
    return () => {
      if (typeof media.removeEventListener === 'function') media.removeEventListener('change', sync);
      else if (typeof media.removeListener === 'function') media.removeListener(sync);
    };
  }, []);

  useEffect(() => {
    if (!initState || initState.type === 'share') return;
    let cancelled = false;

    const loadRankings = async (showSpinner: boolean) => {
      if (showSpinner) setRankingsLoading(true);
      try {
        setRankingsError(null);
        const response = await fetch('/api/rankings');
        const data = await response.json();
        if (!response.ok) throw new Error(data?.message || 'Unable to load the leaderboard.');
        if (cancelled) return;
        setRankings({
          hvh: Array.isArray(data?.hvh) ? data.hvh as RankingsShareRow[] : [],
          hva: Array.isArray(data?.hva) ? data.hva as RankingsShareRow[] : [],
        });
        rankingsLoadedAtRef.current = Date.now();
      } catch (error: any) {
        if (!cancelled) setRankingsError(error?.message || 'Unable to load the leaderboard.');
      } finally {
        if (!cancelled) setRankingsLoading(false);
      }
    };

    void loadRankings(true);

    return () => {
      cancelled = true;
    };
  }, [initState]);

  useEffect(() => {
    if (surfaceMode !== 'intro' || !isDocumentVisible) return;
    const timer = window.setTimeout(() => {
      setDemoStepIndex(0);
      setDemoPhase(0);
      setSurfaceMode('demo');
    }, DEMO_START_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [isDocumentVisible, surfaceMode]);

  useEffect(() => {
    if (surfaceMode !== 'demo' || !isDocumentVisible) return;
    setDemoPhase(0);
    const moveTimer = window.setTimeout(() => setDemoPhase(1), DEMO_MOVE_DELAY_MS);
    const squareTimer = window.setTimeout(() => setDemoPhase(2), DEMO_SQUARE_DELAY_MS);
    const isLastStep = demoStepIndex >= DEMO_STEPS.length - 1;
    const nextTimer = window.setTimeout(() => {
      if (isLastStep) {
        setSurfaceMode('leaderboard');
        setLeaderboardActivityVersion(0);
        return;
      }
      setDemoStepIndex((current) => current + 1);
    }, isLastStep ? DEMO_SQUARE_DELAY_MS + DEMO_TO_LEADERBOARD_DELAY_MS : DEMO_STEP_MS);

    return () => {
      window.clearTimeout(moveTimer);
      window.clearTimeout(squareTimer);
      window.clearTimeout(nextTimer);
    };
  }, [demoStepIndex, isDocumentVisible, surfaceMode]);

  const palette = previewPalette[theme];
  const demoStep = surfaceMode === 'demo' ? DEMO_STEPS[demoStepIndex] : null;
  const textStep = displayedDemoStep ?? demoStep;
  const sharedPost = initState?.type === 'share' ? initState.share : null;

  useEffect(() => {
    if (surfaceMode !== 'demo') {
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
  }, [demoStep, displayedDemoStep, reduceMotion, surfaceMode]);

  useEffect(() => {
    if (surfaceMode !== 'leaderboard' || !isDocumentVisible) return;
    const timer = window.setTimeout(() => {
      setSurfaceMode('intro');
      setDemoStepIndex(0);
      setDemoPhase(0);
      setDisplayedDemoStep(null);
      setDemoTextVisible(true);
    }, LEADERBOARD_IDLE_MS);
    return () => window.clearTimeout(timer);
  }, [isDocumentVisible, leaderboardActivityVersion, surfaceMode]);

  useEffect(() => {
    if (
      surfaceMode !== 'leaderboard'
      || rankingsLoading
      || !initState
      || initState.type === 'share'
      || Date.now() - rankingsLoadedAtRef.current < LEADERBOARD_REFRESH_MS
    ) {
      return;
    }

    let cancelled = false;

    const refreshRankings = async () => {
      try {
        setRankingsError(null);
        const response = await fetch('/api/rankings');
        const data = await response.json();
        if (!response.ok) throw new Error(data?.message || 'Unable to load the leaderboard.');
        if (cancelled) return;
        setRankings({
          hvh: Array.isArray(data?.hvh) ? data.hvh as RankingsShareRow[] : [],
          hva: Array.isArray(data?.hva) ? data.hva as RankingsShareRow[] : [],
        });
        rankingsLoadedAtRef.current = Date.now();
      } catch (error: any) {
        if (!cancelled) setRankingsError(error?.message || 'Unable to load the leaderboard.');
      }
    };

    void refreshRankings();

    return () => {
      cancelled = true;
    };
  }, [initState, rankingsLoading, surfaceMode]);

  const noteLeaderboardInteraction = () => {
    if (surfaceMode !== 'leaderboard') return;
    setLeaderboardActivityVersion((current) => current + 1);
  };

  const openGame = (event: React.MouseEvent<HTMLButtonElement>) => {
    try {
      localStorage.setItem(PREVIEW_ONBOARDING_KEY, 'true');
      sessionStorage.setItem('euclid_launch_preview_seen', 'true');
    } catch {}
    requestExpandedMode(event.nativeEvent, 'game');
  };

  if (initError) {
    return <PreviewStatus theme={theme} title="Unable to load Euclid" body={initError} />;
  }

  if (!initState) {
    return <PreviewStatus theme={theme} title="Loading Euclid" body="Preparing this post…" />;
  }

  if (sharedPost) {
    return <SharePreview share={sharedPost} theme={theme} />;
  }

  return (
    <div
      style={{
        background: palette.shellBg,
        color: palette.title,
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
        padding: '8px 12px 6px',
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
        data-demo-steps={DEMO_STEPS.length}
        style={{
          width: 'min(760px, 100%)',
          alignSelf: 'flex-start',
          minHeight: 'calc(100vh - 14px)',
          borderRadius: 22,
          border: `1px solid ${palette.cardBorder}`,
          background: `${
            theme === 'dark'
              ? 'linear-gradient(180deg, rgba(4,18,36,.76), rgba(4,18,36,.76))'
              : 'linear-gradient(180deg, rgba(255,255,255,.78), rgba(255,255,255,.78))'
          }, ${palette.shellBg}`,
          boxShadow: theme === 'dark' ? '0 28px 64px rgba(2,8,23,.38)' : '0 18px 44px rgba(15,23,42,.12)',
          padding: '18px 14px 14px',
          display: 'grid',
          gridTemplateRows: '1fr auto auto',
          gap: 10,
          overflow: 'hidden',
          backdropFilter: 'blur(10px)',
          boxSizing: 'border-box',
        }}
        >
          {surfaceMode === 'leaderboard' ? (
            <PreviewLeaderboard
              palette={palette}
              rankings={rankings}
              rankingsLoading={rankingsLoading}
              rankingsError={rankingsError}
              onInteract={noteLeaderboardInteraction}
            />
          ) : (
            <div
              style={{
                display: 'flex',
                alignItems: 'stretch',
                justifyContent: 'space-between',
                gap: 10,
                flexWrap: 'wrap',
                minHeight: 0,
              }}
            >
              <div
                style={{
                  display: 'grid',
                  gridTemplateRows: 'auto 1fr',
                  alignSelf: 'stretch',
                  gap: 14,
                  flex: '1 1 280px',
                  minWidth: 0,
                }}
              >
                <div style={{ display: 'grid', gap: 6 }}>
                  <div
                    style={{
                      fontSize: 12,
                      fontWeight: 800,
                      letterSpacing: '0.16em',
                      textTransform: 'uppercase',
                      color: palette.accent,
                    }}
                  >
                    Reddit Strategy Game
                  </div>
                  <div style={{ fontSize: 34, fontWeight: 900, lineHeight: 1 }}>
                    Euclid
                  </div>
                  <div style={{ color: palette.text, fontSize: 14, maxWidth: 420 }}>
                    Place dots. Complete squares. Rotated shapes count. Beat {EUCLID_LABEL} or
                    outplay another redditor.
                  </div>
                </div>

                <div
                  style={{
                    borderRadius: 16,
                    background: palette.panelBg,
                    border: `1px solid ${palette.panelBorder}`,
                    width: 'calc(100% + 10px)',
                    marginRight: -10,
                    padding: '10px 12px',
                    minHeight: 152,
                    color: palette.text,
                    fontSize: 13,
                    lineHeight: 1.5,
                    overflow: 'hidden',
                    display: 'grid',
                    alignContent: 'center',
                  }}
                >
                  <div style={{ color: palette.accent, fontSize: 12, fontWeight: 800, letterSpacing: '0.12em', textTransform: 'uppercase' }}>
                    <span style={{ display: 'inline-block', transform: 'translateY(-10px)' }}>
                      {textStep ? 'Quick Demo' : 'First Time Here?'}
                    </span>
                  </div>
                  {textStep ? (
                    <div
                      style={{
                        display: 'grid',
                        gap: 6,
                        opacity: demoTextVisible ? 1 : 0,
                        transition: reduceMotion ? 'none' : `opacity ${DEMO_TEXT_FADE_MS}ms ease`,
                      }}
                    >
                      <div style={{ fontSize: 15, fontWeight: 800, color: palette.title }}>
                        {textStep.title}
                      </div>
                      <div>{textStep.body}</div>
                    </div>
                  ) : (
                    <div style={{ display: 'grid', gap: 6 }}>
                      <div style={{ fontSize: 15, fontWeight: 800, color: palette.title }}>
                        8×8 Demo
                      </div>
                      <div>
                        Pause here for a few seconds and Euclid will replay a short 8×8 game sequence to explain the rules.
                      </div>
                    </div>
                  )}
                </div>
              </div>

              <PreviewBoard demoStep={demoStep} demoPhase={demoPhase} palette={palette} />
            </div>
          )}
        <div
          style={{
            borderRadius: 16,
            background: palette.panelBg,
            border: `1px solid ${palette.panelBorder}`,
            padding: '10px 12px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 10,
            flexWrap: 'wrap',
          }}
        >
          <div style={{ color: palette.accent, fontSize: 13, fontWeight: 700, flex: '1 1 320px', minWidth: 0 }}>
            Redditor vs Euclid, Redditor vs Redditor, Watch other redditor's live games, Leaderboard, and much more live in the full game!
          </div>
          <div
            style={{
              flex: `0 0 ${PREVIEW_BOARD_LANE_WIDTH}px`,
              maxWidth: '100%',
              display: 'flex',
              justifyContent: 'center',
              transform: 'translateX(10px)',
            }}
          >
            <button
              onClick={openGame}
              style={{
                border: 'none',
                cursor: 'pointer',
                borderRadius: 999,
                background: 'linear-gradient(135deg, #22c55e 0%, #16a34a 100%)',
                color: '#f8fafc',
                padding: '11px 20px',
                fontSize: 15,
                fontWeight: 800,
                boxShadow: '0 10px 24px rgba(22,163,74,.32)',
              }}
            >
              Start Playing!
            </button>
          </div>
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
            gap: 6,
          }}
        >
          {[
            'Take turns placing one dot on an empty space.',
            'A move scores when it completes a square in your color.',
            'Straight or rotated squares both count toward your total.',
          ].map((line) => (
            <div
              key={line}
              style={{
                borderRadius: 16,
                background: palette.panelBg,
                border: `1px solid ${palette.panelBorder}`,
                padding: '8px 10px',
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

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <PreviewApp />
  </StrictMode>,
);
