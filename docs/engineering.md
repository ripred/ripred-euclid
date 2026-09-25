# Euclid engineering notes

[Back to the game and local quick start](../README.md).

These notes cover the rules the server enforces, the client surfaces, and the checks to run before a Reddit release. The README describes this checkout; use the installation commands below to check what a subreddit actually runs.

## Scoring and ratings

Grid Footprint uses the inclusive bounding-box span: `max(maxX - minX + 1, maxY - minY + 1)²`. True Area uses the smallest non-zero squared distance between any two corners (the squared side length). Neither depends on corner order. Practice target recommendations scale from the 8×8, first-to-150 baseline and stay between the smallest scoring event and the board's theoretical total.

Ranked solo starts at 1200 Elo, with K=32 against Euclid's fixed 1600 reference rating. The opponent's play level is Tenderfoot. That reference rating and the move-selection difficulty are separate settings. Ranked solo and multiplayer have separate leaderboards; Practice never settles a rating.

## Authority and integrity

The browser is a presentation and intent layer, not a source of official results. Opening developer tools or changing client JavaScript cannot submit an official score, winner, computer move, or final board.

- H2H clients submit a game ID, coordinate, and expected revision. The server verifies the participant, turn, revision, cell, score, completed squares, outcome, and persisted board.
- Solo clients submit start rules or a coordinate intent with an expected revision and command ID. The server owns the session, private RNG seed, Euclid’s move selection, complete move history, result, metrics, and Ranked settlement.
- New solo command receipts retain exact retry responses for 24 hours. While a receipt exists, reusing its command ID for different intent is rejected. Each user can allocate up to 4,096 receipts or 32 MiB of serialized receipts per 24-hour budget window; retries of existing receipts do not consume this allocation budget. Canonical revision and terminal checks still apply after receipt expiration.
- Solo starts, state reads, moves, and abandonment share a 120-request-per-minute allowance per user, checked before replay validation, including receipt retries. Request and allocation limits return HTTP 429 with retry guidance.
- Practice games and unshared results expire 48 hours after a new command receipt, outliving every associated 24-hour receipt. Reads and receipt replays do not renew retention. Ranked history, ratings, and prepared or published shares remain durable. Untouched older Practice records and receipts retain their existing lifetime until rewritten; there is no deletion sweep.
- H2H pairing and rematches atomically charge both players against an allowance of 100 new rounds per 24-hour window. Resuming costs nothing, and exhausted queue entries do not block eligible players. These per-account limits bound allocation rates, not total historical storage or traffic from multiple accounts.
- A started H2H game's ten-minute turn timeout records a forfeit against the player whose turn expired. Only an accepted move starts a fresh turn clock; chat and spectator activity cannot extend it. Expiration is settled on subsequent game access or cleanup, preserving the terminal board and exactly-once rating settlement. Unplayed expired pairings cancel without affecting ratings.
- Leaderboard and H2H sharing reserve their existing per-user, per-kind cooldown atomically before submitting a post, so simultaneous requests cannot bypass it.
- Redis compare-and-set transactions serialize competing mutations. H2H terminal results are archived immutably by game ID and terminal revision in the same transaction that ends the round; they enter a durable outbox and settle rating and metrics exactly once.
- Solo result shares are prepared from canonical completed human victories and finalized through an idempotent receipt. New submissions and explicit failure retries reserve a ten-second per-user cooldown across games; prepared and posted duplicates do not resubmit. Unconfirmed in-flight receipts remain pending to avoid duplicate posts. Client-claimed result uploads are rejected.
- Practice data never enters the versioned Ranked-solo namespace. Unverifiable legacy HVA ratings remain untouched but are excluded from current rankings.

Pure rules are shared between client and server to keep behavior DRY. Server validation and persistence remain the trust boundary.

Home records, resume and queue status, and live scoring effects are projections of server-owned state. Score feedback comes only from an accepted canonical move or a newly observed canonical move. Loading or resuming establishes a quiet baseline and does not replay or invent prior scoring events.

## Application surfaces

