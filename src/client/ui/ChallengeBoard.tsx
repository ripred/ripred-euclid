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
  fitToSpace = false,
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
  fitToSpace?: boolean;
  label?: string;
}) {
  const [space, setSpace] = useState({ width: 480, height: 0 });
  const container = useRef<HTMLDivElement>(null);
  const grid = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = container.current;
    if (!element) return;
    const observer = new ResizeObserver((entries) => {
      const bounds = entries[0]?.contentRect;
      if (!bounds) return;
      const next = { width: bounds.width, height: bounds.height ?? 0 };
      setSpace((current) =>
        current.width === next.width && current.height === next.height
          ? current
          : next,
      );
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [fitToSpace]);
  const blocked = blockedPoints ?? puzzle?.blocked ?? [];
  const cells = Array<number>(64).fill(0);
  if (!editing && puzzle)
    for (const point of [...puzzle.initial, ...placements]) cells[point] = 1;
  const cellSize = fitToSpace
    ? Math.max(
        0,
        Math.min(
          68,
          Math.floor(
            Math.min(
              space.width / (8 + BOARD_BLEED.left + BOARD_BLEED.right),
              space.height / (8 + BOARD_BLEED.top + BOARD_BLEED.bottom),
            ),
          ),
        ),
      )
    : Math.max(16, Math.min(68, Math.floor(Math.max(0, space.width - 20) / 8)));
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
  const board = (
    <div
      ref={container}
      className={`challenge-board-container${fitToSpace ? " challenge-board-container--fit" : ""}`}
    >
      <div
        className="challenge-board"
        style={{
          width: cellSize * 8,
          height: cellSize * 8,
          ...(fitToSpace
            ? {
                margin: `${BOARD_BLEED.top * cellSize}px ${BOARD_BLEED.right * cellSize}px ${BOARD_BLEED.bottom * cellSize}px ${BOARD_BLEED.left * cellSize}px`,
              }
            : {}),
        }}
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
  );
  const hint = (
    <p
      className={`field__hint${fitToSpace ? " challenge-board-fit__hint" : ""}`}
      style={{ visibility: input.aimIndex === null ? "hidden" : "visible" }}
      aria-hidden={input.aimIndex === null}
    >
      Tap {coordinates(input.aimIndex ?? 0)} again to{" "}
      {editing ? "toggle its block" : "place"}.
    </p>
  );
  return fitToSpace ? (
    <div className="challenge-board-fit">
      {board}
      {hint}
    </div>
  ) : (
    <>
      {board}
      {input.aimIndex !== null && hint}
    </>
  );
}
