import React, {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import type { BoardSquare } from "./game/types";
import type { Board } from "./game/engine";
import type { PlayerColor, PlayerIndex } from "./game/rules";
import { fadeLabel, rulesSummary } from "./format";
import { calculateBoardLayout, shouldPlaceFromKey } from "./game-ui";
import {
  formatScoreFeedback,
  selectSquareLines,
  squareSignature,
  type ScoreFeedbackEvent,
} from "./score-feedback";
import {
  BoardDiagram,
  PieceGlyph,
  type PieceFade,
  type WashingStone,
} from "./ui/BoardDiagram";
import {
  BOARD_BLEED,
  ownerAt,
  ownerName,
  pointLabel,
  squaresWithCorner,
  type BoardHint,
  type BoardMarker,
  type BoardSquareShape,
  type Owner,
} from "./ui/board-geometry";
import { Dialog } from "./ui/Dialog";
import type { ResultPlayer } from "./game-results";
import type { SoloExitLabel } from "./solo/presentation";
import { Icon } from "./ui/Icon";
import { useBoardSounds, useSounds } from "./sound/use-sounds";
import { useReducedMotion } from "./ui/use-reduced-motion";
import "./game-screen.css";

export type GameExitLabel = SoloExitLabel;

const squareCorners = (square: BoardSquare) => [
  square.p1,
  square.p2,
  square.p3,
  square.p4,
];

const HISTORY_MIN_OPACITY = 0.35;

/** Below this cell size, touch placement asks for a confirming second tap. */
const AIM_CELL_SIZE = 38;

function historyShapes(
  squares: readonly BoardSquare[],
  owner: Owner,
): BoardSquareShape[] {
  // Older squares recede so the most recent structure stays readable.
  return squares.map((square, index) => ({
    key: `${owner}-${squareSignature(square)}`,
    owner,
    tone: "history",
    corners: squareCorners(square),
    opacity:
      squares.length <= 1
        ? 1
        : HISTORY_MIN_OPACITY +
          (index / (squares.length - 1)) * (1 - HISTORY_MIN_OPACITY),
  }));
}

const freshShapes = (
  squares: readonly BoardSquare[],
  owner: Owner,
  feedbackId: string,
): BoardSquareShape[] =>
  squares.map((square) => ({
    key: `${feedbackId}-${owner}-${squareSignature(square)}`,
    owner,
    tone: "fresh",
    corners: squareCorners(square),
  }));

/** Counts toward a new value so score changes read as earned, not swapped. */
function useCountUp(value: number, disabled: boolean): number {
  const [shown, setShown] = useState(value);
  const shownRef = useRef(value);
  useEffect(() => {
    if (disabled || Math.abs(value - shownRef.current) > 400) {
      shownRef.current = value;
      setShown(value);
      return;
    }
    const from = shownRef.current;
    const started = performance.now();
    let frame = 0;
    const step = (now: number) => {
      const progress = Math.min(1, (now - started) / 650);
      const eased = 1 - (1 - progress) ** 3;
      const next = Math.round(from + (value - from) * eased);
      shownRef.current = next;
      setShown(next);
      if (progress < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [value, disabled]);
  return shown;
}

function Avatar({ owner }: { owner: Owner }) {
  return (
    <span className="player__avatar player__avatar--token">
      <PieceGlyph owner={owner} size={22} />
    </span>
  );
}

export function ScoreCard({
  owner,
  label,
  tag,
  score,
  target,
  active,
  feedback = null,
}: {
  owner: Owner;
  label: string;
  /** A short qualifier such as Euclid's difficulty. */
  tag?: string | undefined;
  score: number;
  target: number;
  active: boolean;
  feedback?: ScoreFeedbackEvent | null;
}) {
  const reduced = useReducedMotion();
  const shown = useCountUp(score, reduced);
  const progress = target > 0 ? Math.min(1, score / target) : 0;
  const squareWord =
    feedback && feedback.completedSquares.length === 1 ? "square" : "squares";

  return (
    <div
      className={`player player--${owner}${active ? " player--active" : ""}`}
    >
      <div className="player__row">
        <Avatar owner={owner} />
        <span
          className="player__name"
          title={tag ? `${label} · ${tag}` : label}
        >
          <span>{label}</span>
          {tag ? <span className="player__tag">{tag}</span> : null}
        </span>
        <span className="player__score num">{shown}</span>
        {feedback ? (
          <span key={feedback.id} className="player__delta" aria-hidden="true">
            {formatScoreFeedback(feedback)}
          </span>
        ) : null}
      </div>
      <div
        className="player__race"
        role="meter"
        aria-label={`${label} progress to ${target}`}
        aria-valuemin={0}
        aria-valuemax={target}
        aria-valuenow={Math.min(score, target)}
      >
        <span style={{ transform: `scaleX(${progress})` }} />
      </div>
      <span
        className="euclid-sr-only"
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        {feedback
          ? `Move ${feedback.moveCount}: ${label} scored ${feedback.pointsScored} points by completing ${feedback.completedSquares.length} ${squareWord}.`
          : ""}
      </span>
    </div>
  );
}

export interface GameScreenProps {
  exitLabel: GameExitLabel;
  viewport: { width: number; height: number };
  board: Board;
  onCellClick: (x: number, y: number) => void;
  onLeave: () => void;
  /** "Practice" or "Ranked". */
  modeLabel: string;
  p1Name: string;
  p2Name: string;
  p1Tag?: string | undefined;
  p2Tag?: string | undefined;
  midText: string;
  /** Whose turn it is, for the scoreboard; null once decided. */
  activeSide: PlayerColor | null;
  /** The side the local player may place right now, for the hover preview. */
  placingSide: PlayerColor | null;
  thinking?: boolean;
  overlay: ReactNode;
  assistOn: boolean;
  myColor: PlayerColor | null;
  scoreFeedback: ScoreFeedbackEvent | null;
  futureScoreFeedback: readonly ScoreFeedbackEvent[];
  /** Fading pieces: stones that washed away on the latest move. */
  washing?: readonly WashingStone[];
  /** Extra toolbar controls owned by the caller (hints, sound). */
  toolbar?: ReactNode;
  onRules: () => void;
}

export const GameScreen: React.FC<GameScreenProps> = ({
  exitLabel,
  viewport,
  board,
  onCellClick,
  onLeave,
  modeLabel,
  p1Name,
  p2Name,
  p1Tag,
  p2Tag,
  midText,
  activeSide,
  placingSide,
  thinking = false,
  overlay,
  assistOn,
  myColor,
  scoreFeedback,
  futureScoreFeedback,
  washing = [],
  toolbar,
  onRules,
}) => {
  const screenRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const boardRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const [boardSpace, setBoardSpace] = useState({ width: 0, height: 0 });
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
  const { cellSize: cell, boardWidth: bw, boardHeight: bh } = layout;
  // Scores and status share the board's column so their edges align.
  const column = Math.max(bw, Math.min(boardSpace.width, 360));

  useLayoutEffect(() => {
    const screen = screenRef.current;
    const content = contentRef.current;
    const boardElement = boardRef.current;
    if (!screen || !content || !boardElement) return;

    // Unresolved lengths read as 0, never NaN, so layout always has a size.
    const px = (value: string) => parseFloat(value) || 0;
    const measure = () => {
      const style = getComputedStyle(screen);
      const horizontalPadding = px(style.paddingLeft) + px(style.paddingRight);
      const verticalPadding = px(style.paddingTop) + px(style.paddingBottom);
      // Subtract the real toolbar, scores and controls; their height changes
      // with wrapping and fonts, so no fixed allowance fits.
      const reservedHeight =
        content.getBoundingClientRect().height -
        boardElement.getBoundingClientRect().height;
      const boardStyle = getComputedStyle(boardElement);
      const boardMargins =
        px(boardStyle.marginLeft) + px(boardStyle.marginRight);
      const width =
        Math.max(
          0,
          Math.floor(screen.clientWidth - horizontalPadding - boardMargins),
        ) || 0;
      const height =
        Math.max(
          0,
          Math.floor(screen.clientHeight - verticalPadding - reservedHeight),
        ) || 0;
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

  const futureSignatures = new Set(
    futureScoreFeedback.flatMap((feedback) =>
      feedback.completedSquares.map(squareSignature),
    ),
  );
  const layers = ([0, 1] as const).map((index: PlayerIndex) =>
    selectSquareLines(
      board.m_players[index].m_squares.filter(
        (square) => !futureSignatures.has(squareSignature(square)),
      ),
      scoreFeedback?.player === index ? scoreFeedback.completedSquares : [],
      showHistoricalSquares,
    ),
  );
  const squares: BoardSquareShape[] = [
    ...historyShapes(layers[0]!.historical, 1),
    ...historyShapes(layers[1]!.historical, 2),
    ...freshShapes(layers[0]!.active, 1, scoreFeedback?.id ?? "none"),
    ...freshShapes(layers[1]!.active, 2, scoreFeedback?.id ?? "none"),
  ];
  const footprints =
    board.scoring === "bbox" && scoreFeedback
      ? scoreFeedback.footprintBounds.map((bounds, index) => ({
          key: `${scoreFeedback.id}-footprint-${index}`,
          owner: (scoreFeedback.player + 1) as Owner,
          ...bounds,
        }))
      : [];
  const footprintSize = footprints[0]
    ? `${footprints[0].width}×${footprints[0].height}`
    : null;

  /* ===== Assist: hover one of your pieces to see squares it can finish ===== */
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const [previewIdx, setPreviewIdx] = useState<number | null>(null);

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

    for (const corners of squaresWithCorner(W, H, x0, y0)) {
      const indices = corners.map((p) => p.y * W + p.x);
      const values = indices.map((index) => arr[index]);
      // Any opponent piece in the corners blocks this square for us
      if (values.some((value) => value === undefined || value === opp))
        continue;
      const open = indices.filter((_, i) => values[i] === 0);
      if (open.length === 1) open.forEach((index) => one.add(index));
      else if (open.length === 2) open.forEach((index) => two.add(index));
    }
    return { oneMoveTargets: one, twoMoveTargets: two };
  }, [assistOn, hoverIdx, myColor, board.W, board.H, board.m_board]);

  const hints: BoardHint[] =
    myColor == null
      ? []
      : [
          ...[...oneMoveTargets].map((index) => ({
            index,
            owner: myColor,
            strength: "near" as const,
          })),
          ...[...twoMoveTargets]
            .filter((index) => !oneMoveTargets.has(index))
            .map((index) => ({
              index,
              owner: myColor,
              strength: "far" as const,
            })),
        ];
  const assistShowing = assistOn && hoverIdx !== null && hints.length > 0;

  const clearHover = () => {
    setHoverIdx(null);
    setPreviewIdx(null);
  };

  // Mobile touch for assist: press and drag across your pieces.
  useEffect(() => {
    const grid = gridRef.current;
    if (!assistOn || !isMobile || !grid) return;
    const handleTouchMove = (e: TouchEvent) => {
      const touch = e.touches.item(0);
      if (!touch) return;
      const rect = grid.getBoundingClientRect();
      const tx = Math.floor((touch.clientX - rect.left) / cell);
      const ty = Math.floor((touch.clientY - rect.top) / cell);
      const idx = ty * board.W + tx;
      if (
        tx >= 0 &&
        tx < board.W &&
        idx >= 0 &&
        idx < board.m_board.length &&
        board.m_board[idx] === myColor
      ) {
        setHoverIdx(idx);
      } else {
        setHoverIdx(null);
      }
    };
    const handleTouchStart = (e: TouchEvent) => {
      e.preventDefault();
      handleTouchMove(e);
    };
    const handleTouchEnd = () => setHoverIdx(null);
    grid.addEventListener("touchstart", handleTouchStart);
    grid.addEventListener("touchmove", handleTouchMove);
    grid.addEventListener("touchend", handleTouchEnd);
    grid.addEventListener("touchcancel", handleTouchEnd);
    return () => {
      grid.removeEventListener("touchstart", handleTouchStart);
      grid.removeEventListener("touchmove", handleTouchMove);
      grid.removeEventListener("touchend", handleTouchEnd);
      grid.removeEventListener("touchcancel", handleTouchEnd);
    };
  }, [assistOn, isMobile, cell, board.W, board.m_board, myColor]);

  /* ===== Touch on dense boards: tap to aim, tap the same point to place ===== */
  const aimRequired = cell < AIM_CELL_SIZE;
  const [aimIdx, setAimIdx] = useState<number | null>(null);
  const pointerTypeRef = useRef("mouse");
  const liveAimIdx =
    placingSide && aimIdx !== null && ownerAt(board.m_board, aimIdx) === 0
      ? aimIdx
      : null;
  const tapSound = useBoardSounds({
    history: board.m_history,
    cells: board.m_board,
    width: board.W,
    localSide: myColor,
    feedback: scoreFeedback,
  });
  // Every placement path clicks at once; the game still decides the move.
  const place = (x: number, y: number) => {
    if (placingSide && ownerAt(board.m_board, y * board.W + x) === 0) {
      tapSound(placingSide);
    }
    onCellClick(x, y);
  };
  const onCellActivate = (x: number, y: number) => {
    const index = y * board.W + x;
    const touch = pointerTypeRef.current !== "mouse";
    if (
      touch &&
      aimRequired &&
      placingSide &&
      ownerAt(board.m_board, index) === 0 &&
      liveAimIdx !== index
    ) {
      setAimIdx(index);
      return;
    }
    setAimIdx(null);
    place(x, y);
  };

  /*
   * Keystrokes never queue ahead of a move: Enter or Space places only when
   * it was pressed after this turn became placeable and is not a repeat.
   */
  const placeableSinceRef = useRef(Infinity);
  useLayoutEffect(() => {
    placeableSinceRef.current = placingSide ? performance.now() : Infinity;
  }, [placingSide, board.m_history.length]);

  /* ===== Keyboard: a roving focus across the points ===== */
  const [focusIdx, setFocusIdx] = useState(
    () => Math.floor(board.H / 2) * board.W + Math.floor(board.W / 2),
  );
  const safeFocusIdx = Math.min(focusIdx, board.W * board.H - 1);
  const focusCell = (index: number) => {
    setFocusIdx(index);
    gridRef.current
      ?.querySelector<HTMLElement>(`[data-index="${index}"]`)
      ?.focus();
  };
  const onGridKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    // Act on the point the key event reached, not a possibly stale focus.
    const targetIndex = Number(
      (event.target as HTMLElement).dataset.index ?? safeFocusIdx,
    );
    const x = targetIndex % board.W;
    const y = Math.floor(targetIndex / board.W);
    const moves: Record<string, [number, number]> = {
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
      ArrowUp: [0, -1],
      ArrowDown: [0, 1],
    };
    const move = moves[event.key];
    if (move) {
      event.preventDefault();
      const nx = Math.max(0, Math.min(board.W - 1, x + move[0]));
      const ny = Math.max(0, Math.min(board.H - 1, y + move[1]));
      focusCell(ny * board.W + nx);
      return;
    }
    if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      focusCell(y * board.W + (event.key === "Home" ? 0 : board.W - 1));
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      if (
        shouldPlaceFromKey(
          event.nativeEvent,
          placeableSinceRef.current,
          placingSide !== null,
        )
      )
        place(x, y);
    }
  };

  const lastIndex =
    board.m_last.x >= 0 ? board.m_last.y * board.W + board.m_last.x : -1;
  const lastOwner = lastIndex >= 0 ? ownerAt(board.m_board, lastIndex) : 0;
  const markers: BoardMarker[] = [];
  if (lastOwner) {
    markers.push({
      x: board.m_last.x,
      y: board.m_last.y,
      owner: lastOwner,
      kind: "last",
    });
  }
  if (placingSide && liveAimIdx !== null) {
    markers.push(
      {
        x: liveAimIdx % board.W,
        y: Math.floor(liveAimIdx / board.W),
        owner: placingSide,
        kind: "ghost",
      },
      {
        x: liveAimIdx % board.W,
        y: Math.floor(liveAimIdx / board.W),
        owner: placingSide,
        kind: "pending",
      },
    );
  } else if (
    placingSide &&
    previewIdx !== null &&
    !assistShowing &&
    ownerAt(board.m_board, previewIdx) === 0
  ) {
    markers.push({
      x: previewIdx % board.W,
      y: Math.floor(previewIdx / board.W),
      owner: placingSide,
      kind: "ghost",
    });
  }

  const scoreBadgePosition = scoreFeedback
    ? {
        left: Math.min(
          bw - Math.min(34, bw / 2),
          Math.max(Math.min(34, bw / 2), (scoreFeedback.point.x + 0.5) * cell),
        ),
        top: Math.max(0, scoreFeedback.point.y * cell),
      }
    : null;

  const players = [
    {
      owner: 1 as const,
      name: p1Name,
      tag: p1Tag,
      score: board.m_players[0].m_score,
    },
    {
      owner: 2 as const,
      name: p2Name,
      tag: p2Tag,
      score: board.m_players[1].m_score,
    },
  ];
  // Fading pieces: opacity tracks the moves a stone has left, and a stone in
  // its owner's final turn is ringed: use it now, or watch it go.
  const fadeMoves = 2 * board.fadeTurns - 1;
  const fade: (PieceFade | null)[] = board.fadeTurns
    ? board.m_board.map((_, index) => {
        const moves = board.movesLeft(index);
        return moves === null
          ? null
          : {
              opacity: 0.32 + 0.68 * Math.min(1, moves / fadeMoves),
              last: (board.turnsLeft(index) ?? Infinity) <= 1,
            };
      })
    : [];
  const describeCell = (index: number) => {
    const owner = ownerAt(board.m_board, index);
    const label = pointLabel(index % board.W, Math.floor(index / board.W));
    const state = owner ? ownerName(owner) : "open";
    const turns = board.turnsLeft(index);
    const fading =
      turns === null
        ? ""
        : turns === 0
          ? ", washes away after the next move"
          : `, lasts ${turns} more ${turns === 1 ? "turn" : "turns"}`;
    return `${label}, ${state}${fading}${index === lastIndex ? ", last move" : ""}`;
  };

  return (
    <div
      ref={screenRef}
      className="game"
      role="region"
      aria-label="Euclid game"
      tabIndex={overlay ? -1 : 0}
      style={{ maxHeight: viewport.height }}
    >
      {overlay}
      <div
        ref={contentRef}
        className="game__content"
        style={{ "--column": `${column}px` } as React.CSSProperties}
        inert={overlay ? true : undefined}
        aria-hidden={overlay ? true : undefined}
      >
        <header className="game__bar">
          <button
            type="button"
            className="btn btn--ghost btn--sm game__exit"
            onClick={onLeave}
          >
            <Icon name="back" size={18} />
            {exitLabel}
          </button>
          <div className="game__title">
            <span className="game__mode">{modeLabel}</span>
            <span className="game__rules">
              {rulesSummary({ ...board, fadeTurns: 0 })}
            </span>
            {board.fadeTurns ? (
              <span className="game__fade">
                {fadeLabel(board.fadeTurns, "sentence")}
              </span>
            ) : null}
          </div>
          <div className="game__tools">
            <button
              type="button"
              className="icon-btn"
              aria-label="How to play"
              title="How to play"
              onClick={onRules}
            >
              <Icon name="help" />
            </button>
            <button
              type="button"
              className="icon-btn"
              aria-pressed={!showHistoricalSquares}
              aria-label={
                showHistoricalSquares
                  ? "Hide past squares"
                  : "Show past squares"
              }
              title={
                showHistoricalSquares
                  ? "Hide past squares"
                  : "Show past squares"
              }
              onClick={() => setShowHistoricalSquares((visible) => !visible)}
            >
              <Icon name={showHistoricalSquares ? "eye" : "eyeOff"} />
            </button>
            {toolbar}
          </div>
        </header>

        <div
          className={`game__scores${isMobile ? " game__scores--compact" : ""}`}
        >
          {players.map((player, index) => (
            <ScoreCard
              key={player.owner}
              owner={player.owner}
              label={player.name}
              tag={player.tag}
              score={player.score}
              target={board.winScore}
              active={activeSide === player.owner}
              feedback={scoreFeedback?.player === index ? scoreFeedback : null}
            />
          ))}
        </div>

        <p
          className={`game__status${thinking ? " game__status--thinking" : ""}`}
          aria-live="polite"
        >
          {activeSide ? <PieceGlyph owner={activeSide} size={16} /> : null}
          {/* The animated ellipsis replaces a static one while thinking. */}
          <span>
            {liveAimIdx !== null
              ? `Tap ${pointLabel(liveAimIdx % board.W, Math.floor(liveAimIdx / board.W))} again to place`
              : thinking
                ? midText.replace(/…$/, "")
                : midText}
          </span>
        </p>

        <div
          ref={boardRef}
          className="game__board"
          style={{ width: bw, height: bh }}
          onMouseLeave={clearHover}
        >
          <div
            className="game__board-art"
            style={{
              top: -BOARD_BLEED.top * cell,
              right: -BOARD_BLEED.right * cell,
              bottom: -BOARD_BLEED.bottom * cell,
              left: -BOARD_BLEED.left * cell,
            }}
          >
            <BoardDiagram
              width={board.W}
              height={board.H}
              cells={board.m_board}
              squares={squares}
              footprints={footprints}
              markers={markers}
              hints={assistOn && hoverIdx !== null ? hints : []}
              dimEmpty={assistShowing}
              arrivingIndex={lastIndex >= 0 ? lastIndex : null}
              fade={fade}
              washing={washing}
            />
          </div>

          {scoreFeedback && scoreBadgePosition && (
            <div
              key={scoreFeedback.id}
              className={`score-pop score-pop--${scoreFeedback.player === 0 ? 1 : 2}`}
              style={scoreBadgePosition}
              aria-hidden="true"
            >
              <strong>+{scoreFeedback.pointsScored}</strong>
              <span>
                {scoreFeedback.completedSquares.length > 1
                  ? `${scoreFeedback.completedSquares.length} squares`
                  : footprintSize
                    ? `${footprintSize} footprint`
                    : "1 square"}
              </span>
            </div>
          )}

          <div
            ref={gridRef}
            className="game__grid"
            role="grid"
            aria-label={`Board, ${board.W} by ${board.H}. Use arrow keys to move and Enter to place.`}
            onKeyDown={onGridKeyDown}
            style={{
              gridTemplateColumns: `repeat(${board.W}, ${cell}px)`,
              gridAutoRows: `${cell}px`,
            }}
          >
            {Array.from({ length: board.H }, (_, y) => (
              <div key={y} role="row" className="game__row">
                {Array.from({ length: board.W }, (_, x) => {
                  const index = y * board.W + x;
                  const owner = ownerAt(board.m_board, index);
                  return (
                    <div
                      key={x}
                      role="gridcell"
                      data-index={index}
                      tabIndex={index === safeFocusIdx ? 0 : -1}
                      aria-label={describeCell(index)}
                      className={`game__cell${owner === 0 && placingSide ? " game__cell--open" : ""}`}
                      onFocus={() => setFocusIdx(index)}
                      onPointerDown={(event) => {
                        pointerTypeRef.current = event.pointerType;
                      }}
                      onClick={() => onCellActivate(x, y)}
                      onPointerEnter={(event) => {
                        if (event.pointerType !== "mouse") return;
                        setPreviewIdx(index);
                        if (assistOn && myColor != null) {
                          setHoverIdx(owner === myColor ? index : null);
                        }
                      }}
                    />
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

/* ===== Result dialog ===== */

export function ResultDialog({
  titleId,
  headline,
  tone,
  detail,
  players,
  children,
  actions,
}: {
  titleId: string;
  headline: string;
  tone: "win" | "loss" | "neutral";
  detail?: ReactNode;
  players?: readonly ResultPlayer[] | undefined;
  children?: ReactNode;
  actions: ReactNode;
}) {
  const sounds = useSounds();
  // The result sting plays once, as the dialog arrives.
  const toneRef = useRef(tone);
  useEffect(() => sounds.result(toneRef.current), [sounds]);
  return (
    <Dialog labelledBy={titleId} className={`result result--${tone}`}>
      <div className="result__crest" aria-hidden="true">
        <PieceGlyph owner={1} size={34} />
        <PieceGlyph owner={2} size={34} />
      </div>
      <h2 id={titleId}>{headline}</h2>
      {detail ? <p className="result__detail">{detail}</p> : null}
      {players ? (
        <dl className="result__table">
          {players.map((player) => (
            <div
              key={player.owner}
              className={`result__player${player.winner ? " result__player--winner" : ""}`}
            >
              <dt>
                <PieceGlyph owner={player.owner} size={18} />
                <span>{player.name}</span>
              </dt>
              <dd className="result__score num">{player.score}</dd>
              <dd className="result__stats">
                {player.squares} {player.squares === 1 ? "square" : "squares"}
                {player.bestSquare > 0 ? ` · best ${player.bestSquare}` : ""}
              </dd>
            </div>
          ))}
        </dl>
      ) : null}
      {children}
      <div className="dialog__actions result__actions">{actions}</div>
    </Dialog>
  );
}

/** A non-terminal message over the board, such as a rejected move. */
export function NoticeDialog({
  titleId,
  message,
  children,
}: {
  titleId: string;
  message: string;
  children: ReactNode;
}) {
  return (
    <Dialog labelledBy={titleId} className="notice-dialog">
      <h2 id={titleId} className="notice-dialog__message">
        {message}
      </h2>
      <div className="dialog__actions">{children}</div>
    </Dialog>
  );
}

/** Practice games may show one-move and two-move targets. */
export function AssistToggle({
  on,
  onToggle,
}: {
  on: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      className="icon-btn"
      aria-pressed={on}
      aria-label={on ? "Turn off square hints" : "Show square hints"}
      title={
        on
          ? "Square hints on: hover or press one of your pieces"
          : "Show square hints"
      }
      onClick={onToggle}
    >
      <Icon name="assist" />
    </button>
  );
}

/* ===== Confetti: red, blue and porcelain chips burst from the result ===== */

const CONFETTI_COUNT = 150;
// Paper physics: a quick burst, then a slow drift at about 200px/s.
const GRAVITY = 520; // px/s²
const DRAG = 2.4; // velocity decay per second

export const Confetti: React.FC<{ show: boolean }> = ({ show }) => {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const reduced = useReducedMotion();
  useEffect(() => {
    if (!show || reduced) return;
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    let w = 0;
    let h = 0;
    // Draw at device resolution so chips move smoothly between pixels.
    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = window.innerWidth;
      h = window.innerHeight;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener("resize", resize);

    const tokens = getComputedStyle(document.documentElement);
    const colors = [
      "--piece-red-mid",
      "--piece-red-hi",
      "--piece-blue-mid",
      "--piece-blue-hi",
      "--text",
    ].map((name) => tokens.getPropertyValue(name).trim() || "#e8341f");
    // Burst from the result crest, just above the dialog's centre.
    const originX = w / 2;
    const originY = h * 0.36;
    const parts = Array.from({ length: CONFETTI_COUNT }, () => {
      const angle = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 1.1;
      const speed = 700 + Math.random() * 900;
      return {
        x: originX + (Math.random() - 0.5) * 60,
        y: originY + (Math.random() - 0.5) * 20,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        size: 7 + Math.random() * 7,
        spin: (Math.random() - 0.5) * 12,
        rot: Math.random() * Math.PI * 2,
        flip: Math.random() * Math.PI * 2,
        flipSpeed: 6 + Math.random() * 8,
        sway: 18 + Math.random() * 30,
        round: Math.random() < 0.45,
        color: colors[Math.floor(Math.random() * colors.length)] ?? "#e8341f",
      };
    });

    let frame = 0;
    let last = performance.now();
    let elapsed = 0;
    const tick = (now: number) => {
      // Integrate in seconds; clamp only real stalls such as a hidden tab.
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      elapsed += dt;
      ctx.clearRect(0, 0, w, h);
      const decay = Math.exp(-DRAG * dt);
      let alive = false;
      for (const p of parts) {
        p.vx *= decay;
        p.vy = p.vy * decay + GRAVITY * dt;
        p.x += p.vx * dt + Math.sin(elapsed * 3 + p.flip) * p.sway * dt;
        p.y += p.vy * dt;
        p.rot += p.spin * dt;
        p.flip += p.flipSpeed * dt;
        if (p.y - p.size < h) alive = true;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        // A paper chip flipping in the air shows its edge between faces.
        ctx.scale(1, Math.max(0.12, Math.abs(Math.cos(p.flip))));
        ctx.fillStyle = p.color;
        if (p.round) {
          ctx.beginPath();
          ctx.arc(0, 0, p.size / 2, 0, Math.PI * 2);
          ctx.fill();
        } else {
          ctx.fillRect(-p.size / 2, -p.size / 3, p.size, (p.size * 2) / 3);
        }
        ctx.restore();
      }
      if (alive) frame = requestAnimationFrame(tick);
      else ctx.clearRect(0, 0, w, h);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", resize);
    };
  }, [show, reduced]);
  if (!show) return null;
  return <canvas ref={ref} className="confetti" aria-hidden="true" />;
};
