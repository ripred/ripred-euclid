# Relay · A Euclid game

Relay is a single-player collection of eight geometric puzzles. Prepare a few points, then complete several squares with one shared final corner. There is no opponent, timer, purchase, or ranking.

## How to play

- Every starting point belongs to you. Select an empty point on the exact 6×6 board, then choose **Place point**.
- Complete at least the puzzle's required number of **new squares on one move**, within its placement budget. Squares completed on separate moves do not add up to the goal.
- Squares may have any size or orientation. Only the four corners matter; points inside or along an edge do not interfere.
- Early puzzles need one placement. Later puzzles allow setup placements before the shared finish. Using fewer than the available placements is allowed.
- **Hint** is unlimited and uses no placements. It searches the actual current board, suggests a setup or finishing point, and says to undo when no winning sequence fits the remaining budget.
- **Undo** is unlimited, including after completion or when placements run out. **Restart puzzle** restores its original points.
- Every puzzle is available from the numbered collection. Switching away from an unfinished attempt asks for confirmation.

Use Tab to reach the board, arrow keys to inspect neighboring points, and Enter or Space to place on the focused empty point. Held keys and pending input never queue placements. Pointer and touch controls use selection followed by confirmation. Reduced-motion preferences disable board effects.

Solved markers are stored on the current browser and can be cleared with browser site data. They are convenience markers, not official results. Undoing a solved attempt does not erase its solved marker.

## Authority and persistence

The browser sends only a selected point or a hint/undo request with the expected game revision. The server owns the puzzle, placement history, move budget, hint calculation, square detection, and result. Undo rebuilds the board from its original points and accepted placements while keeping revisions increasing. Conflicting or stale commands are rejected, and repeated commands are idempotent.

The local Vite server stores isolated in-memory sessions identified by an HTTP-only cookie. Reloading resumes a puzzle while that server remains running. The Reddit handler uses a separate Redis namespace; this edition does not affect the original game's rankings, matches, or shared posts.

## Development

This branch is `redesign/relay`. Both `index.html` and `preview.html` launch Relay. The existing Devvit packaging and original game modules remain available, but the edition entrypoints do not render those modules.

Use Node.js 24 and the pinned dependencies:

```bash
npm install
npm run dev:vite -- --port 7485
```

Open [Relay locally](http://localhost:7485/). Run the non-mutating verification gate:

```bash
npm run type-check
npm run lint
npx vitest run
npm run build
git diff --check
```

`npm run check` also changes files by formatting and applying lint fixes. Build output is generated under `dist/`. A build is not a deployment; external upload, install, or publication must be requested separately.

The pure puzzle engine, eight fixtures, state-aware solver, and regression tests are in `src/shared/edition-game.ts` and its adjacent spec. Rendering and keyboard/touch interactions live in `src/client/edition/Relay.tsx`; visual styling is in its adjacent stylesheet. Shared session validation is in `src/shared/edition-session.ts`.

## License

MIT. Copyright (c) 2025-2026 Trent M. Wyatt. See [LICENSE](LICENSE).

The bundled Antonio typeface is by the Antonio Project Authors and distributed under the SIL Open Font License. Its original copyright and license are in `src/client/public/fonts/Antonio-OFL.txt`; the unmodified font comes from [Google Fonts](https://github.com/google/fonts/tree/main/ofl/antonio).
