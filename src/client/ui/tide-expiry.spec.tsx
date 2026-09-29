// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Board, Player } from "../../shared/game/engine";
import type { SerializableBoard } from "../../shared/types/api";
import { BoardDiagram } from "./BoardDiagram";
import { TIDE_EXPIRY_MS } from "./use-tide-expiry";

let root: Root | null;
let host: HTMLDivElement;

beforeEach(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root?.unmount());
  host.remove();
  vi.useRealTimers();
});

function recording(): SerializableBoard[] {
  const board = new Board(new Player(), new Player(), {
    variant: "tide",
    rng: () => 0,
  });
  const snapshot = () => JSON.parse(JSON.stringify(board)) as SerializableBoard;
  const snapshots = [snapshot()];
  for (let index = 0; index < 14; index++) {
    board.placePiece(
      board.pointAt(index % board.W, Math.floor(index / board.W)),
    );
    board.advanceTurn();
    snapshots.push(snapshot());
  }
  return snapshots;
}

async function render(board: SerializableBoard) {
  await act(async () => {
    root!.render(
      <BoardDiagram
        width={board.W}
        height={board.H}
        cells={board.m_board}
        tide={board.tide}
        ply={board.m_history.length}
      />,
    );
  });
}

async function advance(milliseconds: number) {
  await act(async () => vi.advanceTimersByTime(milliseconds));
}

function expiredPieces() {
  return host.querySelectorAll(".board__piece--expired");
}

function piecesAt(x: number, y: number) {
  return Array.from(
    host.querySelectorAll(
      `.board__piece-disc[cx="${x + 0.5}"][cy="${y + 0.5}"]`,
    ),
    (disc) => disc.closest(".board__piece")!,
  );
}

describe("Tide expiry animation", () => {
  it.each([1, 2])(
    "temporarily renders expired pieces after a confirmed %i-ply advance",
    async (plies) => {
      const snapshots = recording();
      await render(snapshots[11]!);
      expect(expiredPieces()).toHaveLength(0);

      const next = snapshots[11 + plies]!;
      await render(next);
      expect(expiredPieces()).toHaveLength(plies);
      expect(next.m_board[0]).toBe(0);
      expect(
        piecesAt(0, 0)[0]?.classList.contains("board__piece--expired"),
      ).toBe(true);
      expect(expiredPieces()[0]?.querySelector(".board__life")).toBeNull();

      await advance(TIDE_EXPIRY_MS - 1);
      expect(expiredPieces()).toHaveLength(plies);
      await advance(1);
      expect(expiredPieces()).toHaveLength(0);
      expect(piecesAt(0, 0)).toHaveLength(0);
    },
  );

  it("keeps the original removal deadline when the same ply rerenders", async () => {
    const snapshots = recording();
    await render(snapshots[11]!);
    await render(snapshots[12]!);
    await advance(TIDE_EXPIRY_MS / 2);

    await render(Board.fromJSON(snapshots[12]!).toJSON());
    expect(expiredPieces()).toHaveLength(1);
    await advance(TIDE_EXPIRY_MS / 2);
    expect(expiredPieces()).toHaveLength(0);
  });

  it.each([
    ["rewind", 11],
    ["reset", 0],
  ] as const)(
    "clears expired pieces and their timer on replay %s",
    async (_, ply) => {
      const snapshots = recording();
      await render(snapshots[11]!);
      await render(snapshots[12]!);
      expect(expiredPieces()).toHaveLength(1);

      await render(snapshots[ply]!);
      expect(expiredPieces()).toHaveLength(0);
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it("does not cover a reused point with its expired piece", async () => {
    const snapshots = recording();
    await render(snapshots[11]!);
    await render(snapshots[12]!);
    expect(piecesAt(0, 0)[0]?.classList.contains("board__piece--expired")).toBe(
      true,
    );

    const board = Board.fromJSON(snapshots[12]!);
    board.placePiece(board.pointAt(0, 0));
    board.advanceTurn();
    await render(board.toJSON());

    expect(piecesAt(0, 0)).toHaveLength(1);
    expect(piecesAt(0, 0)[0]?.classList.contains("board__piece--expired")).toBe(
      false,
    );
    expect(piecesAt(0, 0)[0]?.querySelector(".board__life")).not.toBeNull();
  });

  it("cleans up the pending removal timer on unmount", async () => {
    const snapshots = recording();
    await render(snapshots[11]!);
    await render(snapshots[12]!);
    expect(vi.getTimerCount()).toBe(1);

    await act(async () => root!.unmount());
    root = null;
    expect(vi.getTimerCount()).toBe(0);
  });
});
