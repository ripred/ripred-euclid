import type { CSSProperties, ReactNode } from "react";
import { SIZE, SQUARE_BY_ID, type RelayState } from "../../shared/edition-game";
import { coordinate } from "../../shared/edition-geometry";

const points = Array.from({ length: SIZE * SIZE }, (_, point) => point);
const location = (point: number) => ({
  x: 50 + (point % SIZE) * 100,
  y: 50 + Math.floor(point / SIZE) * 100,
});

type PointProps = {
  className: string;
  style: CSSProperties;
  children: ReactNode;
};

/** Shared board artwork has no session, focus or input effects. */
export function RelayBoard({
  game,
  selected = null,
  readOnly = true,
  renderPoint,
}: {
  game: RelayState | null;
  selected?: number | null;
  readOnly?: boolean;
  renderPoint?: (
    point: number,
    occupied: boolean,
    placed: boolean | undefined,
    props: PointProps,
  ) => ReactNode;
}) {
  const last = game?.placements.at(-1);
  const hint =
    !readOnly && selected === game?.hint?.point ? game?.hint?.point : null;
  const hintSquares =
    !readOnly && selected === hint ? (game?.hint?.squares ?? []) : [];
  return (
    <div
      className="puzzle-board"
      role="group"
      aria-label={
        readOnly
          ? "Six by six puzzle board. Arrow keys inspect points. Read-only."
          : "Six by six puzzle board"
      }
    >
      <svg viewBox="0 0 600 600" className="board-art" aria-hidden="true">
        <g className="board-grid">
          {Array.from({ length: SIZE }, (_, index) => (
            <g key={index}>
              <line
                x1={50 + index * 100}
                y1="50"
                x2={50 + index * 100}
                y2="550"
              />
              <line
                x1="50"
                y1={50 + index * 100}
                x2="550"
                y2={50 + index * 100}
              />
            </g>
          ))}
        </g>
        {hintSquares.map((id) => {
          const square = SQUARE_BY_ID.get(id);
          return square ? (
            <polygon
              key={`hint-${id}`}
              className="hint-square"
              points={square.corners
                .map((point) => {
                  const p = location(point);
                  return `${p.x},${p.y}`;
                })
                .join(" ")}
            />
          ) : null;
        })}
        {game?.completed.map((id) => {
          const square = SQUARE_BY_ID.get(id);
          return square ? (
            <polygon
              key={id}
              className={`square ${game.lastSquares.includes(id) ? "latest-square" : ""}`}
              points={square.corners
                .map((point) => {
                  const p = location(point);
                  return `${p.x},${p.y}`;
                })
                .join(" ")}
            />
          ) : null;
        })}
        {last !== undefined && game && game.lastSquares.length > 0 && (
          <g className="connection-rays">
            {Array.from({ length: 24 }, (_, index) => {
              const angle = (index * Math.PI) / 12;
              const center = location(last);
              return (
                <line
                  key={index}
                  x1={center.x + Math.cos(angle) * 16}
                  y1={center.y + Math.sin(angle) * 16}
                  x2={center.x + Math.cos(angle) * 46}
                  y2={center.y + Math.sin(angle) * 46}
                />
              );
            })}
          </g>
        )}
      </svg>
      {points.map((point) => {
        const occupied = game?.cells[point] === 1;
        const placed = game?.placements.includes(point);
        const p = location(point);
        const pointProps = {
          className: `board-point ${occupied ? "occupied" : "empty"} ${placed ? "placed" : ""} ${selected === point ? "selected-point" : ""} ${hint === point ? "hint-point" : ""} ${last === point ? "last-point" : ""}`,
          style: { left: `${p.x / 6}%`, top: `${p.y / 6}%` },
          children: (
            <>
              <span className="point-core" />
              <span className="coordinate-label" aria-hidden="true">
                {coordinate(point)}
              </span>
            </>
          ),
        };
        return renderPoint ? (
          renderPoint(point, occupied, placed, pointProps)
        ) : (
          <span key={point} {...pointProps} />
        );
      })}
    </div>
  );
}
