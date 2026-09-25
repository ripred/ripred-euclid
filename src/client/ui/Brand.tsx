import { BoardDiagram } from "./BoardDiagram";
import { cellsFromPoints } from "./board-geometry";
import { MACRO_H, MARK_CELLS, MARK_SQUARES, tiledMacro } from "./brand-boards";
import "./brand.css";

/** The logo board alone, as SVG, for the app and for exported art. */
export function MarkDiagram() {
  return (
    <BoardDiagram
      width={3}
      height={3}
      cells={MARK_CELLS}
      squares={MARK_SQUARES}
    />
  );
}

export function BrandMark({ size = 40 }: { size?: number }) {
  return (
    <span className="brand-mark" style={{ width: size, height: size }}>
      <MarkDiagram />
    </span>
  );
}

/** Wordmark text stays a real heading; the mark beside it is decorative. */
export function Wordmark({
  as: Heading = "h1",
  id,
  size = "md",
}: {
  as?: "h1" | "h2" | "p";
  id?: string;
  size?: "sm" | "md" | "lg";
}) {
  return (
    <div className={`wordmark wordmark--${size}`}>
      <BrandMark size={size === "lg" ? 52 : size === "md" ? 40 : 30} />
      <Heading id={id} className="wordmark__text">
        Euclid
      </Heading>
    </div>
  );
}

/** The close-up alone, as SVG; `repeat` tiles it for wide art. */
export function MacroDiagram({ repeat = 1 }: { repeat?: number }) {
  const macro = tiledMacro(repeat);
  return (
    <BoardDiagram
      width={macro.width}
      height={MACRO_H}
      cells={macro.cells}
      squares={macro.squares}
      fit="cover"
    />
  );
}

export function BoardMacro({
  className = "",
  repeat = 1,
}: {
  className?: string;
  repeat?: number;
}) {
  return (
    <div className={`board-macro ${className}`} aria-hidden="true">
      <MacroDiagram repeat={repeat} />
    </div>
  );
}

/* Floating tokens that close a tilted square: the game's core idea as art. */
const CLUSTER_CORNERS = [
  { x: 1, y: 0 },
  { x: 3, y: 1 },
  { x: 2, y: 3 },
  { x: 0, y: 2 },
];

export function TokenCluster({
  owner,
  className = "",
}: {
  owner: 1 | 2;
  className?: string;
}) {
  return (
    <div className={`token-cluster ${className}`} aria-hidden="true">
      <BoardDiagram
        width={4}
        height={4}
        slab={false}
        cells={cellsFromPoints(
          4,
          4,
          CLUSTER_CORNERS.map((corner) => ({ ...corner, owner })),
        )}
        squares={[
          {
            key: "cluster",
            owner,
            tone: "history",
            corners: CLUSTER_CORNERS,
          },
        ]}
      />
    </div>
  );
}
