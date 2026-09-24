import type { CSSProperties, ReactNode, Ref } from "react";
import { TIDE_SIZE as SIZE, type TideState } from "../../shared/edition-game";

const position = (point: number) => ({
  x: 70 + (point % SIZE) * 100,
  y: 70 + Math.floor(point / SIZE) * 100,
});

type PointProps = {
  className: string;
  style: CSSProperties;
  children: ReactNode;
};

/** One passive renderer preserves the expanded board's original geometry. */
export function TideBoard({
  game,
  selected = null,
  fresh = [],
  gridRef,
  ariaLabel = "Six by six Tide board",
  renderPoint,
}: {
  game: TideState | null;
  selected?: number | null;
  fresh?: string[];
  gridRef?: Ref<HTMLDivElement>;
  ariaLabel?: string;
  renderPoint?: (
    point: number,
    owner: number,
    anchored: boolean,
    turnsLeft: number,
    props: PointProps,
  ) => ReactNode;
}) {
  return (
    <div
      className="board-wrap"
      ref={gridRef}
      role="group"
      aria-label={ariaLabel}
    >
      <svg className="board-art" viewBox="0 0 640 640" aria-hidden="true">
        <defs>
          <radialGradient id="shore">
            <stop offset="0" stopColor="#fcfaf5" />
            <stop offset="1" stopColor="#f8f8f3" />
          </radialGradient>
        </defs>
        {[0, 1, 2, 3, 4].map((i) => (
          <rect
            key={i}
            x={30 - i * 6}
            y={30 - i * 6}
            width={580 + i * 12}
            height={580 + i * 12}
            rx={42 + i * 9}
            fill="none"
            stroke="#cfdfd8"
            strokeOpacity={0.5 - i * 0.065}
          />
        ))}
        <rect
          x="45"
          y="45"
          width="550"
          height="550"
          rx="4"
          fill="url(#shore)"
          stroke="#c4ccc2"
        />
        {Array.from({ length: 6 }, (_, i) => (
          <g key={i}>
            <path
              d={`M70 ${70 + i * 100}H570 M${70 + i * 100} 70V570`}
              stroke="#c3cec5"
              strokeWidth="1"
            />
            <text x={70 + i * 100} y="24" textAnchor="middle">
              {String.fromCharCode(65 + i)}
            </text>
            <text x="23" y={77 + i * 100} textAnchor="middle">
              {i + 1}
            </text>
          </g>
        ))}
        {game?.squares.map((square) => (
          <polygon
            key={square.id}
            className={`${square.owner === 1 ? "coral-square" : "teal-square"} ${fresh.includes(square.id) ? "fresh-square" : ""}`}
            points={square.corners
              .map((point) => {
                const p = position(point);
                return `${p.x},${p.y}`;
              })
              .join(" ")}
          />
        ))}
        {Array.from({ length: 36 }, (_, point) => {
          const p = position(point);
          return <circle key={point} cx={p.x} cy={p.y} r="4" fill="#a1afa5" />;
        })}
      </svg>
      {Array.from({ length: 36 }, (_, point) => {
        const owner = game?.board[point] ?? 0,
          anchored = game?.anchored[point] ?? false;
        const turnsLeft =
          owner && game
            ? Math.max(0, Math.ceil((game.expires[point]! - game.revision) / 2))
            : 0;
        const p = position(point);
        const pointProps = {
          className: `board-point owner-${owner}${anchored ? " anchored" : ""}${selected === point ? " selected" : ""}${owner && !anchored && turnsLeft <= 1 ? " fading" : ""}`,
          style: { left: `${p.x / 6.4}%`, top: `${p.y / 6.4}%` },
          children: (
            <>
              {owner !== 0 && (
                <>
                  <span className="stone" />
                  {anchored ? (
                    <span className="anchor-center" />
                  ) : (
                    <svg
                      className="age-ring"
                      viewBox="0 0 48 48"
                      aria-hidden="true"
                    >
                      <circle
                        cx="24"
                        cy="24"
                        r="21"
                        pathLength="6"
                        strokeDasharray={`${turnsLeft} 6`}
                      />
                    </svg>
                  )}
                </>
              )}
              {selected === point && <span className="selection-corners" />}
            </>
          ),
        };
        return renderPoint ? (
          renderPoint(point, owner, anchored, turnsLeft, pointProps)
        ) : (
          <span key={point} {...pointProps} />
        );
      })}
    </div>
  );
}
