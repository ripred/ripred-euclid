import type { SharedPostPayload, RankingsSharePayload, ResultSharePayload } from '../shared/types/api';

import { ReplayBoardCard } from './share-replay';
import type { ThemeMode } from './theme';

const surfacePalette: Record<ThemeMode, {
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
}> = {
  dark: {
    shellBg: 'radial-gradient(circle at top, rgba(37,99,235,.22), transparent 34%), linear-gradient(180deg, #041124 0%, #07182f 58%, #0b2242 100%)',
    cardBg: 'rgba(4,18,36,.78)',
    cardBorder: 'rgba(148,163,184,.22)',
    softBg: 'rgba(15,23,42,.55)',
    softBorder: 'rgba(148,163,184,.18)',
    title: '#f8fafc',
    text: '#cbd5e1',
    muted: '#94a3b8',
    accent: '#93c5fd',
    red: '#fecaca',
    blue: '#bfdbfe',
  },
  light: {
    shellBg: 'radial-gradient(circle at top, rgba(191,219,254,.82), transparent 34%), linear-gradient(180deg, #eff6ff 0%, #e0ecff 58%, #dbeafe 100%)',
    cardBg: 'rgba(255,255,255,.82)',
    cardBorder: 'rgba(148,163,184,.26)',
    softBg: 'rgba(248,250,252,.88)',
    softBorder: 'rgba(148,163,184,.20)',
    title: '#0f172a',
    text: '#334155',
    muted: '#64748b',
    accent: '#0369a1',
    red: '#991b1b',
    blue: '#1d4ed8',
  },
};

function formatDisplayDate(input: string | number | Date = Date.now()) {
  return new Date(input).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}

function RankingsPreview({
  share,
  theme,
}: {
  share: RankingsSharePayload;
  theme: ThemeMode;
}) {
  const palette = surfacePalette[theme];
  const accent = share.bucket === 'hvh' ? '#ef4444' : '#2563eb';

  return (
    <div
      style={{
        background: palette.shellBg,
        color: palette.title,
        display: 'flex',
        justifyContent: 'center',
        padding: '8px 12px 6px',
      }}
    >
      <div
        style={{
          width: 'min(760px, 100%)',
          borderRadius: 22,
          border: `1px solid ${palette.cardBorder}`,
          background: palette.cardBg,
          boxShadow: theme === 'dark' ? '0 28px 64px rgba(2,8,23,.34)' : '0 18px 44px rgba(15,23,42,.12)',
          padding: '18px 16px 16px',
          display: 'grid',
          gap: 10,
          backdropFilter: 'blur(10px)',
        }}
      >
        <div>
          <div style={{ color: palette.accent, fontSize: 12, fontWeight: 800, letterSpacing: '0.14em', textTransform: 'uppercase' }}>
            r/{share.subredditName}
          </div>
          <div style={{ marginTop: 6, fontSize: 32, fontWeight: 900, lineHeight: 1.02 }}>
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
            padding: '12px 14px',
            display: 'flex',
            justifyContent: 'space-between',
            gap: 10,
            flexWrap: 'wrap',
          }}
        >
          <div style={{ color: palette.title, fontSize: 16, fontWeight: 800 }}>
            Leaderboard Snapshot
          </div>
          <div style={{ color: palette.muted, fontSize: 13 }}>
            Shared from Euclid on {formatDisplayDate(share.sharedAt)}
          </div>
        </div>

        <div style={{ display: 'grid', gap: 8 }}>
          {share.rows.slice(0, 5).map((row, index) => (
            <div
              key={`${row.userId}-${index}`}
              style={{
                borderRadius: 16,
                border: `1px solid ${palette.softBorder}`,
                background: palette.softBg,
                padding: '10px 12px',
                display: 'grid',
                gridTemplateColumns: 'auto 1fr auto auto',
                alignItems: 'center',
                gap: 12,
              }}
            >
              <div style={{ color: accent, fontSize: 22, fontWeight: 900, width: 28, textAlign: 'center' }}>
                {index + 1}
              </div>
              <div style={{ color: palette.title, fontSize: 16, fontWeight: 800, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {row.name || row.userId}
              </div>
              <div style={{ color: palette.title, fontSize: 16, fontWeight: 800 }}>
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

function ResultPreview({
  share,
  theme,
}: {
  share: ResultSharePayload;
  theme: ThemeMode;
}) {
  const palette = surfacePalette[theme];
  const score1 = share.board.m_players[0]?.m_score ?? 0;
  const score2 = share.board.m_players[1]?.m_score ?? 0;

  return (
    <div
      style={{
        background: palette.shellBg,
        color: palette.title,
        display: 'flex',
        justifyContent: 'center',
        padding: '8px 12px 6px',
      }}
    >
      <div
        style={{
          width: 'min(760px, 100%)',
          borderRadius: 22,
          border: `1px solid ${palette.cardBorder}`,
          background: palette.cardBg,
          boxShadow: theme === 'dark' ? '0 28px 64px rgba(2,8,23,.34)' : '0 18px 44px rgba(15,23,42,.12)',
          padding: '18px 16px 16px',
          display: 'grid',
          gap: 10,
          backdropFilter: 'blur(10px)',
        }}
      >
        <div>
          <div style={{ color: palette.accent, fontSize: 12, fontWeight: 800, letterSpacing: '0.14em', textTransform: 'uppercase' }}>
            r/{share.subredditName}
          </div>
          <div style={{ marginTop: 6, fontSize: 32, fontWeight: 900, lineHeight: 1.02 }}>
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
            padding: '12px 14px',
            display: 'grid',
            gap: 6,
          }}
        >
          <div style={{ color: palette.title, fontSize: 19, fontWeight: 900 }}>
            {share.headline}
          </div>
          <div style={{ color: palette.text, fontSize: 14 }}>
            {share.details}
          </div>
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
            gap: 8,
          }}
        >
          <div style={{ borderRadius: 16, border: `1px solid ${palette.softBorder}`, background: palette.softBg, padding: '12px 14px' }}>
            <div style={{ color: palette.red, fontSize: 14, fontWeight: 800 }}>{share.p1Name}</div>
            <div style={{ marginTop: 6, color: palette.title, fontSize: 30, fontWeight: 900 }}>{score1}</div>
          </div>
          <div style={{ borderRadius: 16, border: `1px solid ${palette.softBorder}`, background: palette.softBg, padding: '12px 14px' }}>
            <div style={{ color: palette.blue, fontSize: 14, fontWeight: 800 }}>{share.p2Name}</div>
            <div style={{ marginTop: 6, color: palette.title, fontSize: 30, fontWeight: 900 }}>{score2}</div>
          </div>
        </div>

        <ReplayBoardCard board={share.board} theme={theme} compact />

        <div
          style={{
            borderRadius: 16,
            border: `1px solid ${palette.softBorder}`,
            background: palette.softBg,
            padding: '12px 14px',
            color: palette.text,
            fontSize: 14,
            lineHeight: 1.5,
          }}
        >
          {share.footer}
        </div>
      </div>
    </div>
  );
}

export function SharePreview({
  share,
  theme,
}: {
  share: SharedPostPayload;
  theme: ThemeMode;
}) {
  if (share.kind === 'rankings') {
    return <RankingsPreview share={share} theme={theme} />;
  }
  return <ResultPreview share={share} theme={theme} />;
}
