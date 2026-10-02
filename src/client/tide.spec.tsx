import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Board, Player } from "../shared/game/engine";
import { TIDE_STONE_LIFETIME } from "../shared/game/rules";
import { BoardDiagram } from "./ui/BoardDiagram";
import { squareHints } from "./ui/board-geometry";
import { buildReplayFrames } from "./share-replay-model";
import { tidePieceDescription, tidePieceState } from "./tide";

describe("Tide board presentation", () => {
  const tide = { expires: [TIDE_STONE_LIFETIME, 0], anchored: [false, true] };
  it("counts down confirmed turns and keeps anchors permanent", () => {
    expect(tidePieceState(tide, 0, 1)?.turns).toBe(5);
    expect(tidePieceState(tide, 0, 10)?.turns).toBe(1);
    expect(tidePieceState(tide, 0, 11)?.turns).toBe(0);
    expect(tidePieceState(tide, 1, 50)).toMatchObject({
      anchored: true,
    });
    expect(tidePieceDescription(tide, 0, 10)).toBe(
      ", 1 personal turn remaining",
    );
    expect(tidePieceDescription(tide, 0, 11)).toBe(
      ", expires before its owner's next turn",
    );
    expect(tidePieceDescription(tide, 1, 50)).toBe(", anchored permanently");
  });
  it("keeps pieces opaque during their lifetime while shrinking only unanchored Tide rings", () => {
    const renderAt = (ply: number) =>
      renderToStaticMarkup(
        <BoardDiagram
          width={2}
          height={2}
          cells={[1, 2, 0, 0]}
          tide={tide}
          ply={ply}
        />,
      );
    const fresh = renderAt(1);
    const html = renderAt(11);
    const ringFraction = (markup: string) =>
      Number(markup.match(/stroke-dasharray="([^ ]+) 1"/)?.[1]);
    expect(ringFraction(fresh)).toBeCloseTo(11 / 12);
    expect(ringFraction(html)).toBeCloseTo(1 / 12);
    for (const markup of [fresh, html]) {
      const pieces = markup.match(/<g class="board__piece [^>]*>/g) ?? [];
      expect(pieces).toHaveLength(2);
      for (const piece of pieces) expect(piece).not.toMatch(/\bopacity(?:=|:)/);
    }
    expect(html).toContain('data-turns-left="0"');
    expect(html).toContain('data-anchored="true"');
    expect(html.match(/class="board__life"/g)).toHaveLength(1);
    expect(html).not.toContain('class="board__anchor"');
    const standard = renderToStaticMarkup(
      <BoardDiagram width={2} height={2} cells={[1, 2, 0, 0]} />,
    );
    expect(standard).not.toContain('class="board__life"');
    expect(standard).not.toContain('class="board__anchor"');
  });
});

function tideRecording(moves: number[]) {
  const board = new Board(new Player(), new Player(), {
    variant: "tide",
    W: 8,
    H: 8,
    rng: () => 0,
  });
  for (const index of moves) {
    board.placePiece(
      board.pointAt(index % board.W, Math.floor(index / board.W)),
    );
    board.advanceTurn();
  }
  return board.toJSON();
}

describe("Tide replay", () => {
  it("replays expiration and a later legal move on the same point", () => {
    const board = tideRecording([
      ...Array.from({ length: 12 }, (_, index) => index),
      0,
    ]);
    const frames = buildReplayFrames(board);
    expect(frames).toHaveLength(14);
    expect(frames[11]!.board[0]).toBe(1);
    expect(frames[12]!.board[0]).toBe(0);
    expect(frames[13]!.board[0]).toBe(1);
    expect(frames[13]!.tide).toEqual(board.tide);
  });
  it("retains completed square corners and final scores across the replay", () => {
    const board = tideRecording([
      0, 20, 1, 22, 8, 25, 9, 27, 2, 30, 3, 31, 4, 33,
    ]);
    const frames = buildReplayFrames(board);
    expect(frames).toHaveLength(15);
    expect(frames[7]!.tide?.anchored[0]).toBe(true);
    expect(frames.at(-1)!.board[0]).toBe(1);
    expect(frames.at(-1)!.scores).toEqual(
      board.m_players.map((player) => player.m_score),
    );
    expect(frames.at(-1)!.tide).toEqual(board.tide);
  });
});

it("omits hints whose existing pieces expire before the square can be finished", () => {
  const board = new Board(new Player(), new Player(), {
    W: 4,
    H: 4,
    variant: "tide",
    rng: () => 0,
  });
  board.m_board[0] = 1;
  board.m_board[1] = 1;
  board.tide!.expires[0] = 1;
  board.tide!.expires[1] = 12;
  const hints = () =>
    squareHints(board.m_board, board.W, board.H, 0, 1, (corners) =>
      board.canFinishTarget(corners, 1),
    );
  const farHint = { index: 4, owner: 1, strength: "far", points: [4] };
  expect(squareHints(board.m_board, board.W, board.H, 0, 1)).toContainEqual(
    farHint,
  );
  expect(hints()).not.toContainEqual(farHint);
  board.tide!.anchored[0] = true;
  expect(hints()).toContainEqual(farHint);
});