- The default inline post uses a carousel that fades between panels through the current theme background: the complete six-lesson teaching game, compact live standings, available finalized daily and weekly winners, then game choices. Winner cards show move count, solve time, and total daily/weekly wins; they contain no solution boards. Arrows, slide buttons, swipe, and Pause control the rotation. Focusing a slide control pauses the rotation with an explicit Resume action; resting the pointer over a slide does not pause it. Hidden tabs stop playback, and reduced-motion viewers start paused. Preview onboarding completes only after the full demo finishes.
- **Play now**, **Watch live**, and **Full leaderboard** occupy a fixed footer outside the slides. Play now jumps to choices. **Play Euclid** opens the `solo` entry and **Play Another Redditor** opens `reddit`; both wait for authoritative presence and saved-game checks before using the existing home actions. Existing queues or matches remain in the home controls. **Game menu & settings** opens the ordinary `game` entry without starting a match. Watch and leaderboard open their existing expanded screens.
- Solo gameplay shortcuts require a fresh key press during the displayed human turn. Buffered keys, held-key repeats, and partial shortcut input do not carry into the next turn; gameplay keys are ignored while a move is pending or the game has ended. Chat typing is unaffected.
- Expanded solo, multiplayer, and spectator games share a viewport-bounded layout. Board sizing accounts for the actual title, scores, chat, and action controls as they resize or wrap. Unusually small expanded frames retain scrolling rather than clipping controls or shrinking cells below their minimum size.
- The expanded entrypoint opens on a home screen under a close-up of a board in play. **Play Euclid** is the primary action, with a Practice/Ranked switch beside it; **Play a Redditor** is secondary. Separate solo and multiplayer ratings are shown, and saved solo games, active Redditor matches, and matchmaking state have explicit continue or cancel controls. A "Learn in a minute" strip shows the three illustrated lessons. Live games, Leaderboard, Options, and Rules remain quieter navigation.
- The game screen keeps the board, both scoreboards, the turn status, and chat in one column whose width follows the board. Each scoreboard races toward the target score. Points are keyboard-operable grid cells with coordinate and ownership labels, arrow navigation, and Enter or Space placement; board keystrokes never queue ahead of a move, so a key places only if it was pressed after the turn became placeable and is not a repeat. On touch screens with small cells, the first tap aims (preview piece and pulse) and a second tap on the same point places. Practice games and Redditor matches offer the square-hint toggle in the game bar.
- Canonical scoring moves show `+N` beside the move (with the footprint size, such as `3×3 footprint`, in Grid Footprint mode) and on the scorecard, count the score up, draw only the newly completed squares with a corner flash, and briefly show each new square's enclosing footprint in Grid Footprint mode. Players can hide accumulated square lines without hiding the active scoring event; True Area does not show a footprint overlay.
- Live Redditor matches give participants a visible, touch-sized **Chat** control while retaining the `\` keyboard shortcut. The focus-contained composer has explicit Send and Cancel actions, and its chronological live log wraps long messages without trapping the board controls below the viewport. Spectators can read the existing shared log but cannot compose messages.
- After a normally completed Redditor match, either participant can select **Rematch** while both players remain attached. The request is bound to the terminal revision, simultaneous requests converge on one canonical new round, and a player who already left is never silently restored. The server derives ongoing rematch availability from both participant mappings; if either player closes, the remaining client hides the action and stops terminal polling without changing the finished board. If terminal Close and an untouched rematch race, Close cancels that rematch without recording a forfeit. Finished-round sharing is bound to the immutable terminal revision, so a rematch cannot replace the result being shared.
- Shared leaderboard and victory posts have compact inline summaries with an explicit expansion button. Inline leaderboard summaries retain the canonical row order and show only the leading rows that fit; the expanded snapshot retains every row. Inline victories show canonical final scores and outcome; the expanded result includes the full board replay and footer, with a side-by-side layout on wider screens and a keyboard-accessible scroll area on smaller screens. Older solo replay payloads retain their player-one-first fallback.
- A moderator subreddit menu item creates a fresh Euclid post.
- The Watch lobby pairs names and scores using canonical player order and shows board size, score target, and **Last activity**. Its list refreshes every 30 seconds while visible, never overlaps requests, and discards pending responses when the viewer leaves. Loading and retryable errors are distinct from an empty lobby; an empty or unavailable game offers an explicitly recorded **Watch demo** and **Play** path using the existing teaching sequence.
- Spectators receive neutral result copy and a local-only **Stop Watching** action; they cannot mutate or leave on behalf of participants. Completed matches offer **Replay**, **Another live game**, and **Play**. Replay freezes the accepted terminal board and canonical outcome, including forfeits, so later rematches cannot replace it. Missing games do not fabricate a final replay. Result controls receive keyboard focus; the player tutorial does not interrupt watching.

## Architecture

```text
src/shared/
  game/engine.ts          Board, scoring events, outcomes, and computer move policy
  game/geometry.ts        Square enumeration used by scoring, hints, and puzzles
  game/random.ts          Seeded randomness shared by solo play and generation
  game/rules.ts           Ranked rules and strict Practice validation
  scoring.ts              Grid Footprint, True Area, totals, and target guidance
  challenge.ts            Public puzzle state, settings, and accepted placements
  challenge-spotlights.ts Finalized winner contracts and empty production state
  user-avatar.ts          Shared username validation
  types/api.ts            Browser/server contracts

