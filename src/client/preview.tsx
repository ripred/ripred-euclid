import './index.css';

import { requestExpandedMode } from '@devvit/web/client';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

const previewBoard = [
  [1, 0, 2, 0, 1, 0],
  [0, 1, 0, 2, 0, 2],
  [2, 0, 1, 0, 2, 0],
  [0, 2, 0, 1, 0, 1],
];

const PreviewApp = () => {
  const openGame = (event: React.MouseEvent<HTMLButtonElement>) => {
    try {
      localStorage.setItem('euclid_first_play', 'true');
      sessionStorage.setItem('euclid_launch_preview_seen', 'true');
    } catch {}
    requestExpandedMode(event.nativeEvent, 'game');
  };

  return (
    <div
      style={{
        minHeight: '100vh',
        background:
          'radial-gradient(circle at top, rgba(37,99,235,.25), transparent 34%), linear-gradient(180deg, #041124 0%, #07182f 58%, #0b2242 100%)',
        color: '#f8fafc',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '18px 14px',
      }}
    >
      <div
        style={{
          width: 'min(760px, 100%)',
          borderRadius: 22,
          border: '1px solid rgba(148,163,184,.22)',
          background: 'rgba(4,18,36,.78)',
          boxShadow: '0 28px 64px rgba(2,8,23,.38)',
          padding: '22px 20px 18px',
          display: 'grid',
          gap: 18,
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 16,
            flexWrap: 'wrap',
          }}
        >
          <div style={{ display: 'grid', gap: 8 }}>
            <div
              style={{
                fontSize: 12,
                fontWeight: 800,
                letterSpacing: '0.16em',
                textTransform: 'uppercase',
                color: '#93c5fd',
              }}
            >
              Reddit Strategy Game
            </div>
            <div style={{ fontSize: 36, fontWeight: 900, lineHeight: 1 }}>
              Euclid
            </div>
            <div style={{ color: '#cbd5e1', fontSize: 15, maxWidth: 420 }}>
              Place dots. Complete squares. Rotated shapes count. Beat the AI or
              outplay another human.
            </div>
          </div>

          <div
            aria-hidden="true"
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(6, 18px)',
              gap: 10,
              padding: '8px 2px',
            }}
          >
            {previewBoard.flatMap((row, rowIndex) =>
              row.map((cell, cellIndex) => {
                const fill =
                  cell === 1 ? '#ef4444' : cell === 2 ? '#3b82f6' : 'rgba(148,163,184,.28)';
                const glow =
                  cell === 1
                    ? '0 0 14px rgba(239,68,68,.35)'
                    : cell === 2
                      ? '0 0 14px rgba(59,130,246,.35)'
                      : 'none';
                return (
                  <div
                    key={`${rowIndex}-${cellIndex}`}
                    style={{
                      width: 18,
                      height: 18,
                      borderRadius: '50%',
                      background: fill,
                      border: '1px solid rgba(255,255,255,.18)',
                      boxShadow: glow,
                    }}
                  />
                );
              })
            )}
          </div>
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
            gap: 12,
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
                background: 'rgba(15,23,42,.55)',
                border: '1px solid rgba(148,163,184,.16)',
                padding: '12px 14px',
                color: '#cbd5e1',
                fontSize: 14,
                lineHeight: 1.45,
              }}
            >
              {line}
            </div>
          ))}
        </div>

        <div
          style={{
            borderRadius: 16,
            background: 'rgba(15,23,42,.48)',
            border: '1px solid rgba(148,163,184,.14)',
            padding: '12px 14px',
            color: '#cbd5e1',
            fontSize: 14,
            lineHeight: 1.5,
          }}
        >
          First time here? Open the full game to choose AI, human multiplayer,
          spectate live boards, or browse rankings.
        </div>

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
            flexWrap: 'wrap',
          }}
        >
          <div style={{ color: '#93c5fd', fontSize: 14, fontWeight: 700 }}>
            Start in the full game to play AI, human, spectate, or rankings.
          </div>
          <button
            onClick={openGame}
            style={{
              border: 'none',
              cursor: 'pointer',
              borderRadius: 999,
              background: 'linear-gradient(135deg, #22c55e 0%, #16a34a 100%)',
              color: '#f8fafc',
              padding: '12px 22px',
              fontSize: 16,
              fontWeight: 800,
              boxShadow: '0 10px 24px rgba(22,163,74,.32)',
            }}
          >
            Start Playing
          </button>
        </div>
      </div>
    </div>
  );
};

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <PreviewApp />
  </StrictMode>
);
