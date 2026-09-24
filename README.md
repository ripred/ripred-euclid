# Euclid / Weave

Weave trades the square grid for a triangular lattice. Claim points, find equilateral triangles at any angle, and connect them along shared edges. Terracotta circles and indigo diamonds identify the two players without relying on color alone.

This branch contains the Weave edition. The original Euclid release remains on `main` and at `v0.1.98`; this edition has not been uploaded or installed on Reddit.

## Play

The inline post shows a passive, fitted preview using the same lattice artwork. **Open Weave** opens the full game after a tap or click. The preview has no scrolling, point controls, game session, or spectator polling; its illustrative board is not your saved game. `preview.html` loads `edition-preview.tsx`, while `index.html` keeps the full `edition-main.tsx` game and its normal keyboard controls.

Choose **Begin a weave** or **New game**, then **Play Euclid** for a computer opponent or **Play a friend** to alternate turns on the same device. Both modes are unrated. A new game starts with all 28 points empty, and starting over requires confirmation.

- Terracotta moves first. Players alternate claiming one empty point; claims are permanent.
- A move scores every new equilateral triangle whose three corners belong to the mover. Tilted triangles count. Interior points and overlapping triangle interiors do not affect ownership or scoring.
- Score is area measured in smallest-triangle units: side length 1 scores 1, side length 2 scores 4, and side length 3 scores 9. Tilted triangles use the same squared-distance calculation.
- Each pair of your triangles sharing the same complete edge adds **2 link points**, once. A shared corner, partially shared edge, crossing, or overlapping area alone gives no link points. Two triangles completed together can form a link.
- The first player to reach **24** wins immediately. If all 28 points fill first, the higher score wins; equal scores tie. No opponent move follows a winning placement.

Use a pointer or touch to claim a point. Keyboard users can Tab to the lattice, explore with arrow keys, and claim with Enter or Space. Occupied points remain inspectable and announce their owner. Held keys and input from a pending turn do not submit another move. **How to play** explains the rules with area examples. Reduced-motion preferences suppress score and shape transitions.

## Design and implementation

The board is functional SVG geometry over a warm-paper layout, with thin serif typography and stitched triangle boundaries. Point controls are semantic HTML buttons with coordinate/ownership labels and a roving tab stop. All text, controls, points, and triangle fills are live interface elements, not a screenshot.

`src/shared/edition-game.ts` is the pure rules engine. It enumerates all equilateral triangles using exact integer triangular-lattice distances, scores completed shapes and unique shared-edge links, and determines terminal outcomes before changing the turn. Its deterministic computer opponent takes immediate wins, avoids available opponent wins, and weighs score, blocking, and future construction.

`src/client/edition/Weave.tsx` contains the game interface. The shared edition transport and server execute move intents against canonical state. Browser-side display changes do not change stored scores or claims. Local development sessions survive a browser reload while the development server remains running. Reddit-hosted sessions use an isolated Redis namespace. This edition does not use original Euclid ratings, collectible items, matchmaking, or result sharing.

## Live spectators

Games are private until their player enables **Allow spectators**. **Live games** lists available broadcasts for this edition; choose **Watch** to follow a server-confirmed board, scores, and result. The read-only view polls roughly once per second while the page is visible. **Back to my game** returns to your own saved game without changing either player's board.

Spectators can inspect points, triangles, and shared-edge scoring with the pointer or keyboard. They cannot claim points or start a game for the broadcaster. Starting a new game begins privately; stopping a broadcast revokes access to it. This does not add chat, online head-to-head matchmaking, or shared control of a board.

Local testing uses separate browser profiles, or one normal window and one private window, for separate cookie-based identities; its loopback server is not publicly reachable. Reddit broadcasts use the authenticated player's public username and are scoped to the current community and edition. Private account identifiers, command receipts, and owner-only hints are not exposed to spectators.

## Local development

Install the pinned dependencies with Node.js 24 and npm. From this branch:

```bash
npm install
npm run dev:vite -- --port 7483
```

Open [Weave locally](http://127.0.0.1:7483/). Keep the development server running while playing.

Quality checks:

```bash
npm run type-check
npm run lint
npx vitest run
npm run build
git diff --check
```

The Weave test suite includes an independent Euclidean geometry oracle, tilted and inverted triangles, complete-edge versus partial-edge links, simultaneous link completion, malformed and occupied moves, target and full-board outcomes, JSON round-tripping, tactical wins and blocks, and a complete deterministic computer game. Original Euclid regression tests remain alongside the edition tests.

This branch preserves the existing Devvit configuration and release version. Building locally does not deploy anything; publication, app registration, installation, and subreddit changes require a separate deliberate action.

## License

MIT. Copyright (c) 2025-2026 Trent M. Wyatt. See [LICENSE](LICENSE).
