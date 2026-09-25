import { useId, type ReactNode } from "react";

import {
  BOARD_BLEED,
  centre,
  ownerAt,
  polygonPoints,
  type BoardFootprint,
  type BoardHint,
  type BoardMarker,
  type BoardSquareShape,
  type GridPoint,
  type Owner,
} from "./board-geometry";
import "./board.css";

const POINT_RADIUS = 0.2;
const PIECE_RADIUS = 0.37;

/** SVG ids must be unique per board and valid inside url(#…). */
function useSvgIds() {
  const base = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  return {
    slab: `${base}-slab`,
    sheen: `${base}-sheen`,
    point: `${base}-point`,
    shadow: `${base}-shadow`,
    piece1: `${base}-p1`,
    piece2: `${base}-p2`,
  };
}

type SvgIds = ReturnType<typeof useSvgIds>;

/** Gradient stop driven by a design token; style resolves var() everywhere. */
function Stop({ offset, color }: { offset: string; color: `--${string}` }) {
  return <stop offset={offset} style={{ stopColor: `var(${color})` }} />;
}

/** Lighting and materials shared by every element on one board. */
function BoardMaterials({ ids }: { ids: SvgIds }) {
  return (
    <defs>
      <radialGradient id={ids.slab} cx="30%" cy="18%" r="95%">
        <Stop offset="0%" color="--slab-light" />
        <Stop offset="55%" color="--slab" />
        <Stop offset="100%" color="--slab-dark" />
      </radialGradient>
      <linearGradient id={ids.sheen} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor="#fff" stopOpacity="0.28" />
        <stop offset="8%" stopColor="#fff" stopOpacity="0" />
        <stop offset="92%" stopColor="#000" stopOpacity="0" />
        <stop offset="100%" stopColor="#000" stopOpacity="0.3" />
      </linearGradient>
      <radialGradient id={ids.point} cx="38%" cy="32%" r="70%">
        <stop offset="0%" stopColor="#ffffff" />
        <stop offset="60%" stopColor="#ecebe7" />
        <stop offset="100%" stopColor="#b9b8b3" />
      </radialGradient>
      <radialGradient id={ids.shadow} cx="50%" cy="50%" r="50%">
        <stop offset="0%" stopColor="#000" stopOpacity="0.55" />
        <stop offset="55%" stopColor="#000" stopOpacity="0.28" />
        <stop offset="100%" stopColor="#000" stopOpacity="0" />
      </radialGradient>
      {(["red", "blue"] as const).map((tone) => (
        <radialGradient
          key={tone}
          id={tone === "red" ? ids.piece1 : ids.piece2}
          cx="36%"
          cy="30%"
          r="72%"
        >
          <Stop offset="0%" color={`--piece-${tone}-hi`} />
          <Stop offset="38%" color={`--piece-${tone}-mid`} />
          <Stop offset="82%" color={`--piece-${tone}-lo`} />
          <Stop offset="100%" color={`--piece-${tone}-rim`} />
        </radialGradient>
      ))}
    </defs>
  );
}

function PieceShape({
  owner,
  x,
  y,
  ids,
  className = "",
}: {
  owner: Owner;
  x: number;
  y: number;
  ids: SvgIds;
  className?: string;
}) {
  const r = PIECE_RADIUS;
  const glossX = x - r * 0.28;
  const glossY = y - r * 0.4;
  return (
    <g className={`board__piece board__piece--${owner} ${className}`}>
      <circle
        className="board__piece-shadow"
        cx={x + 0.05}
        cy={y + 0.09}
        r={r * 1.18}
        fill={`url(#${ids.shadow})`}
      />
      <g className="board__piece-body">
        <circle
          className="board__piece-disc"
          cx={x}
          cy={y}
          r={r}
          fill={`url(#${owner === 1 ? ids.piece1 : ids.piece2})`}
        />
        <circle
          className="board__piece-groove-light"
          cx={x}
          cy={y + 0.025}
          r={r * 0.5}
        />
        <circle className="board__piece-groove" cx={x} cy={y} r={r * 0.5} />
        <ellipse
          className="board__piece-gloss"
          cx={glossX}
          cy={glossY}
          rx={r * 0.42}
          ry={r * 0.24}
          transform={`rotate(-24 ${glossX} ${glossY})`}
        />
      </g>
    </g>
  );
}

