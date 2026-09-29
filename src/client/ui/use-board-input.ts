import {
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type RefObject,
} from "react";
import { shouldPlaceFromKey } from "../game-ui";

interface InputOptions {
  width: number;
  height: number;
  cellSize: number;
  enabled: boolean;
  revision: number | string;
  gridRef: RefObject<HTMLDivElement | null>;
  isOpen: (index: number) => boolean;
  onPlace: (index: number) => void;
  acceptKey?: ((event: KeyboardEvent) => boolean) | undefined;
}

/** Shared fresh-key, roving-focus, and small-touch-target placement policy. */
export function useBoardInput(options: InputOptions) {
  const {
    width,
    height,
    cellSize,
    enabled,
    revision,
    gridRef,
    isOpen,
    onPlace,
    acceptKey,
  } = options;
  const [focus, setFocus] = useState(
    () => Math.floor(height / 2) * width + Math.floor(width / 2),
  );
  const [aim, setAim] = useState<{
    index: number;
    revision: number | string;
  } | null>(null);
  const pointerType = useRef("mouse");
  const since = useRef(Infinity);
  useLayoutEffect(() => {
    since.current = enabled ? performance.now() : Infinity;
  }, [enabled, revision]);
  const aimIndex =
    enabled && aim !== null && aim.revision === revision && isOpen(aim.index)
      ? aim.index
      : null;
  const safeFocus = Math.min(focus, width * height - 1);
  const activate = (index: number) => {
    if (!enabled || !isOpen(index)) return;
    if (
      pointerType.current !== "mouse" &&
      cellSize < 38 &&
      aimIndex !== index
    ) {
      setAim({ index, revision });
      return;
    }
    setAim(null);
    onPlace(index);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const index = Number(
      (event.target as HTMLElement).dataset.index ?? safeFocus,
    );
    const x = index % width,
      y = Math.floor(index / width);
    const steps: Record<string, [number, number]> = {
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
      ArrowUp: [0, -1],
      ArrowDown: [0, 1],
    };
    const step = steps[event.key];
    if (step || event.key === "Home" || event.key === "End") {
      event.preventDefault();
      const target = step
        ? Math.max(0, Math.min(height - 1, y + step[1])) * width +
          Math.max(0, Math.min(width - 1, x + step[0]))
        : y * width + (event.key === "Home" ? 0 : width - 1);
      setFocus(target);
      gridRef.current
        ?.querySelector<HTMLElement>(`[data-index="${target}"]`)
        ?.focus();
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      if (
        shouldPlaceFromKey(event.nativeEvent, since.current, enabled) &&
        isOpen(index) &&
        (!acceptKey || acceptKey(event))
      ) {
        setAim(null);
        onPlace(index);
      }
    }
  };
  return {
    gridRef,
    aimIndex,
    safeFocus,
    setFocus,
    pointerType,
    activate,
    onKeyDown,
    isOpen,
    enabled,
  };
}
