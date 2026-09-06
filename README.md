# Tide

A Euclid game about building something that lasts. Place coral diamonds or teal rings on a six-by-six shore. Unfinished stones wash away; completed squares anchor their corners permanently.

This is the local `redesign/tide` edition, based on `v0.1.98`. The original tagged release and its artwork are unchanged. This branch has not been uploaded or installed on Reddit.

## Play

```bash
npm ci
npm run dev:vite -- --port 7484
```

Open [Tide locally](http://127.0.0.1:7484/). Choose **Against Undertow** for the deterministic computer opponent, or **Pass & play** for two people sharing a screen. The default goal is 60 points; New game also offers 40 and 90.

1. Select an empty intersection, then press **Place stone**. Cancel clears the preview without consuming a turn.
2. Four of your stones at the corners of any square score together. Tilted squares count, and one placement may complete several squares.
3. A stone lasts six personal turns, including the turn on which it was placed. If it has not become part of a square, it washes away before your seventh turn. Nothing expires while you are thinking. Its surrounding ring shows how many rounds remain.
4. Completing a square anchors all four corners before expiration is checked. Anchored stones have a center mark. Stones and points already anchored never wash away.
5. Reach the target first to win. If neither player reaches it after thirty rounds (sixty moves), or the board is full after expiration, the higher score wins. Equal scores are a draw. A finished board is frozen for inspection.

Square scoring uses Euclid's **Grid Footprint**: take the width of the square's enclosing axis-aligned box in grid positions, including both edges, and square it. A smallest upright square scores 4; a one-step diamond scores 9. Every newly completed square scores once.

Ownership is shown by shape as well as color. Arrow keys navigate the board; Enter or Space selects a point. Tab reaches the placement controls. Dialogs contain keyboard focus and Escape closes them. Reduced-motion preferences disable scoring animation. The responsive layout keeps scores, turn status, and placement controls together on a phone.

## State and trust

Both modes are unranked. These experimental games do not change the original game's ratings, inventory, matchmaking, or shared posts. Collectable items are not part of this edition.

The browser submits only an intent, a command identifier, and the revision it is displaying. The server validates coordinates, occupancy, turn, aging, new squares, points, and the winner. A solo transaction applies the human move and, only if the game is still active, Undertow's reply. Repeated commands are idempotent; stale tabs are rejected and reconciled. There is no queued move input. Losing a response triggers a reload of confirmed state, never an automatic replay of the move.

Locally, the Vite server owns game state in memory under an HttpOnly, same-site browser cookie. Reloading the page resumes a game while that server process is running. Restarting the local server clears its games. Separate browser profiles have separate games. **Restart Vite after changing server-side rules**: hot-reloaded presentation must not be compared with an older rules module still loaded by the local server.

The packaged Devvit route uses the signed-in Reddit identity and Redis compare-and-set transactions in its own versioned Tide namespace. Actual Reddit deployment and verification are separate steps. Both HTML entrypoints load Tide. Deployment commands retain the original application ID: do not upload this branch over the established release without deliberately choosing to replace that application.

## Live spectators

Games are private until their player enables **Allow spectators**. **Live games** lists available broadcasts for this edition; choose **Watch** to follow a server-confirmed board, scores, and result. The read-only view polls roughly once per second while the page is visible. **Back to my game** returns to your own saved game without changing either player's board.

Spectators can inspect stones, their remaining turns, anchored corners, and completed squares, but cannot place stones or start a game for the broadcaster. Expiration follows accepted moves, not the spectator's clock: watching cannot age a stone. Starting a new game begins privately; stopping a broadcast revokes access to it. This does not add chat, online head-to-head matchmaking, or shared control of a board.

Local testing uses separate browser profiles, or one normal window and one private window, for separate cookie-based identities; its loopback server is not publicly reachable. Reddit broadcasts use the authenticated player's public username and are scoped to the current community and edition. Private account identifiers, command receipts, and owner-only hints are not exposed to spectators.

## Implementation

- `src/shared/edition-geometry.ts`: exact integer-square enumeration and footprint scoring.
- `src/shared/edition-game.ts`: immutable Tide transitions, expiration, anchoring, and deterministic opponent.
- `src/shared/edition-session.ts`: common command/revision validation and atomic solo reply.
- `src/client/edition/Tide.tsx`: semantic point controls, native SVG board, feedback, and dialogs.
- `src/client/edition/use-edition.ts`: single-flight requests and reconciliation.
- `src/client/vite.config.ts`: loopback-only local server and production client build.
- `src/server/edition.ts`: authenticated Redis-backed game endpoints.

The board, stones, age rings, and square fills are code-native geometry. No external fonts, images, or rendering services are needed. The original release source remains available in this branch for its server integrations and regression tests; it is not the active edition entrypoint.

## Verify

Node.js 24 and npm are required. Run the non-mutating quality gate:

```bash
npm run type-check
npm run lint
npx vitest run
npm run build
git diff --check
```

Tests include an independent exhaustive square oracle, tilted and simultaneous squares, exact expiration boundaries, anchor-before-expiration ordering, immutable state, malformed or forged inputs, immediate wins and blocks, deterministic complete games, stale commands, and terminal-state rejection.

Copyright attribution and licensing remain in [LICENSE](LICENSE).
