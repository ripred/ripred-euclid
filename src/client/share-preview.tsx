import { useState, type CSSProperties, type MouseEventHandler } from "react";

import "./share-preview.css";
import type {
  SharedPostPayload,
  RankingsSharePayload,
  ResultSharePayload,
} from "../shared/types/api";

import { ReplayBoardCard } from "./share-replay";
import type { ThemeMode } from "./theme";

const surfacePalette: Record<
  ThemeMode,
  {
    shellBg: string;
    cardBg: string;
    cardBorder: string;
    softBg: string;
    softBorder: string;
    title: string;
    text: string;
    muted: string;
    accent: string;
    red: string;
    blue: string;
  }
> = {
  dark: {
    shellBg:
      "radial-gradient(circle at top, rgba(37,99,235,.22), transparent 34%), linear-gradient(180deg, #041124 0%, #07182f 58%, #0b2242 100%)",
    cardBg: "rgba(4,18,36,.78)",
    cardBorder: "rgba(148,163,184,.22)",
    softBg: "rgba(15,23,42,.55)",
    softBorder: "rgba(148,163,184,.18)",
    title: "#f8fafc",
    text: "#cbd5e1",
    muted: "#94a3b8",
    accent: "#93c5fd",
    red: "#fecaca",
    blue: "#bfdbfe",
  },
  light: {
    shellBg:
      "radial-gradient(circle at top, rgba(191,219,254,.82), transparent 34%), linear-gradient(180deg, #eff6ff 0%, #e0ecff 58%, #dbeafe 100%)",
    cardBg: "rgba(255,255,255,.82)",
    cardBorder: "rgba(148,163,184,.26)",
    softBg: "rgba(248,250,252,.88)",
    softBorder: "rgba(148,163,184,.20)",
    title: "#0f172a",
    text: "#334155",
    muted: "#64748b",
    accent: "#0369a1",
    red: "#991b1b",
    blue: "#1d4ed8",
  },
};

