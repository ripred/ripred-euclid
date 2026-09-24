import {
  createPrism,
  PRISM_SQUARES,
  type PrismState,
} from "../../shared/edition-game";

/** The same illustrative board appears before play and in the inline post. */
export function makeExhibit(): PrismState {
  const game = createPrism();
  for (const index of [9, 16, 18, 25, 42, 58]) game.board[index] = 1;
  for (const index of [37, 44, 46, 53, 5, 23]) game.board[index] = 2;
  game.completed = PRISM_SQUARES.filter((square) =>
    square.corners.every((index) => game.board[index] === 1),
  ).map((square) => ({ ...square, owner: 1 }));
  game.completed.push(
    ...PRISM_SQUARES.filter((square) =>
      square.corners.every((index) => game.board[index] === 2),
    ).map((square) => ({ ...square, owner: 2 as const })),
  );
  return game;
}
