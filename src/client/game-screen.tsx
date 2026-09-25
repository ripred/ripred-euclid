import { BoardInput } from "./ui/BoardInput";
import { useBoardInput } from "./ui/use-board-input";
import React, {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import type { ShareChatItem, ShareSquare } from "../shared/types/api";
import type { Board } from "../shared/game/engine";
import type { PlayerColor, PlayerIndex } from "../shared/game/rules";
import { rulesSummary } from "./format";
import { calculateBoardLayout } from "./game-ui";
import {
  formatScoreFeedback,
  selectSquareLines,
  squareSignature,
  type ScoreFeedbackEvent,
} from "./score-feedback";
import { BoardDiagram, PieceGlyph } from "./ui/BoardDiagram";
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
import { Icon } from "./ui/Icon";
import { useBoardSounds, useSounds } from "./sound/use-sounds";
import { useReducedMotion } from "./ui/use-reduced-motion";
import "./game-screen.css";

export type GameExitLabel =
  | "Back"
  | "Leave Game"
  | "Stop Watching"
  | "Close"
  | "End Practice"
  | "Cancel Ranked"
  | "Abandon Ranked";

const squareCorners = (square: ShareSquare) => [
  square.p1,
  square.p2,
  square.p3,
  square.p4,
];

const HISTORY_MIN_OPACITY = 0.35;

function historyShapes(
  squares: readonly ShareSquare[],
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
  squares: readonly ShareSquare[],
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

function Avatar({ src, owner }: { src?: string | undefined; owner: Owner }) {
  return src ? (
    <img className="player__avatar" src={src} alt="" crossOrigin="anonymous" />
  ) : (
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
  avatar,
  feedback = null,
}: {
  owner: Owner;
  label: string;
  /** A short qualifier such as Euclid's difficulty. */
  tag?: string | undefined;
  score: number;
  target: number;
  active: boolean;
  avatar?: string | undefined;
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
        <Avatar src={avatar} owner={owner} />
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
  exitPending?: boolean;
  exitPendingLabel?: string;
  /** "Practice", "Ranked", "Redditor match" or "Spectating". */
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
  /** Extra keyboard gate from the caller, applied after the board's own. */
  acceptPlacementKey: (event: React.KeyboardEvent) => boolean;
  /** Extra toolbar controls owned by the caller (chat, assist, sound). */
  toolbar?: ReactNode;
  onRules: () => void;
}

export const GameScreen: React.FC<GameScreenProps> = ({
  exitLabel,
  viewport,
  board,
  onCellClick,
  onLeave,
  exitPending = false,
  exitPendingLabel = "Finishing action…",
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
  acceptPlacementKey,
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
  // Scores, status and chat share the board's column so their edges align.
  const column = Math.max(bw, Math.min(boardSpace.width, 360));

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
      // Subtract the real toolbar, scores, chat and controls; their height
      // changes with wrapping, fonts and chat, so no fixed allowance fits.
      const reservedHeight =
        content.getBoundingClientRect().height -
        boardElement.getBoundingClientRect().height;
      const boardStyle = getComputedStyle(boardElement);
      const boardMargins =
        parseFloat(boardStyle.marginLeft) + parseFloat(boardStyle.marginRight);
      const width = Math.max(
        0,
        Math.floor(screen.clientWidth - horizontalPadding - boardMargins),
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
  const tapSound = useBoardSounds({
    history: board.m_history,
    cells: board.m_board,
    width: board.W,
    localSide: myColor,
    feedback: scoreFeedback,
  });
  // Every placement path clicks at once; the server still decides the move.
  const place = (x: number, y: number) => {
    if (placingSide && ownerAt(board.m_board, y * board.W + x) === 0) {
      tapSound(placingSide);
    }
    onCellClick(x, y);
  };
  const boardInput = useBoardInput({
    width: board.W,
    height: board.H,
    cellSize: cell,
    gridRef,
    enabled: placingSide !== null,
    revision: board.m_history.length,
    isOpen: (index) => ownerAt(board.m_board, index) === 0,
    onPlace: (index) => place(index % board.W, Math.floor(index / board.W)),
    acceptKey: acceptPlacementKey,
  });
  const liveAimIdx = boardInput.aimIndex;

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

  const chatLogRef = useRef<HTMLDivElement>(null);
  const newestChatId = chatItems.at(-1)?.id ?? null;
  useEffect(() => {
    if (newestChatId === null || !chatLogRef.current) return;
    chatLogRef.current.scrollTop = chatLogRef.current.scrollHeight;
  }, [newestChatId]);

  const players = [
    {
      owner: 1 as const,
      name: p1Name,
      tag: p1Tag,
      avatar: p1Avatar,
      score: board.m_players[0].m_score,
    },
    {
      owner: 2 as const,
      name: p2Name,
      tag: p2Tag,
      avatar: p2Avatar,
      score: board.m_players[1].m_score,
    },
  ];
  const describeCell = (index: number) => {
    const owner = ownerAt(board.m_board, index);
    const label = pointLabel(index % board.W, Math.floor(index / board.W));
    const state = owner ? ownerName(owner) : "open";
    return `${label}, ${state}${index === lastIndex ? ", last move" : ""}`;
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
            disabled={exitPending}
            aria-busy={exitPending || undefined}
            onClick={onLeave}
          >
            <Icon name="back" size={18} />
            {exitPending ? exitPendingLabel : exitLabel}
          </button>
          <div className="game__title">
            <span className="game__mode">{modeLabel}</span>
            <span className="game__rules">{rulesSummary(board)}</span>
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
              avatar={player.avatar}
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

          <BoardInput
            width={board.W}
            height={board.H}
            cellSize={cell}
            controls={boardInput}
            label={`Board, ${board.W} by ${board.H}. Use arrow keys to move and Enter to place.`}
            describeCell={describeCell}
            onHover={(index) => {
              setPreviewIdx(index);
              if (assistOn && myColor != null)
                setHoverIdx(
                  ownerAt(board.m_board, index) === myColor ? index : null,
                );
            }}
          />
        </div>

        {chatItems.length > 0 && (
          <div className="game__chat">
            <div
              ref={chatLogRef}
              className="game__chat-log"
              role="log"
              aria-label="Game chat messages"
              aria-live="polite"
              aria-relevant="additions text"
            >
              {chatItems.slice(-8).map((it) => (
                <p key={it.id} className="euclid-chat-log__message">
                  <b>{it.sender}</b> {it.text}
                </p>
              ))}
            </div>
            <p className="game__chat-hint">
              {chatReadOnly
                ? "Chat is read only while spectating."
                : !chatCanCompose
                  ? "Chat is unavailable after the game ends."
                  : chatHasVisibleTrigger
                    ? 'Use the Chat button or press "\\".'
                    : 'Press "\\" to chat.'}
            </p>
          </div>
        )}
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

/** Practice and Redditor matches may show one-move and two-move targets. */
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
