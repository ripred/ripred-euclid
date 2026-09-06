# Lattice · Euclid

A three-dimensional, unranked edition of Euclid on branch `redesign/lattice`. Rotate the lattice, inspect its layers, and claim eight corners to complete a cube. This branch does not change the tagged release or either installed Reddit community.

## Play

Choose a 3 × 3 × 3 or 4 × 4 × 4 lattice, then **Play Euclid** for a computer opponent or **Play together** for two players sharing one device.

The default **Builder** computer focuses on constructing its own cubes, making it easier to learn the three-dimensional goal. **Tactician** also blocks your plans and creates threats. Deliberate defensive play can produce a scoreless draw: eight-corner structures are easier to disrupt than the original four-corner squares. Computer style does not change scoring or affect same-device players.

Players alternate claiming one empty point. A cube scores when all eight corners belong to one player. Edges must have equal length and follow the lattice axes. Interior points do not matter; rectangular boxes do not count. All sizes count, and one move can complete several cubes:

| Edge length | Volume / points         |
| ----------- | ----------------------- |
| 1           | 1                       |
| 2           | 8                       |
| 3           | 27, on the 4-wide board |

Every cube scores once. When the lattice fills, the higher score wins; equal scores are a draw. There is no first-to target and no move after a terminal result.

**Foundation opening** gives each player four points on opposite faces of the lattice, but no completed cube or points. It makes the eight-corner goal easier to approach. **Empty lattice** starts without any claimed points. Both openings use identical scoring rules.

## Inspecting depth

- Drag to orbit; scroll or pinch to zoom. Isometric, Front, Top, Side, and Reset view restore useful camera positions.
- Z is height. The **Layer inspector** shows an exact X/Y cross-section at the selected Z. It exposes every point, including those hidden behind another point in 3D.
- Select a point in either view, check its X/Y/Z address, then choose **Place point**. Rotation, selection, and changing layers never place a point.
- **Isolate selected layer** hides other layers. Completed cubes use edges, never opaque faces; their edges can also be hidden.
- **Trace a possible cube** draws a dashed construction guide for a viable cube belonging to the current player. It is free to either player, not a collectible reward, and not a guaranteed winning strategy.
- The layer inspector remains fully playable if WebGL is unavailable or the graphics context is interrupted.

Keyboard: Tab moves between controls; arrows move between points in the inspector; Enter or Space selects. Page Up / Down changes layers. Tab to Place point to confirm. With the 3D view focused, arrows rotate, + / − zoom, and R resets. Held-key repeats never confirm a second move. Reduced-motion settings disable the selection pulse. Teal uses circles and Vermilion uses diamonds in the inspector and legend.

## Local development

The package remains at the preserved release baseline `0.1.98`, with Devvit `0.14.2`, React, Vite, TypeScript, and pinned Three.js `0.179.1`. New edition source is under `src/client/edition/`; `src/shared/edition-game.ts` owns the pure cube rules. Both HTML entrypoints launch Lattice on this branch.

```bash
npm install
npm run dev:vite -- --port 7482
```

Open `http://127.0.0.1:7482/`. The local Vite server implements the edition API and stores sessions in memory: reloading resumes the game while that server process is alive. Restarting the server resets local sessions. Restart it after changing engine or server code so the authoritative API loads the changes. Local games do not update Reddit ratings or leaderboards.

The Devvit edition API uses authenticated Reddit identity and Redis persistence. The browser sends only move intent plus the expected game/revision; the server validates ownership, turns, coordinates and terminal state, calculates cube scores, and selects the computer reply. Revision checks and command receipts reject stale requests and prevent duplicate moves. The original game's unrelated code remains in the branch, but is not exposed by Lattice's interface.

```bash
npm run type-check
npm run lint
npx vitest run
npm run build
git diff --check
```

Cube tests verify unique enumeration, geometric corner distances, all volumes, multiple cubes in one move, occupied/out-of-bounds rejection, foundation symmetry, immutable input, blocking, complete deterministic games, ties, and terminal move rejection. Shared session tests exercise command authority and retry behavior.

## Rendering and assets

The board is live WebGL geometry, not a bitmap. Custom vertex/fragment shaders shade the ceramic point nodes and selection rim. Cube edges, camera picking, resize handling, and graphics resource disposal are implemented in `lattice-scene.ts`. The two locally bundled variable fonts, DM Sans and Space Grotesk, include their original SIL Open Font License files under `src/client/public/fonts/`; the interface does not require an external font service.

Three.js includes its original MIT notice in `src/client/public/three-license.txt`; the build copies this notice alongside the distributed renderer.

Project code is licensed under MIT, copyright 2025–2026 Trent M. Wyatt. Third-party notices retain their original authors and terms. Established release artwork remains unchanged. Building is local only; upload, installation, publication, and Git pushes must be requested separately.
