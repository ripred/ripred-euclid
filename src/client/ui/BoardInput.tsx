import type { useBoardInput } from "./use-board-input";
import "./board-input.css";
export function BoardInput({
  width,
  height,
  cellSize,
  controls,
  label,
  describeCell,
  onHover,
}: {
  width: number;
  height: number;
  cellSize: number;
  controls: ReturnType<typeof useBoardInput>;
  label: string;
  describeCell: (index: number) => string;
  onHover?: ((index: number) => void) | undefined;
}) {
  return (
    <div
      ref={controls.gridRef}
      className="game__grid"
      role="grid"
      aria-label={label}
      onKeyDown={controls.onKeyDown}
      style={{
        gridTemplateColumns: `repeat(${width}, ${cellSize}px)`,
        gridAutoRows: `${cellSize}px`,
      }}
    >
      {Array.from({ length: height }, (_, y) => (
        <div key={y} role="row" className="game__row">
          {Array.from({ length: width }, (_, x) => {
            const index = y * width + x;
            const available = controls.enabled && controls.isOpen(index);
            return (
              <div
                key={x}
                role="gridcell"
                data-index={index}
                tabIndex={index === controls.safeFocus ? 0 : -1}
                aria-label={describeCell(index)}
                aria-disabled={!available}
                className={`game__cell${available ? " game__cell--open" : ""}`}
                onFocus={() => controls.setFocus(index)}
                onPointerDown={(e) => {
                  controls.pointerType.current = e.pointerType;
                }}
                onClick={() => controls.activate(index)}
                onPointerEnter={(e) => {
                  if (e.pointerType === "mouse") onHover?.(index);
                }}
              />
            );
          })}
        </div>
      ))}
    </div>
  );
}
