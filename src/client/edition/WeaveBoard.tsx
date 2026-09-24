import type { CSSProperties, ReactNode } from "react";
import {
  POINTS,
  TRIANGLE_BY_ID,
  distanceSquared,
  type LatticePoint,
  type WeaveState,
} from "../../shared/edition-game";
import type { Player } from "../../shared/edition-contract";

const pointPosition = (point: number) => POINTS[point];
const edges = POINTS.flatMap((a) =>
  POINTS.filter((b) => b.id > a.id && distanceSquared(a, b) === 1).map((b) => ({
    a,
    b,
  })),
);

type PointProps = {
  className: string;
  style: CSSProperties;
  children: ReactNode;
};

/** The same geometry serves passive inline artwork and the expanded controls. */
export function WeaveBoard({
  game,
  available = false,
  newFromRevision = game?.revision ?? 0,
  renderPoint,
}: {
  game: WeaveState | null;
  available?: boolean;
  newFromRevision?: number;
  renderPoint?: (
    point: LatticePoint,
    owner: 0 | Player,
    props: PointProps,
  ) => ReactNode;
}) {
  return (
    <div
      className={`lattice ${available ? "is-ready" : "is-paused"}`}
      role="group"
      aria-label="Seven-row triangular lattice"
    >
      <svg
        className="lattice-threads"
        viewBox="0 0 1000 870"
        aria-hidden="true"
      >
        <g className="grid-lines">
          {edges.map(({ a, b }) => (
            <line key={`${a.id}-${b.id}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y} />
          ))}
        </g>
        {game?.claims.map((claim) => {
          const triangle = TRIANGLE_BY_ID.get(claim.id);
          if (!triangle) return null;
          const points = triangle.corners
            .map((id) => {
              const p = pointPosition(id);
              return p ? `${p.x},${p.y}` : "";
            })
            .join(" ");
          return (
            <g
              key={claim.id}
              className={`claimed-triangle player-${claim.player} ${claim.revision > newFromRevision ? "new-stitch" : ""}`}
            >
              <polygon points={points} />
              <polygon className="stitch-line" points={points} />
            </g>
          );
        })}
      </svg>
      {POINTS.map((point) => {
        const owner = game?.cells[point.id] ?? 0;
        const pointProps = {
          className: `lattice-point owner-${owner} ${game?.lastMove?.point === point.id ? "last-point" : ""}`,
          style: { left: `${point.x / 10}%`, top: `${point.y / 8.7}%` },
          children: (
            <>
              <span className={`point-mark ${owner === 2 ? "diamond" : ""}`} />
              <span className="point-coordinate" aria-hidden="true">
                {point.label}
              </span>
            </>
          ),
        };
        return renderPoint ? (
          renderPoint(point, owner, pointProps)
        ) : (
          <span key={point.id} {...pointProps} />
        );
      })}
    </div>
  );
}