/** A standalone token for scoreboards, legends and inline copy. */
export function PieceGlyph({
  owner,
  size = 18,
}: {
  owner: Owner;
  size?: number;
}) {
  const ids = useSvgIds();
  return (
    <svg
      className="piece-glyph"
      width={size}
      height={size}
      viewBox="0 0 1 1"
      aria-hidden="true"
      focusable="false"
    >
      <BoardMaterials ids={ids} />
      <PieceShape owner={owner} x={0.5} y={0.46} ids={ids} />
    </svg>
  );
}

function SquareBand({
  corners,
  owner,
  fresh,
  opacity,
}: {
  corners: readonly GridPoint[];
  owner: Owner;
  fresh: boolean;
  opacity?: number | undefined;
}) {
  const points = polygonPoints(corners);
  return (
    <g
      className={`board__band board__band--${owner}${fresh ? " board__band--fresh" : ""}`}
      style={opacity === undefined ? undefined : { opacity }}
    >
      {fresh ? <polygon className="board__band-fill" points={points} /> : null}
      <polygon className="board__band-shadow" points={points} />
      <polygon className="board__band-core" points={points} pathLength={1} />
      <polygon className="board__band-shine" points={points} pathLength={1} />
    </g>
  );
}

export interface BoardDiagramProps {
  width: number;
  height: number;
  cells: ArrayLike<number>;
  blockedPoints?: readonly number[];
  squares?: readonly BoardSquareShape[];
  footprints?: readonly BoardFootprint[];
  markers?: readonly BoardMarker[];
  hints?: readonly BoardHint[];
  /** Board index of a piece that should drop in. */
  arrivingIndex?: number | null;
  /** Visually recede open points while assist hints are shown. */
  dimEmpty?: boolean;
  /** "cover" crops the board to fill its box, for decorative macro art. */
  fit?: "contain" | "cover";
  /** Draw the slab and open points; false leaves only pieces and squares. */
  slab?: boolean;
  className?: string;
  title?: string;
  children?: ReactNode;
}

/**
 * Passive SVG board. One unit is one grid cell and every point sits at the
 * centre of its cell, so an HTML input grid can overlay the grid exactly.
 */
