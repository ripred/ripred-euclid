import "./splash-carousel.css";
import { useRef, type MouseEvent, type ReactNode } from "react";
import type {
  ChallengeSpotlights,
  ChallengeWinner,
} from "../shared/challenge-spotlights";
import type { ExpandedEntry } from "./expanded-entry";
import { formatChallengeTime } from "./challenge-time";
import { Wordmark } from "./ui/Brand";
import { Icon } from "./ui/Icon";
import { RedditAvatar } from "./ui/RedditAvatar";

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

export function ChallengeWinnerCard({
  period,
  winner,
  preview,
}: {
  period: "daily" | "weekly";
  winner: ChallengeWinner;
  preview: boolean;
}) {
  return (
    <article className={`splash-winner splash-winner--${period}`}>
      <span className="splash-winner__medal">
        <RedditAvatar
          username={winner.username}
          avatar={winner.avatar}
          size={72}
        />
        <span className="splash-winner__trophy">
          <Icon name="trophy" size={18} />
        </span>
      </span>
      <p className="preview-panel__kicker">
        {period === "daily"
          ? "Yesterday’s daily challenge"
          : "Last week’s weekly challenge"}
      </p>
      <h2>{preview ? winner.username : `u/${winner.username}`}</h2>
      <p className="splash-winner__result">
        <strong>{winner.moves} moves</strong>
        <span>in {formatChallengeTime(winner.elapsedMs)}</span>
      </p>
      <div
        className="splash-winner__record"
        aria-label="Challenge wins including this result"
      >
        <span>
          <strong>{winner.dailyWins}</strong> daily wins
        </span>
        <span>
          <strong>{winner.weeklyWins}</strong> weekly wins
        </span>
      </div>
      <p className="preview-panel__body">Fewest pieces. Fastest finish.</p>
      {preview && (
        <p className="splash-sample">Layout preview · Sample result</p>
      )}
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
    <div className="splash-choices">
      <div>
        <p className="preview-panel__kicker">Your next move</p>
        <h2>How will you play?</h2>
      </div>
      <div className="splash-choices__grid">
        <button
          className="splash-choice splash-choice--solo"
          onClick={(e) => onExpand(e, "solo")}
        >
          <Icon name="arrow" size={24} />
          <strong>Play Euclid</strong>
          <span>A game at your pace</span>
        </button>
        <button
          className="splash-choice"
          onClick={(e) => onExpand(e, "reddit")}
        >
          <Icon name="users" size={24} />
          <strong>Play Another Redditor</strong>
          <span>Find your next opponent</span>
        </button>
        {challenges.preview && (
          <>
            <button className="splash-choice" disabled>
              <Icon name="trophy" size={24} />
              <strong>Daily Challenge</strong>
              <span>2–3 mixed squares · Not open</span>
            </button>
            <button className="splash-choice" disabled>
              <Icon name="trophy" size={24} />
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
