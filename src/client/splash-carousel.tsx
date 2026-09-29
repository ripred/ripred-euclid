import "./splash-carousel.css";
import {
  useRef,
  type CSSProperties,
  type MouseEvent,
  type ReactNode,
} from "react";
import {
  type ChallengePeriod,
  type ChallengeWinner,
} from "../shared/challenge-spotlights";
import {
  COMPETITION_RANKING_GUIDANCE,
  formatCompetitionDate,
  formatCompetitionResult,
} from "./competition-display";
import type { ExpandedEntry } from "./expanded-entry";
import { formatChallengeTime } from "./challenge-time";
import type { RankingRow } from "../shared/types/api";
import { PieceGlyph } from "./ui/BoardDiagram";
import { boardAspectRatio } from "./ui/board-geometry";
import { TokenCluster, Wordmark } from "./ui/Brand";
import { Icon, type IconName } from "./ui/Icon";
import { PlayerAvatar } from "./ui/PlayerAvatar";
import { RedditAvatar } from "./ui/RedditAvatar";
import { useCountUp } from "./ui/use-count-up";
import { CHALLENGE_COPY, PODIUM_PLACES, useSceneCue } from "./splash-scene";

export type SplashSlideId = "rules" | "leaderboard" | ChallengePeriod;
export type ExpandSplash = (
  event: MouseEvent<HTMLButtonElement>,
  entry: ExpandedEntry,
) => void;
export interface SplashSlide {
  id: SplashSlideId;
  title: string;
  content: ReactNode;
}

/** The post's top line: the wordmark, and what is showing beside it. */
export function SplashHeader({ children }: { children: ReactNode }) {
  return (
    <header className="splash-header">
      <Wordmark size="sm" />
      {children}
    </header>
  );
}

/**
 * A slide's heading: a kicker in the slide's colour over its title, with an
 * optional line beneath and controls (children) set at the end.
 */
export function SceneHead({
  kicker,
  icon,
  title,
  subtitle,
  oneLine = false,
  children,
}: {
  kicker: string;
  icon?: IconName;
  title: string;
  subtitle?: string;
  /** Names that may run long stay on one line; the full text is the tooltip. */
  oneLine?: boolean;
  children?: ReactNode;
}) {
  return (
    <div className="splash-scene__head">
      <div className="splash-scene__heading">
        <p className="preview-panel__kicker">
          {icon && <Icon name={icon} size={14} />}
          {kicker}
        </p>
        <h2
          className={oneLine ? "splash-scene__title--one-line" : undefined}
          title={oneLine ? title : undefined}
        >
          {title}
        </h2>
        {subtitle && <p className="splash-scene__subtitle">{subtitle}</p>}
      </div>
      {children}
    </div>
  );
}

/* Every slide after the lesson shares its layout: art on a glowing stage
   beside a story panel tinted to match. */
type SceneTone = "red" | "blue" | "gold";
const STAGE_RATIO = boardAspectRatio(4, 4);

export function SplashScene({
  tone,
  live,
  stage,
  decorative = false,
  className = "",
  children,
}: {
  tone: SceneTone;
  /** Plays the scene's entrance; false while hidden or with reduced motion. */
  live: boolean;
  stage: ReactNode;
  /** Art that repeats the panel's facts stays out of the accessibility tree. */
  decorative?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <article
      className={`preview splash-scene splash-scene--${tone}${live ? " splash-scene--live" : ""} ${className}`}
    >
      <div
        className="preview__board splash-scene__stage"
        style={{ "--stage-ratio": STAGE_RATIO } as CSSProperties}
        aria-hidden={decorative || undefined}
        data-entrance={live ? "" : undefined}
      >
        {stage}
      </div>
      <div className="panel preview__side splash-scene__card">{children}</div>
    </article>
  );
}

/**
 * A light, endless fall of confetti in the players' colours and gold. Each
 * piece gets a fixed lane, pace and spin from a low-discrepancy sequence, and
 * starts mid-fall so the stage is never empty when the slide appears.
 */
const CONFETTI_COUNT = 16;
const CONFETTI = Array.from({ length: CONFETTI_COUNT }, (_, index) => {
  const spread = (index * 0.618034) % 1;
  const fall = 5 + ((index * 7) % 4);
  return {
    "--x": `${4 + spread * 92}%`,
    "--fall": `${fall}s`,
    "--delay": `${-fall * ((index * 0.381966) % 1)}s`,
    "--drift": `${(spread - 0.5) * 16}cqmin`,
    "--spin": `${(index % 2 ? 1 : -1) * (240 + (index % 5) * 60)}deg`,
  } as CSSProperties;
});

export function Confetti() {
  return (
    <span className="splash-confetti" aria-hidden="true">
      {CONFETTI.map((style, index) => (
        <span key={index} style={style} />
      ))}
    </span>
  );
}

/* Leaderboard: the top three on board-stone steps, first place in the middle. */

