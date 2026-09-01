# Euclid

Euclid is a turn-based Reddit strategy game about claiming grid points and completing squares. Play a fixed competitive match against Euclid, configure an unranked Practice game, challenge another Redditor, or watch a live human match.

[Open the configured test community](https://www.reddit.com/r/ripred_euclid_dev/)

![Euclid game](Euclid-Game2.png)

The current app version is `0.1.92` and the project is pinned to Devvit `0.14.2`.

## Game rules

Players alternate placing one dot on an empty grid position. A placement scores every new square whose four corners are dots owned by that player. Squares may be axis-aligned or rotated, and one move may complete several squares.

The game supports two scoring systems:

- **Grid Footprint** counts the inclusive grid positions along the larger axis of the square's smallest axis-aligned enclosure, then squares that count. For corners with coordinate bounds `minX`, `maxX`, `minY`, and `maxY`, points are `max(maxX - minX + 1, maxY - minY + 1)²`. Corner order and mirrored or quarter-turned orientation do not change the result.
- **True Area** scores the square's geometric area. On the integer grid this is the squared distance between adjacent corners, found as the smallest non-zero pairwise squared corner distance.

The first player to reach the target wins. If the board fills first, the higher score wins; equal scores produce a tie. Practice target recommendations scale from the 8×8, first-to-150 baseline, stay above the smallest scoring event, and never exceed the board's theoretical total.

## Game modes

| Mode                 | Rules                                                                                   | Rating          | Persistence and assistance                                                                                 |
| -------------------- | --------------------------------------------------------------------------------------- | --------------- | ---------------------------------------------------------------------------------------------------------- |
| Ranked vs Euclid     | 8×8, Grid Footprint, first to 150, human first, Brutal                                  | Ranked solo Elo | One active game per user; reload resumes it; assistance is disabled                                        |
| Practice vs Euclid   | Even dimensions from 4 through 16, either scoring mode, supported target and difficulty | Unrated         | Server-authoritative custom game; hints and local auto-move tools are allowed                              |
| Redditor vs Redditor | 8×8, Grid Footprint, first to 150                                                       | Multiplayer Elo | Matchmaking, reload resume, leave/forfeit, and read-only spectating; chat/rematch UI blockers remain below |

Canceling Ranked before the first human move is unrated. Abandoning after play begins records one loss. Ending Practice never changes Ranked Elo.

Ranked solo Elo starts at 1200 and uses K=32 against Euclid's fixed 1600 reference rating.

Euclid has nine difficulty levels. Brutal prioritizes its own immediate win, then prevents an opponent's immediate win, compares immediate offensive and defensive value, and finally pursues longer-term square construction.

## Authority and integrity

The browser is a presentation and intent layer, not a source of official results. Opening developer tools or changing client JavaScript cannot submit an official score, winner, AI move, or final board.

- H2H clients submit a game ID, coordinate, and expected revision. The server verifies the participant, turn, revision, cell, score, completed squares, outcome, and persisted board.
- Solo clients submit start rules or a coordinate intent with an expected revision and command ID. The server owns the session, private RNG seed, AI selection, complete move history, result, metrics, and Ranked settlement.
- Repeated solo commands are idempotent. Reusing a command ID for different intent is rejected.
- Redis compare-and-set transactions serialize competing mutations. H2H terminal results enter a durable outbox and settle rating and metrics exactly once.
- Solo result shares are prepared from canonical completed human victories and finalized through an idempotent receipt. Explicit submission failures are retryable, while unconfirmed in-flight receipts remain pending to avoid duplicate posts. Client-claimed result uploads are rejected.
- Practice data never enters the versioned Ranked-solo namespace. Unverifiable legacy HVA ratings remain untouched but are excluded from current rankings.

Pure rules are shared between client and server to keep behavior DRY. Server validation and persistence remain the trust boundary.

## Application surfaces

- The default inline post entrypoint is a self-running preview: intro, rules demo, then live leaderboards. Preview onboarding is complete only after the full demo finishes.
- **Start Playing!** opens the full game entrypoint.
- Shared leaderboard and victory posts render dedicated previews and board replays. Older solo replay payloads retain their player-one-first fallback.
- A moderator subreddit menu item creates a fresh Euclid post.
- Spectators receive neutral result copy and a local-only **Stop Watching** action; they cannot mutate or leave on behalf of participants.

## Architecture

```text
src/shared/
  game/engine.ts       Pure board, scoring events, outcomes, and AI policy
  game/rules.ts        Versioned Ranked rules and strict Practice validation
  scoring.ts           Grid Footprint, True Area, totals, and target guidance
  types/api.ts         Contracts shared by the browser and server

src/client/
  preview.tsx          Inline preview, demo, leaderboards, and shared posts
  App.tsx              Full game and moderator-facing UI
  game-ui.ts           Result, spectator, and responsive-layout decisions
  solo-ui.ts           Solo intents, reconciliation, assistance, and exit policy
  share-replay*.ts(x)  Backward-compatible canonical replay rendering

src/server/
  index.ts             Devvit/Express routes, profiles, rankings, shares, metrics
  h2h.ts               Canonical multiplayer domain rules and validation
  h2h-store.ts         Atomic matchmaking, games, chat, leave, and rematch storage
  h2h-settlement.ts    Durable exactly-once H2H Elo and metric settlement
  solo.ts              Canonical solo domain, replay validation, and redaction
  solo-store.ts        Atomic sessions, idempotency, Ranked Elo, metrics, shares
  redis-cas.ts         Shared optimistic Redis transaction seam
```

Redis keys for canonical solo games and ratings are versioned independently from legacy data. Legacy H2H boards are normalized and fully replay-validated when read.

## Local development

Requirements:

- Node.js 24 and npm (Devvit's supported local baseline is currently 24.18.0)
- A Reddit account with Devvit access for playtest, upload, installation, or publication

Install dependencies and run the local quality gate:

```bash
npm install
npm run type-check
npm run lint
npx vitest run
npm run build
git diff --check
```

Useful commands:

```bash
npm run dev       # client/server watchers plus Devvit playtest
npm run dev:vite  # browser-only Vite surface on port 7474
npm run build     # production client and server bundles in dist/
```

Tests are colocated as `*.spec.ts` files. The suite covers scoring and AI priorities, canonical replay validation, forged state, stale revisions, command replay/conflicts, concurrent Redis mutations, settlement idempotency, spectator behavior, onboarding, victory effects, responsive layout, and legacy replay compatibility.

`npm run check` is intentionally mutating: it applies ESLint fixes and Prettier formatting. Use the explicit non-mutating gate above when reviewing a worktree.

The production dependency audit (`npm audit --omit=dev`) is clean at Devvit 0.14.2. A full audit currently reports six development-only findings propagated from four advisories in the Devvit CLI's `image-size` and `tmp` chains, and offers only an incompatible downgrade to Devvit 0.10.25. Do not run `npm audit fix --force` or add unsupported overrides; reassess them with the next stable Devvit update. `@devvit/public-api` is pinned as a development-only packaging compatibility dependency because the 0.14.2 CLI resolves its generated template from the project root; Euclid remains a Devvit Web app and application source must not import that legacy API. `package.json` also pins the reviewed install-script approvals needed by the native build tools—run `npm install-scripts ls` after dependency changes.

## Devvit operation

`devvit.json` defines:

- inline `preview.html` as the default tall post entrypoint;
- `index.html` as the expanded `game` entrypoint;
- the server bundle at `dist/server/index.cjs`;
- the moderator **Create Euclid Game Post** menu action;
- `r/ripred_euclid_dev` as the playtest subreddit.

External-state commands should be run deliberately:

```bash
npx devvit login
npx devvit playtest
npm run deploy                         # build and upload a private version
npx devvit install <subreddit> ripred-euclid@<version>
npx devvit list installs <subreddit>
npx devvit view ripred-euclid@<version>
```

`npm run launch` uploads and requests publication; it is not part of the normal verification gate. A successful local build does not prove that a version was uploaded or installed.

## Assets

- `Euclid-Game2.png` is the repository overview image.
- `src/client/public/snoo.png` is the bundled splash background referenced by server-created posts.
- `subreddit/images/` contains curated branding candidates and moderator upload assets. These are not runtime imports; keep purpose-named files needed for final selection or a distinct Reddit upload role.

## Real-surface verification

Before installing a release beyond the test subreddit:

1. Resume an in-progress Ranked game after reload and verify cancel-versus-forfeit behavior.
2. Complete Ranked win, loss, and tie paths; confirm one rating settlement and winner-only sharing.
3. Complete custom Practice games across sizes, scoring modes, targets, and difficulty; confirm Ranked data is unchanged.
4. Queue two accounts, reload both, test simultaneous/stale moves, chat, leave/forfeit, and rematch.
5. Spectate both winner sides and confirm neutral copy, no celebration, and local-only exit.
6. Exercise preview onboarding, explicit tutorial dismissal, same-breakpoint resizing, height-only resizing, and orientation changes.
7. Verify leaderboard shares render their canonical frozen snapshot and result shares render their canonical replay rather than a generic fallback.

### Current test-surface defects

- **H2H rematch is not reachable from the client.** The server route and atomic domain transition exist, but the UI has no rematch control or request, so a normal player cannot start one.
- **H2H chat has no pointer or touch entry control.** A participant can open it only with the `\` keyboard shortcut, which makes chat undiscoverable on desktop and unavailable from the Reddit mobile app.

The full real-surface checklist still requires three distinct Reddit identities, simultaneous player sessions, a fresh browser-storage context, and a physical Reddit mobile-app session. Ranked win, loss, and tie outcomes also cannot be selected deterministically from the release surface; use naturally completed games unless an isolated, non-production QA fixture is designed and approved.

## Pending release work

- Select the final desktop banner, mobile banner, community icon, and compact-post icon from `subreddit/images/`; keep distinct files for distinct Reddit upload roles even when artwork currently matches.
- Verify the intended private-beta community and its current privacy/moderator state immediately before configuration. The existing planning direction names `r/EuclidTheGame`, but this repository does not prove its live state.
- Install an explicitly chosen uploaded version there and run the real-surface checklist above in desktop card view, compact view, and the Reddit mobile app.
- After private-beta results are acceptable, decide whether the community remains private, becomes restricted, or opens publicly, and prepare any introductory or how-to-play post.

## License

BSD 3-Clause. See [LICENSE](LICENSE).
