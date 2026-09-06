# Relay · A Euclid game

Relay is a single-player geometric puzzle game with eight introductory levels and a generator for fresh challenges. Use a few points to complete several squares. There is no opponent, timer, purchase, or ranking.

## How to play

- Every starting point belongs to you. Select an empty point on the exact 6×6 board, then choose **Place point**.
- Complete at least the puzzle's required number of **new squares within the move budget**. Squares completed on different moves all count; their completion order does not change the result. The Squares left counter shows how many more are needed.
- Squares may have any size or orientation. Only the four corners matter; points inside or along an edge do not interfere.
- Early puzzles need one placement. Later puzzles allow setup placements and squares completed over several moves. Using fewer than the available placements is allowed.
- **Hint** is unlimited and uses no placements. It searches the current board, selects its suggested point, and displays an explanation beside the controls. Dashed outlines show squares that can be completed along the suggested route, not squares already earned. Choose **Place point** to confirm, or select a different point to override the hint.
- If no winning route fits the remaining placements, the controls immediately explain that **Undo** is needed. Asking for a hint repeats that advice rather than suggesting an unhelpful point.
- **Undo** is unlimited, including after completion or when placements run out. **Restart puzzle** restores its original points.
- The numbered collection introduces the rules. It collapses into **Introductory puzzles** after solving the final introduction or starting a generated puzzle; open it to revisit those boards and their saved checkmarks. Its solved count belongs only to that collection, not to generated play. **New puzzle** opens a generator with move budget, required squares, difficulty, and an optional seed. After the last introductory puzzle, the next button continues with generated puzzles. A generated puzzle's next button keeps its challenge settings and requests a fresh seed.
- Switching away from an unfinished attempt asks for confirmation. The generator warns before replacing an unfinished board; failed generation leaves that board intact.

Use Tab to reach the board, arrow keys to inspect neighboring points, and Enter or Space to place on the focused empty point. Held keys and pending input never queue placements. Pointer and touch controls use selection followed by confirmation. Reduced-motion preferences disable board effects.

Solved markers are stored on the current browser and can be cleared with browser site data. They are convenience markers, not official results. Undoing a solved attempt does not erase its solved marker.

## Generated puzzles

The generator supports **1–4 moves**, **1–4 required squares**, and three difficulty settings on the 6×6 board:

- **Beginner:** constructs aligned square patterns without extra starting points.
- **Standard:** mixes aligned and tilted patterns, adding up to one extra starting point.
- **Expert:** constructs patterns that include tilted squares, adding up to two extra starting points.

These settings guide construction, not a measured difficulty rating. Other valid solutions may use different square patterns. Extra points are accepted only when they introduce no completed starting square or shorter solution. Every returned puzzle has a verified solution whose minimum placement count matches the requested moves. Any order that completes the required total wins.

An optional seed of at most 80 characters reproduces the same board with the same settings and generator implementation. Leave it blank for a new server-generated seed. Restart reuses the current settings and seed; reloading resumes its accepted placements. Generated wins do not mark an introductory puzzle as solved. Different seeds can occasionally produce the same board; requesting one square in four moves necessarily produces the empty-board exercise.

The pure function is `generateRelayPuzzle({ moves, goal, difficulty, seed })` in `src/shared/relay-generator.ts`. It constructs new square families rather than selecting from the introductory fixtures. Search is bounded; invalid settings or exhausted generation attempts return a clear error, never a puzzle with a silently changed goal. Its internal solution witness is omitted from game snapshots. Clients receive only the puzzle definition and hints they request.

## Authority and persistence

The browser sends only a selected point or a hint/undo request with the expected game revision. The server owns the puzzle, placement history, move budget, hint calculation, square detection, and result. Undo rebuilds the board from its original points and accepted placements while keeping revisions increasing. Conflicting or stale commands are rejected, and repeated commands are idempotent.

The local Vite server stores isolated in-memory sessions identified by an HTTP-only cookie. Reloading resumes a puzzle while that server remains running. The Reddit handler uses a separate Redis namespace; this edition does not affect the original game's rankings, matches, or shared posts.

Game decisions, hints, level generation, and tests use local deterministic code without external inference services. The browser communicates with the game server for authoritative state; the published edition uses Reddit's hosting and storage.

## Live spectators

Puzzles are private until their player enables **Allow spectators**. **Live games** lists available broadcasts for this edition; choose **Watch** to follow a server-confirmed board, remaining moves, completed squares, and result. The read-only view polls roughly once per second while the page is visible. **Back to my game** returns to your own saved puzzle without changing either player's attempt.

Spectators can inspect points and completed squares, including generated puzzles. They cannot place points, request hints, undo, restart, or choose the broadcaster's next puzzle. Owner-only hints are not included in broadcasts, and watching a solved puzzle never awards a checkmark in the spectator's introductory collection. Starting a new puzzle begins privately; stopping a broadcast revokes access to it. This does not add chat, online head-to-head play, or shared control of a puzzle.

Local testing uses separate browser profiles, or one normal window and one private window, for separate cookie-based identities; its loopback server is not publicly reachable. Reddit broadcasts use the authenticated player's public username and are scoped to the current community and edition. Private account identifiers and command receipts are not exposed to spectators.

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

The puzzle engine and introductory fixtures are in `src/shared/edition-game.ts`. Shared board geometry and exact solution search are in `src/shared/relay-puzzle.ts`; seeded level generation is in `src/shared/relay-generator.ts`. Adjacent specs cover the rules and generated boards. Rendering and keyboard/touch interactions live in `src/client/edition/Relay.tsx`; visual styling is in its adjacent stylesheet. Shared session validation is in `src/shared/edition-session.ts`.

## License

MIT. Copyright (c) 2025-2026 Trent M. Wyatt. See [LICENSE](LICENSE).

The bundled Antonio typeface is by the Antonio Project Authors and distributed under the SIL Open Font License. Its original copyright and license are in `src/client/public/fonts/Antonio-OFL.txt`; the unmodified font comes from [Google Fonts](https://github.com/google/fonts/tree/main/ofl/antonio).
