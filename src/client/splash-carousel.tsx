import "./splash-carousel.css";
import {
  useEffect,
  useRef,
  useState,
  type MouseEvent,
  type ReactNode,
} from "react";
import type {
  ChallengeSpotlights,
  ChallengeWinner,
} from "../shared/challenge-spotlights";
import type { ExpandedEntry } from "./expanded-entry";
import { formatChallengeTime } from "./challenge-time";
import { PieceGlyph } from "./ui/BoardDiagram";
import { boardAspectRatio } from "./ui/board-geometry";
import { TokenCluster, Wordmark } from "./ui/Brand";
import { Icon } from "./ui/Icon";
import { RedditAvatar } from "./ui/RedditAvatar";
import { useCountUp } from "./ui/use-count-up";
import { useReducedMotion } from "./ui/use-reduced-motion";

export type SplashSlideId =
  | "rules"
  | "leaderboard"
  | "daily"
  | "weekly"
  | "play";
export type ExpandSplash = (
  event: MouseEvent<HTMLButtonElement>,
  entry: ExpandedEntry,
) => void;
export interface SplashSlide {
  id: SplashSlideId;
  title: string;
  content: ReactNode;
}

const WINNER_COPY = {
  daily: { owner: 1, when: "Yesterday’s daily challenge" },
  weekly: { owner: 2, when: "Last week’s weekly challenge" },
} as const;

/** Waits for the square to close before the numbers start counting. */
const WINNER_COUNT_DELAY_MS = 1100;

/**
 * The champion framed by the square they would have closed: pieces drop in,
 * the band draws around the avatar, then moves and time count up. No
 * solution board is shown; the art is the brand motif, not the puzzle.
 */
export function ChallengeWinnerCard({
  period,
  winner,
  preview,
  active,
}: {
  period: "daily" | "weekly";
  winner: ChallengeWinner;
  preview: boolean;
  active: boolean;
}) {
  const reduced = useReducedMotion();
  const { owner, when } = WINNER_COPY[period];
  const [counting, setCounting] = useState(false);
  useEffect(() => {
    if (!active) return;
    setCounting(false);
    const timer = window.setTimeout(
      () => setCounting(true),
      reduced ? 0 : WINNER_COUNT_DELAY_MS,
    );
    return () => window.clearTimeout(timer);
  }, [active, reduced]);
  const time = useCountUp(counting ? winner.elapsedMs : 0, {
    disabled: reduced || !counting,
    duration: 1200,
  });
  const name = preview ? winner.username : `u/${winner.username}`;
  const moveWord = winner.moves === 1 ? "move" : "moves";

  return (
    <article
      className={`preview splash-winner splash-winner--${period}${active && !reduced ? " splash-winner--live" : ""}`}
    >
      <div
        className="preview__board splash-winner__stage"
        style={{ aspectRatio: boardAspectRatio(4, 4) }}
        aria-hidden="true"
      >
        <TokenCluster owner={owner} className="splash-winner__square" />
        <span className="splash-winner__avatar">
          <RedditAvatar
            username={winner.username}
            avatar={winner.avatar}
            size={96}
          />
        </span>
      </div>
      <div className="panel preview__side splash-winner__card">
        <div className="splash-winner__head">
          <p className="preview-panel__kicker">{when}</p>
          <h2 title={name}>{name}</h2>
        </div>
        <dl className="splash-winner__stats">
          <div className="splash-winner__stat">
            <dt>Moves</dt>
            <dd>
              <span className="num">{winner.moves}</span>
              <span className="splash-winner__pieces" aria-hidden="true">
                {Array.from({ length: winner.moves }, (_, index) => (
                  <PieceGlyph key={index} owner={owner} size={14} />
                ))}
              </span>
            </dd>
          </div>
          <div className="splash-winner__stat">
            <dt>Time</dt>
            <dd className="num" aria-hidden="true">
              {formatChallengeTime(time)}
            </dd>
          </div>
        </dl>
        <p className="euclid-sr-only">
          Solved in {winner.moves} {moveWord},{" "}
          {formatChallengeTime(winner.elapsedMs)}.
        </p>
        <div className="splash-winner__foot">
          <p
            className="splash-winner__record"
            aria-label="Challenge wins including this result"
          >
            <span>
              <strong className="num">{winner.dailyWins}</strong> daily wins
            </span>
            <span>
              <strong className="num">{winner.weeklyWins}</strong> weekly wins
            </span>
          </p>
          <p className="splash-sample">
            {preview
              ? "Layout preview · Sample result"
              : "Fewest moves wins · time breaks ties"}
          </p>
        </div>
      </div>
    </article>
  );
}