export function BoardDiagram({
  width,
  height,
  cells,
  blockedPoints = [],
  squares = [],
  footprints = [],
  markers = [],
  hints = [],
  arrivingIndex = null,
  dimEmpty = false,
  fit = "contain",
  slab = true,
  className = "",
  title,
  children,
}: BoardDiagramProps) {
  const ids = useSvgIds();
  const hintAt = new Map(hints.map((hint) => [hint.index, hint]));
  const radius = Math.min(0.5, Math.max(width, height) * 0.045);
  const indices = Array.from({ length: width * height }, (_, index) => index);
  const history = squares.filter((square) => square.tone === "history");
  const fresh = squares.filter((square) => square.tone === "fresh");
  const blocked = squares.filter((square) => square.tone === "blocked");
  const { left, top, right, bottom } = BOARD_BLEED;

  return (
    <svg
      className={`board${dimEmpty ? " board--dim-empty" : ""} ${className}`}
      viewBox={`${-left} ${-top} ${width + left + right} ${height + top + bottom}`}
      preserveAspectRatio={fit === "cover" ? "xMidYMid slice" : undefined}
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      focusable="false"
    >
      <BoardMaterials ids={ids} />

      {slab ? (
        <>
          <rect
            className="board__plinth"
            x={-0.07}
            y={0.04}
            width={width + 0.14}
            height={height + 0.14}
            rx={radius + 0.07}
          />
          <rect
            x={0}
            y={0}
            width={width}
            height={height}
            rx={radius}
            fill={`url(#${ids.slab})`}
          />
          <rect
            x={0}
            y={0}
            width={width}
            height={height}
            rx={radius}
            fill={`url(#${ids.sheen})`}
          />

          <g className="board__grooves">
            {Array.from({ length: width }, (_, x) => (
              <line
                key={`gx-${x}`}
                x1={centre(x)}
                y1={0.5}
                x2={centre(x)}
                y2={height - 0.5}
              />
            ))}
            {Array.from({ length: height }, (_, y) => (
              <line
                key={`gy-${y}`}
                x1={0.5}
                y1={centre(y)}
                x2={width - 0.5}
                y2={centre(y)}
              />
            ))}
          </g>

          {indices.map((index) => {
            if (ownerAt(cells, index)) return null;
            const cx = centre(index % width);
            const cy = centre(Math.floor(index / width));
            if (blockedPoints.includes(index))
              return (
                <g key={index} className="board__blocked-point">
                  <circle cx={cx} cy={cy} r={POINT_RADIUS + 0.02} />
                  <path
                    d={`M ${cx - 0.12} ${cy - 0.12} l 0.24 0.24 M ${cx + 0.12} ${cy - 0.12} l -0.24 0.24`}
                  />
                </g>
              );
            const hint = hintAt.get(index);
            return (
              <g
                key={index}
                className={
                  hint
                    ? `board__point board__point--hint-${hint.strength} board__point--hint-${hint.owner}`
                    : "board__point"
                }
              >
                <circle
                  className="board__point-well"
                  cx={cx}
                  cy={cy + 0.025}
                  r={POINT_RADIUS + 0.045}
                />
                <circle
                  className="board__point-cap"
                  cx={cx}
                  cy={cy}
                  r={POINT_RADIUS}
                  fill={`url(#${ids.point})`}
                />
              </g>
            );
          })}
        </>
      ) : null}

      {history.map((square) => (
        <SquareBand
          key={`h-${square.key}`}
          corners={square.corners}
          owner={square.owner}
          fresh={false}
          opacity={square.opacity}
        />
      ))}

      {footprints.map((box) => (
        <rect
          key={box.key}
          className="board__footprint"
          x={box.x + 0.07}
          y={box.y + 0.07}
          width={Math.max(0, box.width - 0.14)}
          height={Math.max(0, box.height - 0.14)}
          rx={0.22}
        />
      ))}

      {fresh.map((square) => (
        <SquareBand
          key={`f-${square.key}`}
          corners={square.corners}
          owner={square.owner}
          fresh
        />
      ))}

      {indices.map((index) => {
        const owner = ownerAt(cells, index);
        if (!owner) return null;
        return (
          <PieceShape
            key={index}
            owner={owner}
            x={centre(index % width)}
            y={centre(Math.floor(index / width))}
            ids={ids}
            className={index === arrivingIndex ? "board__piece--arriving" : ""}
          />
        );
      })}

      {blocked.map((square) => (
        <polygon
          key={`b-${square.key}`}
          className={`board__blocked board__blocked--${square.owner}`}
          points={polygonPoints(square.corners)}
        />
      ))}

      {fresh.flatMap((square) =>
        square.corners.map((corner) => (
          <circle
            key={`flash-${square.key}-${corner.x}-${corner.y}`}
            className={`board__flash board__flash--${square.owner}`}
            cx={centre(corner.x)}
            cy={centre(corner.y)}
            r={PIECE_RADIUS}
          />
        )),
      )}

      {markers.map((marker) =>
        marker.kind === "ghost" ? (
          <PieceShape
            key={`ghost-${marker.x}-${marker.y}`}
            owner={marker.owner}
            x={centre(marker.x)}
            y={centre(marker.y)}
            ids={ids}
            className="board__piece--ghost"
          />
        ) : (
          <circle
            key={`${marker.kind}-${marker.x}-${marker.y}`}
            className={`board__marker board__marker--${marker.kind} board__marker--${marker.owner}`}
            cx={centre(marker.x)}
            cy={centre(marker.y)}
            r={0.49}
          />
        ),
      )}

      {children}
    </svg>
  );
}
