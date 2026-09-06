# Euclid

Euclid is a turn-based Reddit strategy game about claiming grid points and completing squares. Play a fixed competitive match against Euclid, configure an unranked Practice game, challenge another Redditor, or watch a live human match.

[Open the configured test community](https://www.reddit.com/r/ripred_euclid_dev/)

![Euclid game](Euclid-Game2.png)

The current app version is `0.1.98` and the project is pinned to Devvit `0.14.2`.

The intended public-facing community is [r/EuclidTheGame](https://www.reddit.com/r/EuclidTheGame/), currently private for beta testing. Its installed release was verified as `0.1.98` on September 5, 2026. Its community icon and desktop/mobile banners match those of `r/ripred_euclid_dev`; the development playtest target remains unchanged.

## Game rules

Players alternate placing one dot on an empty grid position. A placement scores every new square whose four corners are dots owned by that player. Squares may be axis-aligned or rotated, and one move may complete several squares.

The game supports two scoring systems:

- **Grid Footprint** counts the inclusive grid positions along the larger axis of the square's smallest axis-aligned enclosure, then squares that count. For corners with coordinate bounds `minX`, `maxX`, `minY`, and `maxY`, points are `max(maxX - minX + 1, maxY - minY + 1)²`. Corner order and mirrored or quarter-turned orientation do not change the result.
- **True Area** scores the square's geometric area. On the integer grid this is the squared distance between adjacent corners, found as the smallest non-zero pairwise squared corner distance.

The first player to reach the target wins. If the board fills first, the higher score wins; equal scores produce a tie. Practice target recommendations scale from the 8×8, first-to-150 baseline, stay above the smallest scoring event, and never exceed the board's theoretical total.

## Game modes

| Mode                 | Rules                                                                                   | Rating          | Persistence and assistance                                                                     |
| -------------------- | --------------------------------------------------------------------------------------- | --------------- | ---------------------------------------------------------------------------------------------- |
| Ranked vs Euclid     | 8×8, Grid Footprint, first to 150, human first, Brutal                                  | Ranked solo Elo | One active game per user; reload resumes it; assistance is disabled                            |
| Practice vs Euclid   | Even dimensions from 4 through 16, either scoring mode, supported target and difficulty | Unrated         | Server-authoritative custom game; hints and local auto-move tools are allowed                  |
| Redditor vs Redditor | 8×8, Grid Footprint, first to 150                                                       | Multiplayer Elo | Matchmaking, reload resume, leave/forfeit, rematch, participant chat, and read-only spectating |

Canceling Ranked before the first human move is unrated. Abandoning after play begins records one loss. Ending Practice never changes Ranked Elo.

Ranked solo Elo starts at 1200 and uses K=32 against Euclid's fixed 1600 reference rating.

Euclid has nine difficulty levels. Brutal prioritizes its own immediate win, then prevents an opponent's immediate win, compares immediate offensive and defensive value, and finally pursues longer-term square construction.

## Authority and integrity

The browser is a presentation and intent layer, not a source of official results. Opening developer tools or changing client JavaScript cannot submit an official score, winner, AI move, or final board.

- H2H clients submit a game ID, coordinate, and expected revision. The server verifies the participant, turn, revision, cell, score, completed squares, outcome, and persisted board.
- Solo clients submit start rules or a coordinate intent with an expected revision and command ID. The server owns the session, private RNG seed, AI selection, complete move history, result, metrics, and Ranked settlement.
- Repeated solo commands are idempotent. Reusing a command ID for different intent is rejected.
- Redis compare-and-set transactions serialize competing mutations. H2H terminal results are archived immutably by game ID and terminal revision in the same transaction that ends the round; they enter a durable outbox and settle rating and metrics exactly once.
- Solo result shares are prepared from canonical completed human victories and finalized through an idempotent receipt. Explicit submission failures are retryable, while unconfirmed in-flight receipts remain pending to avoid duplicate posts. Client-claimed result uploads are rejected.
- Practice data never enters the versioned Ranked-solo namespace. Unverifiable legacy HVA ratings remain untouched but are excluded from current rankings.

Pure rules are shared between client and server to keep behavior DRY. Server validation and persistence remain the trust boundary.

Home records, resume and queue status, and live scoring effects are projections of server-owned state. Score feedback comes only from an accepted canonical move or a newly observed canonical move. Loading or resuming establishes a quiet baseline and does not replay or invent prior scoring events.

## Application surfaces

- The default inline post entrypoint is a self-running preview: intro, rules demo, then live leaderboards. Preview onboarding is complete only after the full demo finishes.
- **Start Playing!** opens the full game entrypoint.
- Solo gameplay shortcuts require a fresh key press during the displayed human turn. Buffered keys, held-key repeats, and partial shortcut input do not carry into the next turn; gameplay keys are ignored while a move is pending or the game has ended. Chat typing is unaffected.
- The expanded entrypoint opens on a responsive navy-and-vector-grid dashboard. **Play Euclid** is the primary action, **Play a Redditor** is secondary, separate solo and multiplayer ratings are shown, and saved solo games, active Redditor matches, and matchmaking state have explicit continue or cancel controls. Live games, Leaderboard, Options, and Rules remain quieter navigation.
- Canonical scoring moves show `+N` and the completed-square count beside the move and scorecard, animate only the newly completed squares, and briefly show each new square's enclosing footprint in Grid Footprint mode. Players can hide accumulated square lines without hiding the active scoring event; True Area does not show a footprint overlay.
- Live Redditor matches give participants a visible, touch-sized **Chat** control while retaining the `\` keyboard shortcut. The focus-contained composer has explicit Send and Cancel actions, and its chronological live log wraps long messages without trapping the board controls below the viewport. Spectators can read the existing shared log but cannot compose messages.
- After a normally completed Redditor match, either participant can select **Rematch** while both players remain attached. The request is bound to the terminal revision, simultaneous requests converge on one canonical new round, and a player who already left is never silently restored. The server derives ongoing rematch availability from both participant mappings; if either player closes, the remaining client hides the action and stops terminal polling without changing the finished board. If terminal Close and an untouched rematch race, Close cancels that rematch without recording a forfeit. Finished-round sharing is bound to the immutable terminal revision, so a rematch cannot replace the result being shared.
- Shared leaderboard and victory posts render dedicated previews and board replays. Victory posts use the same responsive result layout in both entrypoints, with compact final scores, a side-by-side replay on wider screens, and a keyboard-accessible viewport scroll area on smaller screens. Older solo replay payloads retain their player-one-first fallback.
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
  App.tsx              Full-game orchestration, canonical state adoption, and board UI
  home-lifecycle.ts    Queue recovery and stale-request transition policy
  home-screen.tsx      Responsive home dashboard and transition/status surfaces
  home-ui.ts           Pure record, resume, and matchmaking presentation
  h2h-controls.tsx     Accessible participant chat and rematch controls
  score-feedback.ts    Canonical score-event normalization and display geometry
  game-ui.ts           Result, spectator, and responsive-layout decisions
  solo-ui.ts           Solo intents, reconciliation, assistance, and exit policy
  share-replay*.ts(x)  Backward-compatible canonical replay rendering

src/server/
  index.ts             Devvit/Express routes, profiles, rankings, shares, metrics
  h2h.ts               Canonical multiplayer domain rules and validation
  h2h-store.ts         Atomic matchmaking, games, chat, leave, rematch, and terminal-round archives
  h2h-presence.ts      Stable idle, queued, and active multiplayer presence resolution
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

Tests are colocated as `*.spec.{ts,tsx}` files. The suite covers scoring and AI priorities, canonical replay validation, forged state, stale revisions, command replay/conflicts, concurrent Redis mutations, settlement idempotency, spectator behavior, onboarding, victory effects, responsive layout, home record/resume/matchmaking presentation, H2H presence stabilization, participant-control eligibility and markup, rematch convergence and detachment, terminal-Close/rematch cancellation, immutable terminal-round archives, canonical score-feedback normalization, history-reset handling, footprint geometry, and legacy replay compatibility.

`npm run check` is intentionally mutating: it applies ESLint fixes and Prettier formatting. Use the explicit non-mutating gate above when reviewing a worktree.

At the current lockfile, `npm audit --omit=dev` reports three moderate `qs` advisories inherited through Express and body-parser, with no fix currently offered. The full audit reports 19 findings—2 low, 13 moderate, and 4 high—including the same production chain plus development-tool findings propagated through ESLint and the Devvit CLI's `image-size` and `tmp` chains; npm currently offers no fix for those paths. Do not run `npm audit fix --force` or add unsupported overrides. Reassess the direct Express dependency and the Devvit/ESLint toolchains when compatible releases become available. `@devvit/public-api` is pinned as a development-only packaging compatibility dependency because the 0.14.2 CLI resolves its generated template from the project root; Euclid remains a Devvit Web app and application source must not import that legacy API. `package.json` also pins the reviewed install-script approvals needed by the native build tools—run `npm install-scripts ls` after dependency changes.

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

- Preserve the established page artwork and icons, including the landing page, splash screen, and demo. Change them only when explicitly requested; functional UI work does not authorize artwork changes.
- `Euclid-Game2.png` is the repository overview image.
- `src/client/public/snoo.png` is the bundled splash background referenced by server-created posts.
- `subreddit/images/` contains curated branding candidates and moderator upload assets. These are not runtime imports; keep purpose-named files needed for final selection or a distinct Reddit upload role.

## Real-surface verification

Before installing a release beyond the test subreddit:

1. Verify dashboard idle, saved-solo, queued, and active-H2H states; resume an in-progress Ranked game after reload and verify cancel-versus-forfeit behavior.
2. Complete Ranked win, loss, and tie paths; confirm one rating settlement and winner-only sharing.
3. Complete custom Practice games across sizes, scoring modes, targets, and difficulty; verify live score feedback and the accumulated-line toggle, and confirm Ranked data is unchanged. Hold or rapidly press gameplay shortcut keys during a pending move: the next human turn must require a fresh press, and no gameplay key may place a dot after the result.
4. Queue two accounts, reload both, verify local-response and polled-opponent score feedback, and test simultaneous/stale moves, pointer/touch and keyboard chat entry, leave/forfeit, and rematch.
5. Spectate both winner sides and confirm neutral copy, no celebration, and local-only exit.
6. Exercise preview onboarding, explicit tutorial dismissal, same-breakpoint resizing, height-only resizing, and orientation changes.
7. Verify leaderboard shares render their canonical frozen snapshot and result shares render their exact terminal-revision replay rather than a generic fallback, including when a rematch has already begun. Check new and existing victory posts at desktop and mobile widths and increased browser zoom: final scores must be readable, and the entire replay and footer must remain reachable by scrolling.

The full real-surface checklist still requires three distinct Reddit identities, simultaneous player sessions, a fresh browser-storage context, and a physical Reddit mobile-app session. Ranked win, loss, and tie outcomes also cannot be selected deterministically from the release surface; use naturally completed games unless an isolated, non-production QA fixture is designed and approved.

## Optional enhancements

- **Interactive first-score onboarding:** Add a guided lesson on the real board that asks the player to place a dot, reveals a one-move scoring opportunity, lets the player complete it, and then introduces rotated and larger squares.
- **Accessibility and mobile completion:** Make board spots semantic keyboard-operable controls with coordinate and occupancy labels, arrow navigation, and Enter or Space placement. Add non-color ownership cues and accessible dialog focus behavior; complete dynamic-viewport, safe-area, and practical large-board touch-target support; verify Assist-mode touch behavior; and suppress the remaining celebration and assistance animations when reduced motion is requested.
- **Balance and configuration:** Define Short, Standard, and Marathon targets from desired turn counts and playtesting, measure first-player performance, alternate the opening player in rematches, and simplify the nine AI choices into clearer player-facing tiers while retaining their personality labels where useful.
- **Chat and spectator privacy:** Decide whether chat merits retention. If retained, disclose that spectators can read it and add appropriate mute, report, and moderation controls before wider public play. Remove or reframe AI echo chat unless it gains an intentional gameplay purpose.
- **Independent rules verification:** Add an independent reference oracle, golden fixtures, and generated-board or property comparisons that do not reuse the production decision path, supplementing the existing replay-validation and tampering coverage.

## Pending release work

- Run the real-surface checklist above on the installed release in `r/EuclidTheGame`, including desktop card view, compact view, and the Reddit mobile app. Installation and asset verification do not replace gameplay and layout testing.
- After private-beta results are acceptable, decide whether the community remains private, becomes restricted, or opens publicly, and prepare any introductory or how-to-play post.

## License

MIT. Copyright (c) 2025-2026 Trent M. Wyatt. See [LICENSE](LICENSE).