export function SplashChoices({
  challenges,
  onExpand,
}: {
  challenges: ChallengeSpotlights;
  onExpand: ExpandSplash;
}) {
  return (
    <div className="panel splash-choices">
      <h2>How will you play?</h2>
      <div className="splash-choices__grid">
        {/* Red and blue match the home screen's solo and multiplayer cards. */}
        <button
          className="splash-choice splash-choice--solo"
          onClick={(e) => onExpand(e, "solo")}
        >
          <PieceGlyph owner={1} size={22} />
          <strong>Play Euclid</strong>
          <span>A game at your pace</span>
        </button>
        <button
          className="splash-choice splash-choice--reddit"
          onClick={(e) => onExpand(e, "reddit")}
        >
          <PieceGlyph owner={2} size={22} />
          <strong>Play Another Redditor</strong>
          <span>Find your next opponent</span>
        </button>
        {challenges.preview && (
          <>
            <button className="splash-choice" disabled>
              <Icon name="trophy" size={22} />
              <strong>Daily Challenge</strong>
              <span>2–3 mixed squares · Not open</span>
            </button>
            <button className="splash-choice" disabled>
              <Icon name="trophy" size={22} />
              <strong>Weekly Challenge</strong>
              <span>3–4 oblique squares · Not open</span>
            </button>
          </>
        )}
      </div>
      <button
        className="btn btn--ghost btn--sm"
        onClick={(e) => onExpand(e, "game")}
      >
        Game menu &amp; settings
      </button>
      {challenges.preview && (
        <p className="splash-sample">
          Challenge choices preview · Both schedules are off
        </p>
      )}
    </div>
  );
}

export function SplashCarousel({
  slides,
  activeId,
  onSelect,
  paused,
  onPause,
  onExpand,
  expansionError,
}: {
  slides: SplashSlide[];
  activeId: SplashSlideId;
  onSelect: (id: SplashSlideId) => void;
  paused: boolean;
  onPause: (paused: boolean) => void;
  onExpand: ExpandSplash;
  expansionError: string | null;
}) {
  const index = Math.max(
    0,
    slides.findIndex((s) => s.id === activeId),
  );
  const pointer = useRef<{ x: number; y: number; id: number } | null>(null);
  const shift = (offset: number) =>
    onSelect(slides[(index + offset + slides.length) % slides.length]!.id);
  return (
    <section
      className="splash-carousel"
      aria-label="Explore Euclid"
      aria-roledescription="carousel"
    >
      <header className="splash-header">
        <Wordmark size="sm" />
        <span>{slides[index]!.title}</span>
      </header>
      <div
        className="splash-viewport"
        // Keep focused slide controls available until the viewer resumes.
        // A resting pointer must not silently stop the teaching sequence.
        onFocusCapture={() => onPause(true)}
        onPointerDown={(e) => {
          if ((e.target as Element).closest("button, a, input")) return;
          pointer.current = { x: e.clientX, y: e.clientY, id: e.pointerId };
        }}
        onPointerCancel={() => {
          pointer.current = null;
        }}
        onPointerUp={(e) => {
          const start = pointer.current;
          pointer.current = null;
          if (!start || start.id !== e.pointerId) return;
          const dx = e.clientX - start.x,
            dy = e.clientY - start.y;
          if (Math.abs(dx) >= 45 && Math.abs(dx) > Math.abs(dy) * 1.5)
            shift(dx < 0 ? 1 : -1);
        }}
      >
        <div className="splash-track">
          {slides.map((slide, i) => (
            <div
              key={slide.id}
              className="splash-slide"
              role="group"
              aria-roledescription="slide"
              aria-label={`${i + 1} of ${slides.length}: ${slide.title}`}
              aria-hidden={i !== index}
              inert={i !== index}
              data-slide={slide.id}
            >
              {slide.content}
            </div>
          ))}
        </div>
      </div>
      <nav className="splash-navigation" aria-label="Splash navigation">
        <button
          className="btn btn--ghost"
          aria-label="Previous slide"
          onClick={() => shift(-1)}
        >
          <Icon name="back" size={18} />
        </button>
        <div className="splash-dots">
          {slides.map((slide) => (
            <button
              key={slide.id}
              aria-label={`Show ${slide.title}`}
              aria-current={activeId === slide.id ? "true" : undefined}
              onClick={() => onSelect(slide.id)}
            >
              <span />
            </button>
          ))}
        </div>
        <button
          className="btn btn--ghost"
          aria-label="Next slide"
          onClick={() => shift(1)}
        >
          <Icon name="arrow" size={18} />
        </button>
        <button
          className="btn btn--ghost splash-pause"
          onClick={() => onPause(!paused)}
          aria-label={paused ? "Resume rotation" : "Pause rotation"}
        >
          {paused ? "Resume" : "Pause"}
        </button>
      </nav>
      <footer className="splash-footer">
        <button className="btn btn--primary" onClick={() => onSelect("play")}>
          Play now
        </button>
        <button className="btn" onClick={(e) => onExpand(e, "watch")}>
          Watch live
        </button>
        <button
          className="btn btn--ghost"
          aria-label="Full leaderboard"
          onClick={(e) => onExpand(e, "leaderboard")}
        >
          <Icon name="trophy" size={20} />
        </button>
        {expansionError && (
          <p className="preview-actions__error" role="alert">
            {expansionError}
          </p>
        )}
      </footer>
    </section>
  );
}
