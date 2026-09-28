import { useEffect, useRef, useState } from "react";
import type { ChallengePuzzle } from "../../shared/challenge";
import { squareCatalog } from "../../shared/game/geometry";
import { BoardDiagram } from "./BoardDiagram";
import { BoardInput } from "./BoardInput";
import { useBoardInput } from "./use-board-input";
import {
  BOARD_BLEED,
  pointLabel,
  type BoardSquareShape,
} from "./board-geometry";
import "../challenge-screen.css";

/** Shared accessible board for the moderator editor and public competitions. */
export function ChallengeBoard({
  puzzle,
  placements = [],
  completedSquares = [],
  blockedPoints,
  revision,
  enabled,
  onPlace,
  editing = false,
  label = "Challenge board, 8 by 8",
}: {
  puzzle: ChallengePuzzle | null;
  placements?: readonly number[];
  completedSquares?: readonly string[];
  blockedPoints?: readonly number[];
  revision: string;
  enabled: boolean;
  onPlace: (point: number) => void;
  editing?: boolean;
  label?: string;
}) {
  const [width, setWidth] = useState(480);
  const container = useRef<HTMLDivElement>(null);
  const grid = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = container.current;
    if (!element) return;
    const observer = new ResizeObserver((entries) => {
      if (entries[0]) setWidth(entries[0].contentRect.width);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const blocked = blockedPoints ?? puzzle?.blocked ?? [];
  const cells = Array<number>(64).fill(0);
  if (!editing && puzzle)
    for (const point of [...puzzle.initial, ...placements]) cells[point] = 1;
  const cellSize = Math.max(
    16,
    Math.min(68, Math.floor(Math.max(0, width - 20) / 8)),
  );
  const squares: BoardSquareShape[] = editing
    ? []
    : squareCatalog(8)
        .filter((square) => completedSquares.includes(square.id))
        .map((square) => ({
          key: square.id,
          owner: 1,
          tone: "history",
          corners: square.corners.map((point) => ({
            x: point % 8,
            y: Math.floor(point / 8),
          })),
        }));
  const input = useBoardInput({
    width: 8,
    height: 8,
    cellSize,
    gridRef: grid,
    enabled,
    revision,
    isOpen: (point) =>
      editing || (cells[point] === 0 && !blocked.includes(point)),
    onPlace,
  });
  const coordinates = (point: number) =>
    pointLabel(point % 8, Math.floor(point / 8));
  return (
    <>
      <div ref={container} className="challenge-board-container">
        <div
          className="challenge-board"
          style={{ width: cellSize * 8, height: cellSize * 8 }}
        >
          <div
            className="challenge-board-art"
            style={{
              left: -BOARD_BLEED.left * cellSize,
              top: -BOARD_BLEED.top * cellSize,
              right: -BOARD_BLEED.right * cellSize,
              bottom: -BOARD_BLEED.bottom * cellSize,
            }}
          >
            <BoardDiagram
              width={8}
              height={8}
              cells={cells}
              squares={squares}
              blockedPoints={[...blocked]}
              markers={
                input.aimIndex !== null && !editing
                  ? [
                      {
                        x: input.aimIndex % 8,
                        y: Math.floor(input.aimIndex / 8),
                        owner: 1,
                        kind: "pending",
                      },
                    ]
                  : []
              }
              arrivingIndex={editing ? null : (placements.at(-1) ?? null)}
            />
          </div>
          <BoardInput
            width={8}
            height={8}
            cellSize={cellSize}
            controls={input}
            label={label}
            describeCell={(point) =>
              `${coordinates(point)}, ${blocked.includes(point) ? "blocked" : cells[point] ? "occupied" : "empty"}${editing ? ", activate to toggle block" : ""}`
            }
          />
        </div>
      </div>
      {input.aimIndex !== null && (
        <p className="field__hint">
          Tap {coordinates(input.aimIndex)} again to{" "}
          {editing ? "toggle its block" : "place"}.
        </p>
      )}
    </>
  );
}
