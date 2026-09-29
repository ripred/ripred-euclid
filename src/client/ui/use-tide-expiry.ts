import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { SerializableBoard } from "../../shared/types/api";
import { ownerAt, type Owner } from "./board-geometry";

export const TIDE_EXPIRY_MS = 220;

type ExpiredPiece = { index: number; owner: Owner };
type Snapshot = {
  width: number;
  height: number;
  cells: number[];
  tide: SerializableBoard["tide"];
  ply: number;
};

/** Keep only freshly expired pieces briefly visible over the confirmed board. */
export function useTideExpiry(
  width: number,
  height: number,
  cells: ArrayLike<number>,
  tide: SerializableBoard["tide"],
  ply: number,
) {
  const previous = useRef<Snapshot | null>(null);
  const [expired, setExpired] = useState<ExpiredPiece[]>([]);

  useLayoutEffect(() => {
    const before = previous.current;
    previous.current = {
      width,
      height,
      cells: Array.from(cells),
      tide: tide
        ? { expires: [...tide.expires], anchored: [...tide.anchored] }
        : undefined,
      ply,
    };
    if (!before) return;
    const sameBoard = before.width === width && before.height === height;
    if (
      sameBoard &&
      before.ply === ply &&
      Boolean(before.tide) === Boolean(tide) &&
      before.cells.every((owner, index) => owner === cells[index])
    )
      return;

    const advancing = sameBoard && ply > before.ply && ply <= before.ply + 2;
    setExpired(
      advancing && tide && before.tide
        ? before.cells.flatMap((_, index) => {
            const owner = ownerAt(before.cells, index);
            const expiry = before.tide!.expires[index] ?? 0;
            return owner &&
              !ownerAt(cells, index) &&
              !before.tide!.anchored[index] &&
              expiry > before.ply &&
              expiry <= ply
              ? [{ index, owner }]
              : [];
          })
        : [],
    );
  }, [cells, height, ply, tide, width]);

  useEffect(() => {
    if (!expired.length) return;
    const timer = window.setTimeout(() => setExpired([]), TIDE_EXPIRY_MS);
    return () => window.clearTimeout(timer);
  }, [expired]);

  return expired;
}
