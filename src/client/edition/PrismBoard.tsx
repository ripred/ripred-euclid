import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { coordinate, type PrismState } from "../../shared/edition-game";
import { createPrismRenderer, type PrismRenderer } from "./prism-renderer";
import { nearestProjectedPoint, type ProjectedPoint } from "./prism-projection";

interface BoardProps {
  game: PrismState;
  active: boolean;
  readOnly?: boolean;
  flat: boolean;
  onMove(index: number): void;
}

function fallbackPoints(): ProjectedPoint[] {
  return Array.from({ length: 64 }, (_, index) => ({
    x: 12 + ((index % 8) * 76) / 7,
    y: 12 + (Math.floor(index / 8) * 76) / 7,
  }));
}

/** Every rendered point has a native, projected button: no inaccessible canvas-only input. */
export function PrismBoard({
  game,
  active: mayPlay,
  readOnly = false,
  flat,
  onMove,
}: BoardProps) {
  const active = mayPlay && !readOnly;
  const boardRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<PrismRenderer | null>(null);
  const buttonsRef = useRef<(HTMLButtonElement | null)[]>([]);
  const [points, setPoints] = useState(fallbackPoints);
  const [fallback, setFallback] = useState(false);
  const [focused, setFocused] = useState(27);
  const [hovered, setHovered] = useState(-1);

  function pointerPoint(clientX: number, clientY: number): number {
    const bounds = boardRef.current?.getBoundingClientRect();
    return bounds
      ? nearestProjectedPoint(points, clientX, clientY, bounds)
      : -1;
  }

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    try {
      rendererRef.current = createPrismRenderer(canvas, setPoints, () => {
        rendererRef.current?.dispose();
        rendererRef.current = null;
        setPoints(fallbackPoints());
        setFallback(true);
      });
    } catch {
      setFallback(true);
      setPoints(fallbackPoints());
    }
    return () => {
      rendererRef.current?.dispose();
      rendererRef.current = null;
    };
  }, []);
  useEffect(() => {
    rendererRef.current?.state(game);
  }, [game]);
  useEffect(() => {
    rendererRef.current?.flat(flat);
  }, [flat]);
  useEffect(() => {
    rendererRef.current?.hover(active ? hovered : -1);
  }, [hovered, active, game]);

  function keyDown(
    event: KeyboardEvent<HTMLButtonElement>,
    index: number,
  ): void {
    const offsets: Record<string, number> = {
      ArrowLeft: -1,
      ArrowRight: 1,
      ArrowUp: -8,
      ArrowDown: 8,
    };
    const offset = offsets[event.key];
    if (offset !== undefined) {
      event.preventDefault();
      const x = Math.max(
        0,
        Math.min(7, (index % 8) + (Math.abs(offset) === 1 ? offset : 0)),
      );
      const y = Math.max(
        0,
        Math.min(
          7,
          Math.floor(index / 8) + (Math.abs(offset) === 8 ? offset / 8 : 0),
        ),
      );
      const next = y * 8 + x;
      setFocused(next);
      buttonsRef.current[next]?.focus();
      return;
    }
    // Key repeats and keys held through the opponent's turn never become moves.
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      if (!event.repeat && active && game.board[index] === 0) onMove(index);
    }
  }

  return (
    <div
      ref={boardRef}
      className={`prism-board ${fallback ? "is-fallback" : ""}`}
    >
      <canvas ref={canvasRef} aria-hidden="true" />
      {fallback && (
        <svg
          className="fallback-board"
          viewBox="0 0 100 100"
          aria-hidden="true"
        >
          <rect
            x="5"
            y="5"
            width="90"
            height="90"
            rx="1.5"
            fill="#20332c"
            stroke="#92a595"
            strokeWidth="0.25"
          />
          {game.completed.map((square) => (
            <polygon
              key={square.id}
              points={square.corners
                .map((index) => `${points[index]!.x},${points[index]!.y}`)
                .join(" ")}
              fill={square.owner === 1 ? "#ef8b78" : "#a8e0c0"}
              fillOpacity="0.13"
              stroke={square.owner === 1 ? "#ef8b78" : "#a8e0c0"}
              strokeWidth="0.22"
            />
          ))}
          {game.board.map((owner, index) => {
            const point = points[index]!;
            return owner === 1 ? (
              <path
                key={index}
                d={`M${point.x},${point.y - 1.15}l1.15,1.15 -1.15,1.15 -1.15,-1.15z`}
                fill="#ef8b78"
              />
            ) : (
              <circle
                key={index}
                cx={point.x}
                cy={point.y}
                r={owner === 2 ? 1 : 0.42}
                fill={owner === 2 ? "none" : "#e5e8d6"}
                stroke={owner === 2 ? "#a8e0c0" : "none"}
                strokeWidth="0.35"
              />
            );
          })}
        </svg>
      )}
      <div
        className="board-controls"
        role="group"
        aria-label={
          readOnly
            ? "Eight by eight point board. Arrow keys inspect points. Read-only."
            : "Eight by eight point board. Arrow keys move focus; Enter or Space claims a point."
        }
      >
        {game.board.map((owner, index) => (
          <button
            key={index}
            ref={(element) => {
              buttonsRef.current[index] = element;
            }}
            className={`point-target owner-${owner}`}
            style={{
              left: `${points[index]!.x}%`,
              top: `${points[index]!.y}%`,
            }}
            type="button"
            tabIndex={(active || readOnly) && index === focused ? 0 : -1}
            aria-label={`${coordinate(index)}, ${owner === 0 ? "empty" : owner === 1 ? "coral diamond" : "mint ring"}`}
            aria-disabled={!active || owner !== 0}
            onFocus={() => {
              setFocused(index);
              setHovered(index);
            }}
            onBlur={() => setHovered(-1)}
            onMouseEnter={(event) =>
              setHovered(pointerPoint(event.clientX, event.clientY))
            }
            onMouseMove={(event) =>
              setHovered(pointerPoint(event.clientX, event.clientY))
            }
            onMouseLeave={() => setHovered(-1)}
            onKeyDown={(event) => keyDown(event, index)}
            onClick={(event) => {
              // Keyboard and assistive activation target an explicit point;
              // pointer input follows visible proximity where hit areas overlap.
              const selected =
                event.detail === 0
                  ? index
                  : pointerPoint(event.clientX, event.clientY);
              if (active && selected >= 0 && game.board[selected] === 0) {
                setFocused(selected);
                buttonsRef.current[selected]?.focus({ preventScroll: true });
                onMove(selected);
              }
            }}
          >
            <span>{coordinate(index)}</span>
          </button>
        ))}
      </div>
      {fallback && (
        <p className="fallback-note">Flat rendering · WebGL unavailable</p>
      )}
    </div>
  );
}