src/client/
  App.tsx                 Full-game orchestration and server-state adoption
  home-screen.tsx         Records, saved games, matchmaking, and mode selection
  game-screen.tsx         Board, scores, input, chat, and result controls
  preview.tsx             Teaching sequence, standings, winner panels, and choices
  splash-carousel.tsx     Fade transitions, navigation, and playback controls
  challenge-screen.tsx    Moderator settings, generation, play, and restart
  ChallengeTimer.tsx      Display clock synchronized with the server attempt
  rankings-screen.tsx     Full solo and multiplayer standings
  watch-view.tsx          Live lobby, recorded demo, replay, and result controls
  expanded-entry.ts       Direct solo, Redditor, rankings, and watch routing
  share-preview.tsx       Inline summaries and expanded frozen results
  ui/BoardDiagram.tsx     Passive board artwork shared by every surface
  ui/BoardInput.tsx       Shared keyboard, pointer, and touch board controls
  ui/PlayerAvatar.tsx     Image display and initial fallback
  ui/RedditAvatar.tsx     Cancellable lookup when a surface has only a username
  design/                 Shared tokens and base styling
  dev/                    Development-only brand art preview and export

src/server/
  index.ts                Devvit/Express routes, profiles, rankings, and shares
  h2h*.ts                 Multiplayer rules, atomic state, presence, and settlement
  solo*.ts                Solo rules, private randomness, receipts, and settlement
  challenge-generator.ts  Puzzle construction and minimum-move certification
  challenge-store.ts      Private attempts, timing, revisions, and expiration
  challenge-routes.ts     Moderator authorization and playground endpoints
  user-avatars.ts         Shared avatar cache and lookup coalescing
  user-avatar-routes.ts   Public username-to-avatar endpoint
  request-limits.ts       Receipt budgets, retention, and share cooldowns
  redis-cas.ts            Optimistic Redis transactions

