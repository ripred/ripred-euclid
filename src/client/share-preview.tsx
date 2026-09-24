import type { CSSProperties } from "react";

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

function RankingsPreview({
  share,
  theme,
}: {
  share: RankingsSharePayload;
  theme: ThemeMode;
}) {
  const palette = surfacePalette[theme];
  const accent = share.bucket === "hvh" ? "#ef4444" : "#2563eb";

  return (
    <div
      style={{
        background: palette.shellBg,
        color: palette.title,
        display: "flex",
        justifyContent: "center",
        padding: "8px 12px 6px",
      }}
    >
      <div
        style={{
          width: "min(760px, 100%)",
          borderRadius: 22,
          border: `1px solid ${palette.cardBorder}`,
          background: palette.cardBg,
          boxShadow:
            theme === "dark"
              ? "0 28px 64px rgba(2,8,23,.34)"
              : "0 18px 44px rgba(15,23,42,.12)",
          padding: "18px 16px 16px",
          display: "grid",
          gap: 10,
          backdropFilter: "blur(10px)",
        }}
      >
        <div>
          <div
            style={{
              color: palette.accent,
              fontSize: 12,
              fontWeight: 800,
              letterSpacing: "0.14em",
            }}
          >
            r/{share.subredditName}
          </div>
          <div
            style={{
              marginTop: 6,
              fontSize: 32,
              fontWeight: 900,
              lineHeight: 1.02,
            }}
          >
            {share.title}
          </div>
          <div style={{ marginTop: 8, color: palette.text, fontSize: 14 }}>
            {share.subtitle}
          </div>
        </div>

        <div
          style={{
            borderRadius: 16,
            border: `1px solid ${palette.softBorder}`,
            background: palette.softBg,
            padding: "12px 14px",
            display: "flex",
            justifyContent: "space-between",
            gap: 10,
            flexWrap: "wrap",
          }}
        >
          <div style={{ color: palette.title, fontSize: 16, fontWeight: 800 }}>
            Leaderboard Snapshot
          </div>
          <div style={{ color: palette.muted, fontSize: 13 }}>
            Shared from Euclid on {formatDisplayDate(share.sharedAt)}
          </div>
        </div>

        <div style={{ display: "grid", gap: 8 }}>
          {share.rows.slice(0, 5).map((row, index) => (
            <div
              key={`${row.userId}-${index}`}
              style={{
                borderRadius: 16,
                border: `1px solid ${palette.softBorder}`,
                background: palette.softBg,
                padding: "10px 12px",
                display: "grid",
                gridTemplateColumns: "auto 1fr auto auto",
                alignItems: "center",
                gap: 12,
              }}
            >
              <div
                style={{
                  color: accent,
                  fontSize: 22,
                  fontWeight: 900,
                  width: 28,
                  textAlign: "center",
                }}
              >
                {index + 1}
              </div>
              <div
                style={{
                  color: palette.title,
                  fontSize: 16,
                  fontWeight: 800,
                  minWidth: 0,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {row.name || row.userId}
              </div>
              <div
                style={{ color: palette.title, fontSize: 16, fontWeight: 800 }}
              >
                {row.rating}
              </div>
              <div style={{ color: palette.muted, fontSize: 13 }}>
                {row.wins}-{row.losses}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// Both entrypoints use this layout, including posts already created with "game".
export function ResultShareView({
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
          <header>
            <p className="euclid-result-share__eyebrow">Euclid · Shared game</p>
            <h1>{share.headline}</h1>
            <p className="euclid-result-share__rules">{share.subtitle}</p>
          </header>

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
}: {
  share: SharedPostPayload;
  theme: ThemeMode;
}) {
  if (share.kind === "rankings") {
    return <RankingsPreview share={share} theme={theme} />;
  }
  return <ResultShareView share={share} theme={theme} />;
}