function formatDisplayDate(input: string | number | Date = Date.now()) {
  return new Date(input).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

function ResultHeading({ share }: { share: ResultSharePayload }) {
  return (
    <header>
      <p className="euclid-result-share__eyebrow">Euclid · Shared game</p>
      <h1>{share.headline}</h1>
      <p className="euclid-result-share__rules">{share.subtitle}</p>
    </header>
  );
}

function ResultScores({
  share,
  theme,
}: {
  share: ResultSharePayload;
  theme: ThemeMode;
}) {
  const palette = surfacePalette[theme];
  const players = [
    { side: 1, name: share.p1Name, color: palette.red },
    { side: 2, name: share.p2Name, color: palette.blue },
  ];

  return (
    <dl className="euclid-result-share__scores" aria-label="Final scores">
      {players.map(({ side, name, color }) => (
        <div className="euclid-result-share__player" key={side}>
          <dt style={{ color }}>{name}</dt>
          <dd>
            {share.board.m_players[side - 1]?.m_score ?? 0}
            <span className="euclid-result-share__outcome">
              {share.winnerSide === side ? "Winner" : "Opponent"}
            </span>
          </dd>
        </div>
      ))}
    </dl>
  );
}

function RankingsSummary({ share }: { share: RankingsSharePayload }) {
  return (
    <>
      <header>
        <p className="euclid-result-share__eyebrow">
          Euclid · Leaderboard snapshot
        </p>
        <h1>{share.title}</h1>
        <p className="euclid-result-share__rules">{share.subtitle}</p>
      </header>
      {share.rows.length > 0 ? (
        <ol
          className="euclid-share-preview__rankings"
          aria-label="Shared leaderboard leaders"
          style={
            {
              "--share-rank-accent":
                share.bucket === "hvh" ? "#ef4444" : "#2563eb",
            } as CSSProperties
          }
        >
          {share.rows.slice(0, 3).map((row, index) => (
            <li key={`${row.userId}-${index}`}>
              <span className="euclid-share-preview__rank" aria-hidden="true">
                {index + 1}
              </span>
              <span className="euclid-share-preview__name">
                {row.name || row.userId}
              </span>
              <span
                className="euclid-share-preview__rating"
                aria-label={`Rating ${row.rating}`}
              >
                {row.rating}
              </span>
            </li>
          ))}
        </ol>
      ) : (
        <p className="euclid-share-preview__empty">
          No ranked players in this snapshot.
        </p>
      )}
    </>
  );
}

// Full presentation for the expanded entrypoint and posts created with "game".
export function ResultShareView({
  share,
  theme,
}: {
  share: ResultSharePayload;
  theme: ThemeMode;
}) {
  const palette = surfacePalette[theme];

  return (
    <section
      className="euclid-result-share"
      aria-label="Shared game result"
      tabIndex={0}
      style={
        {
          background: palette.shellBg,
          color: palette.title,
          "--share-muted": palette.muted,
          "--share-text": palette.text,
          "--share-border": palette.cardBorder,
          "--share-surface": palette.softBg,
        } as CSSProperties
      }
    >
      <article
        className="euclid-result-share__card"
        style={{ background: palette.cardBg }}
      >
        <div className="euclid-result-share__summary">
          <ResultHeading share={share} />
          <ResultScores share={share} theme={theme} />
          <p className="euclid-result-share__detail">{share.details}</p>
          <footer>
            <p>{share.footer}</p>
            <p>
              r/{share.subredditName} ·{" "}
              <time dateTime={share.sharedAt}>
                {formatDisplayDate(share.sharedAt)}
              </time>
            </p>
          </footer>
        </div>
        <div className="euclid-result-share__replay">
          <ReplayBoardCard board={share.board} theme={theme} compact />
        </div>
      </article>
    </section>
  );
}

export function SharePreview({
  share,
  theme,
  onExpand,
}: {
  share: SharedPostPayload;
  theme: ThemeMode;
  onExpand: MouseEventHandler<HTMLButtonElement>;
}) {
  const palette = surfacePalette[theme];
  const [expansionFailed, setExpansionFailed] = useState(false);
  const expand: MouseEventHandler<HTMLButtonElement> = (event) => {
    try {
      onExpand(event);
      setExpansionFailed(false);
    } catch {
      setExpansionFailed(true);
    }
  };

  return (
    <section
      className="euclid-share-preview"
      data-expansion-failed={expansionFailed || undefined}
      aria-label={
        share.kind === "rankings"
          ? "Shared leaderboard preview"
          : "Shared game result preview"
      }
      style={
        {
          background: palette.shellBg,
          color: palette.title,
          "--share-muted": palette.muted,
          "--share-text": palette.text,
          "--share-border": palette.cardBorder,
          "--share-surface": palette.softBg,
          "--share-accent": palette.accent,
        } as CSSProperties
      }
    >
      <article
        className="euclid-share-preview__card"
        style={{ background: palette.cardBg }}
      >
        <div className="euclid-share-preview__summary">
          {share.kind === "rankings" ? (
            <RankingsSummary share={share} />
          ) : (
            <>
              <ResultHeading share={share} />
              <ResultScores share={share} theme={theme} />
              <p className="euclid-result-share__detail">{share.details}</p>
            </>
          )}
          <p className="euclid-share-preview__metadata">
            r/{share.subredditName} ·{" "}
            <time dateTime={share.sharedAt}>
              {formatDisplayDate(share.sharedAt)}
            </time>
          </p>
        </div>
        <div className="euclid-share-preview__actions">
          {expansionFailed ? (
            <p className="euclid-share-preview__error" role="alert">
              Could not open this post. Try again.
            </p>
          ) : null}
          <button
            type="button"
            className="euclid-share-preview__expand"
            aria-label={
              share.kind === "rankings"
                ? "View full leaderboard snapshot"
                : "View full result & replay"
            }
            onClick={expand}
          >
            <span className="euclid-share-preview__expand-label">
              {share.kind === "rankings"
                ? "View full leaderboard snapshot"
                : "View full result & replay"}
            </span>
            <span
              className="euclid-share-preview__expand-short"
              aria-hidden="true"
            >
              {share.kind === "rankings"
                ? "View full snapshot"
                : "View full result"}
            </span>
          </button>
        </div>
      </article>
    </section>
  );
}