tools/local-devvit/       In-memory Reddit services and local-only sample data
tools/render-readme-images.mjs  Reproducible documentation illustrations
```

Redis keys for canonical solo games and ratings are versioned independently from legacy data. Legacy H2H boards are normalized and fully replay-validated when read.

## Dependency maintenance

Vitest is pinned to `5.0.0`. Devvit stays at `0.14.2`: the deprecated `devvit@1.0.0` package has no CLI executable and breaks playtest/upload. A scoped `@devvit/cli` override selects `inquirer@9.3.8`, which replaces the legacy editor and removes `tmp` from the dependency tree. A version-scoped override replaces the CLI's `js-yaml@4.3.1` with `4.3.2` to enforce empty-map merge limits (GHSA-2883-xcg3-v3hh), preserving the separate patched 3.x dependency used by oclif. Remove this YAML override when a compatible Devvit release supplies the patched dependency. `npm run test:dependencies` checks temporary-file containment, non-string affixes, the editor round trip, input/list/confirm prompts, Vitest mock redirects against Vite file-serving rules, and Devvit YAML merge limits and parsing compatibility. `npm run check:devvit` checks command loading, validates the built entrypoints, and runs the same local bundler used by upload/playtest without uploading or installing. Run it after the build.

The September 11, 2026 full audit reported three high-severity affected development packages in the Devvit CLI's `image-size` chain; the production-only audit reported zero. Those counts are historical; rerun the audit when reviewing dependencies. These are separate from the resolved `tmp`, Vitest, and `js-yaml` advisories. Do not run `npm audit fix --force`: its proposed `devvit@1.0.0` replacement removes the CLI. Reassess these remaining paths when compatible fixes are available. `@devvit/public-api` is pinned as a development-only packaging compatibility dependency because the 0.14.2 CLI resolves its generated template from the project root; Euclid remains a Devvit Web app and application source must not import that legacy API. `package.json` also pins the reviewed install-script approvals needed by the native build tools—run `npm install-scripts ls` after dependency changes.

## Player avatars

`GET /api/users/:username/avatar` retrieves a public Snoovatar through the supported `reddit.getSnoovatarUrl(username)` API. The same service refreshes current-player profiles. Usernames are normalized; successful results are cached for six hours, missing avatars for fifteen minutes, and concurrent lookups share one request. A stale image remains usable during a brief lookup outage. The API may return no Snoovatar; this implementation does not scrape profile pages to obtain uploaded profile photos.

`PlayerAvatar` displays a supplied URL with lazy image loading and an initial fallback on errors. `RedditAvatar` adds a cancellable username lookup for winner cards or future surfaces that do not already have profile data. Leaderboard rows carry their image URLs and do not perform hundreds of profile lookups. Local winner cards exercise the same route using fictional names and Reddit's default avatar artwork; live account resolution requires a Devvit runtime.

API reference: [RedditClient.getSnoovatarUrl](https://developers.reddit.com/docs/api/public-api/classes/RedditClient#getsnoovatarurl).

## Challenge playground details

The challenge feature branch includes a private moderator playground on the standard 8×8 board. Its home-screen entry is currently hidden; the screen, engine, and protected endpoints remain in the code. The playground supports minimum moves and target squares (1–4 each), construction geometry, shared corners, and optional multiple optimal solutions. Any valid square counts during play. The minimum is certified, not a move limit; there is no undo or hint action.

The **Daily starting point** preset selects 3 mixed squares in 2 moves; **Weekly starting point** selects 4 oblique squares in 3 moves. Suggested ranges are 2–3 daily squares or 3–4 weekly squares, each in 2–4 moves. Presets remain editable and do not enable a schedule.

Blocked spots can be marked directly before generation. **Total blocked spots** includes those mandatory selections; the generator chooses any additional blocks. Blocked spots cannot be square corners, but may lie inside squares or along their edges. Generation rejects boards with pre-completed squares or an uncertified minimum. A bounded failure preserves the current attempt.

A completed attempt stops automatically. **Restart puzzle** keeps the same board and the best completed result: fewest moves, then shortest elapsed time. The server starts timing after generation or restart and freezes the clock on the accepted completing move. Refreshes and background tabs do not pause time; client timestamps cannot set the result. Leaving deletes the private session; disconnected sessions expire after two hours without a mutation. No attempt is added to rankings, spectator lists, shares, or public posts. Daily/weekly scheduling and official results are not enabled in this playground.

To test locally:

```bash
npm run dev:local
```

The `local_moderator` fixture grants moderator permission in the local adapter, but does not restore the hidden playground entry. Other local identities cannot use the challenge endpoints. Published builds check current subreddit moderator membership on the server for every challenge request. A separate tab using the same identity shares one private session and must reconcile stale revisions.

## Devvit operation

`devvit.json` defines:

- inline `preview.html` as the default tall post entrypoint;
- `index.html` as the expanded `game` entrypoint;
- `solo.html` and `reddit.html` as explicit expanded game launch entrypoints;
- `leaderboard.html` as the expanded `leaderboard` entrypoint;
- `watch.html` as the expanded `watch` entrypoint;
- the server bundle at `dist/server/index.cjs`;
- the moderator **Create Euclid Game Post** menu action;
- `r/ripred_euclid_dev` as the playtest subreddit.

The beta community is `EuclidTheGame`; the development playtest target is `ripred_euclid_dev`. Uploading a version does not install it, and installing the app does not update the subreddit icon or banners. Use these commands for the release steps:

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

- Every surface draws the board with one renderer (`src/client/ui/BoardDiagram.tsx`) and one set of design tokens (`src/client/design/tokens.css`): a graphite board, porcelain open points, glossy red and blue tokens that share one construction, and banded square edges. The UI follows Reddit's light or dark appearance; the board looks the same in both. Change artwork deliberately and keep it consistent with these components.
- `docs/images/euclid-board.svg` and `docs/images/challenge-board.svg` are README illustrations. Run `node tools/render-readme-images.mjs` to reproduce them from the shared board renderer, teaching recording, and a fixed certified puzzle. The README also uses the current desktop subreddit banner.
- `src/client/public/splash.jpg` is the splash background referenced by server-created share posts.
- Brand art is rendered from the game's own components in `src/client/dev/brand-art.tsx`. With `npm run dev:local` running, open `/dev/brand-assets.html` to preview it; **Export images** writes `subreddit/images/euclid_board_icon_300.png`, `euclid_board_banner_desktop.png` (3168×256), `euclid_board_banner_mobile.png` (1592×128), and `src/client/public/splash.jpg` (1200×900).
- `subreddit/images/` contains curated branding candidates and moderator upload assets. These are not runtime imports; keep purpose-named files needed for final selection or a distinct Reddit upload role.

## Real-surface verification

Before installing a release beyond the test subreddit:

1. Verify dashboard idle, saved-solo, queued, and active-H2H states; resume an in-progress Ranked game after reload and verify cancel-versus-forfeit behavior.
2. Complete Ranked win, loss, and tie paths; confirm one rating settlement and winner-only sharing.
3. Complete custom Practice games across sizes, scoring modes, targets, and difficulty; verify live score feedback and the accumulated-line toggle, and confirm Ranked data is unchanged. Hold or rapidly press gameplay shortcut keys during a pending move: the next human turn must require a fresh press, and no gameplay key may place a dot after the result.
4. Queue two accounts, reload both, verify local-response and polled-opponent score feedback, and test simultaneous/stale moves, pointer/touch and keyboard chat entry, leave/forfeit, and rematch.
5. Open **Watch Live** from each inline phase. Exercise loading, retry, an empty lobby, and the recorded demo. Spectate both winner sides, a forfeit, and a tie; confirm neutral copy, no celebration, read-only input, and local-only exit. Check result focus and Tab wrapping, **Replay / Another live game / Play**, frozen replay after participant rematches, and unavailable-game fallback. Leaving during a pending request must not reopen the old route.
6. Watch the full splash rotation in Reddit desktop card/compact views and the native mobile app. Check theme changes, pointer hover, keyboard focus, Pause/Resume, reduced motion, hidden tabs, orientation, height-only resizing, and increased zoom. Keep **Play now**, **Watch live**, and **Full leaderboard** visible through every phase. Verify that solo/Redditor choices expand correctly and respect existing games and queues. Inline content must leave the parent feed's scrolling available; expanded views must keep all controls reachable.
7. Verify leaderboard shares render their canonical frozen snapshot and result shares retain their exact terminal-revision replay, including when a rematch has already begun. Inline summaries must fit without scrolling and keep their expansion action visible at desktop/mobile widths and increased zoom. After expansion, every snapshot row and the entire replay and footer must remain reachable, including by scrolling and keyboard navigation where needed.

8. Before restoring the playground entry, use a moderator account to generate and play puzzles, restart attempts, mark blocked points, and exercise stale revisions from two tabs. Check that an ordinary account cannot reach the playground endpoints. Verify timing and best-result ordering, and confirm that attempts never appear in watch lists, rankings, or shares.
9. Check winner-card and current-player Snoovatars in a Devvit runtime, including missing images and failed lookups. Local sample avatars only establish the adapter and display behavior.

The full real-surface checklist requires three distinct Reddit identities, simultaneous player sessions, a fresh browser-storage context, and a physical Reddit mobile-app session. Ranked win, loss, and tie outcomes also cannot be selected deterministically from the release surface; use naturally completed games unless an isolated, non-production QA fixture is designed and approved.

## Further work

- **Interactive first-score onboarding:** Add a guided lesson on the real board that asks the player to place a dot, reveals a one-move scoring opportunity, lets the player complete it, and then introduces rotated and larger squares.
- **Accessibility and mobile completion:** Board points are now keyboard-operable with labels, dialogs contain focus, dense boards use tap-to-aim on touch, and confetti respects reduced motion. Still open: a non-color ownership cue that keeps red and blue tokens identical in construction, and verifying Assist-mode touch behavior on native devices.
- **Balance and configuration:** Define Short, Standard, and Marathon targets from desired turn counts and playtesting, measure first-player performance, alternate the opening player in rematches, and simplify the nine difficulty choices into clearer player-facing tiers while retaining their personality labels where useful.
- **Chat and spectator privacy:** Decide whether chat merits retention. If retained, disclose that spectators can read it and add appropriate mute, report, and moderation controls before wider public play. Remove or reframe computer echo chat unless it gains an intentional gameplay purpose.
- **Independent rules verification:** Add an independent reference oracle, golden fixtures, and generated-board or property comparisons that do not reuse the production decision path, supplementing the existing replay-validation and tampering coverage.

The Prism, Lattice, Weave, Tide, and Relay experiments live on separate `redesign/*` branches and sibling worktrees. They are independent of this release. Keep their installation and device checks separate.