function PodiumPlace({
  rank,
  row,
  cued,
  reduced,
}: {
  rank: (typeof PODIUM_PLACES)[number];
  row: RankingRow | undefined;
  cued: boolean;
  reduced: boolean;
}) {
  const rating = useCountUp(cued && row ? row.rating : 0, {
    disabled: reduced || !cued,
    duration: 900,
  });
  const name = row ? row.name || row.userId : "Open seat";
  return (
    <li className={`splash-podium__place splash-podium__place--${rank}`}>
      <span className="splash-podium__avatar">
        {row ? (
          <PlayerAvatar name={name} avatar={row.avatar} size={96} />
        ) : (
          <span className="splash-podium__seat" aria-hidden="true">
            ?
          </span>
        )}
      </span>
      <span className="splash-podium__name" title={name}>
        {name}
      </span>
      <span className="splash-podium__step">
        <span className="splash-podium__rank num">{rank}</span>
        {row && (
          <span
            className="splash-podium__rating num"
            aria-label={`Rating ${row.rating}`}
          >
            {rating}
          </span>
        )}
      </span>
    </li>
  );
}

export function Podium({
  rows,
  label,
  cued,
  reduced,
}: {
  rows: readonly RankingRow[];
  label: string;
  cued: boolean;
  reduced: boolean;
}) {
  return (
    <ol className="splash-podium" aria-label={label}>
      {PODIUM_PLACES.map((rank) => (
        <PodiumPlace
          key={rank}
          rank={rank}
          row={rows[rank - 1]}
          cued={cued}
          reduced={reduced}
        />
      ))}
    </ol>
  );
}

/** Waits for the square to close before the numbers start counting. */
const WINNER_COUNT_DELAY_MS = 1100;

/**
 * The champion framed by the square they would have closed: pieces drop in,
 * the band draws around the avatar and confetti falls, then the time counts up.
 * No solution board is shown; the art is the brand motif, not the puzzle.
 */
export function ChallengeWinnerCard({
  period,
  winner,
  preview,
  active,
}: {
  period: ChallengePeriod;
  winner: ChallengeWinner;
  preview: boolean;
  active: boolean;
}) {
  const { owner, tone, name: challenge } = CHALLENGE_COPY[period];
  const { live, cued, reduced } = useSceneCue(active, WINNER_COUNT_DELAY_MS);
  const time = useCountUp(cued ? winner.elapsedMs : 0, {
    disabled: reduced || !cued,
    duration: 1200,
  });
  const name = preview ? winner.username : `u/${winner.username}`;

  return (
    <SplashScene
      tone={tone}
      live={live}
      decorative
      className={`splash-winner splash-winner--${period}`}
      stage={
        <>
          <Confetti />
          <TokenCluster owner={owner} className="splash-winner__square" />
          <span className="splash-winner__avatar">
            <RedditAvatar
              username={winner.username}
              avatar={winner.avatar}
              size={96}
            />
          </span>
        </>
      }
    >
      <SceneHead
        icon="trophy"
        kicker={`${challenge} Winner`}
        title={name}
        subtitle={
          (winner.preview ? "Test result · " : "") +
          (winner.endsAt
            ? `Ended ${formatCompetitionDate(winner.endsAt)}`
            : "Completed challenge")
        }
        oneLine
      />
      <dl className="splash-winner__stats">
        <div className="splash-winner__stat splash-winner__stat--squares">
          <dt>Squares</dt>
          <dd
            aria-label={
              winner.squares == null ? "Squares unavailable" : undefined
            }
          >
            <span className="num">{winner.squares ?? "—"}</span>
          </dd>
        </div>
        <div className="splash-winner__stat">
          <dt>Moves</dt>
          <dd>
            <span className="num">{winner.moves}</span>
            {winner.moves <= 4 && (
              <span className="splash-winner__pieces" aria-hidden="true">
                {Array.from({ length: winner.moves }, (_, index) => (
                  <PieceGlyph
                    key={index}
                    owner={owner}
                    size={14}
                    order={index}
                  />
                ))}
              </span>
            )}
          </dd>
        </div>
        <div className="splash-winner__stat splash-winner__stat--time">
          <dt>Time</dt>
          <dd
            className="num"
            aria-hidden="true"
            style={
              {
                "--time-digits": formatChallengeTime(winner.elapsedMs).length,
              } as CSSProperties
            }
          >
            {formatChallengeTime(time)}
          </dd>
        </div>
      </dl>
      <p className="euclid-sr-only">
        Result: {formatCompetitionResult(winner)}.
      </p>
      <div className="splash-scene__foot">
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
            : COMPETITION_RANKING_GUIDANCE}
        </p>
      </div>
    </SplashScene>
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
      <SplashHeader>
        <span className="splash-header__label">{slides[index]!.title}</span>
      </SplashHeader>
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
        <button
          className="btn btn--primary"
          onClick={(event) => onExpand(event, "game")}
        >
          Open Euclid
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
