# PRISM · Euclid

PRISM is a playable, unranked edition of Euclid on branch `redesign/prism`. It preserves the 8 × 8 square-completion game and presents the board as a lit glass object: sculpted coral diamonds, mint rings, translucent captured squares, and custom material shaders.

The tagged `v0.1.98` release and `main` retain the original game and artwork. This branch is not deployed to either subreddit. It does not alter competitive ratings, matchmaking, collectables, or existing game sessions.

## Play locally

```sh
npm ci --ignore-scripts
npm run dev:vite -- --port 7481
```

Open <http://127.0.0.1:7481/>. Choose **Against Euclid** for a computer opponent or **Pass & play** for two people at the same device. The default target is 150; a short game ends at 75. Both `index.html` and `preview.html` launch this edition.

The local server owns the board in memory, identified by an HttpOnly browser cookie. Reload resumes play while that server remains running. A server restart or a day of inactivity ends the local session. The server binds to loopback only; it is not a hosted multiplayer service. When deployed through Devvit, the edition route instead uses authenticated Reddit identity and a separate Redis namespace.

## Rules

Players alternate claiming one empty point. Own the four corners of a square, at any angle, to score it. Points inside or along its edges do not prevent completion. One placement may complete multiple squares; all of them score, once each.

Scoring uses the existing **Grid Footprint** rule: find the smallest upright box around the square, count the inclusive grid spots along its larger dimension, and square that number. A 3 × 3 footprint is worth 9 points. The smallest adjacent square is worth 4. The lattice contains 336 distinct squares, including tilted squares.

The first player to reach the target wins immediately. The opponent does not get another move. If the board fills first, higher score wins; equal scores draw.

Euclid's deterministic opponent takes an immediate win, avoids an immediate loss where possible, compares scoring and blocking opportunities, and builds unblocked squares. It is a new tactical policy for this edition, not the original engine's difficulty ladder.

## Controls and accessibility

- Click or tap an empty point to claim it.
- Where tilted points are close together, a click or tap chooses the nearest visible point.
- Tab to the board, use arrow keys to explore points, and press Enter or Space to claim the focused point. Coordinates and ownership are announced to assistive technology.
- Coral has diamond-shaped pieces; Mint has rings. Ownership does not rely on colour alone.
- **Tilt view** and **Flat view** change only presentation, not rules or point coordinates.
- **How to play** explains scoring with two geometric examples.
- **New game** asks for confirmation before replacing an unfinished board.

Move inputs are never queued. The interface rejects repeated held activation keys, same-frame duplicate clicks, input during pending moves, and all moves after a terminal result. Dialogs contain focus and close with Escape.

The renderer caps pixel density, responds to resizing, stops animation while the page is hidden, honours reduced-motion preferences, and disposes graphics resources on exit. If WebGL 2 is unavailable or the graphics context is lost, a labelled, fully playable flat board replaces it. Fonts are bundled locally; there are no external font requests.

## Live spectators

Games are private until their player enables **Allow spectators**. **Live games** lists available broadcasts for this edition; choose **Watch** to follow a server-confirmed board, scores, and result. The read-only view polls roughly once per second while the page is visible. **Back to my game** returns to your own saved game without changing either player's board.

Spectators can switch between Tilt and Flat views and inspect point coordinates and ownership with the keyboard. They cannot claim points or start a game for the broadcaster. Starting a new game begins privately; stopping a broadcast revokes access to it. This does not add chat, online head-to-head matchmaking, or shared control of a board.

Local testing uses separate browser profiles, or one normal window and one private window, for separate cookie-based identities; its loopback server is not publicly reachable. Reddit broadcasts use the authenticated player's public username and are scoped to the current community and edition. Private account identifiers, command receipts, and owner-only hints are not exposed to spectators.

## Implementation

- `src/shared/edition-game.ts` owns the immutable serializable game state, complete square catalogue, scoring, validation, and opponent policy. The original shared scoring function is reused.
- `src/client/edition/Prism.tsx` composes the game screen, scores, start/restart flow, and rules.
- `src/client/edition/PrismBoard.tsx` projects native interactive point controls onto the rendered board and provides a vector fallback.
- `src/client/edition/prism-renderer.ts` owns the Three.js scene, lighting, glass and square shaders, cameras, motion, and resource lifecycle.
- `src/client/edition/use-edition.ts` submits revision-bound intents and reconciles failed responses without replaying a move.
- `src/shared/edition-session.ts` applies each human move and any permitted computer reply in one authoritative transaction.
- `src/server/edition.ts` persists authenticated Devvit games through Redis compare-and-set. `src/client/vite.config.ts` supplies the local-only authority.

The browser never supplies an accepted score, winning result, computer move, or final board. Rules are shared for clarity; server validation remains the trust boundary. Duplicate commands are idempotent, stale revisions are rejected, and a winning placement is resolved before any computer reply.

The original application source remains available on this branch for comparison, but the two client entrypoints render PRISM. Runtime geometry and optical effects are rendered directly, not represented by a background screenshot.

## Verification

```sh
npm run type-check
npm run lint
npm exec vitest run
npm run build
```

The edition tests cover catalogue completeness against the original score function, rotated squares, multiple completions, invalid actions, terminal ordering, scoring/blocking priorities, draw handling, and complete deterministic play. Shared session tests cover authoritative command handling, duplicate and stale intents, and no computer move after a win.

Application version remains `0.1.98`; the branch name identifies this independent redesign. Devvit is pinned to `0.14.2`, Three.js to `0.185.1`. No upload or publication is required for local play.

Copyright attribution and licensing remain in [LICENSE](LICENSE).

Bundled third-party notices are shipped in `src/client/public/notices/` and copied unchanged into production builds: Cormorant Garamond and DM Sans under the SIL Open Font License, and Three.js under the MIT License.
