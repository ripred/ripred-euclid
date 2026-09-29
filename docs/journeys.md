# Euclid Journeys

This is the implementation and release checklist for player-session analytics on
`main`. Standard and Tide, solo Practice and Ranked, multiplayer, and daily/weekly
competitions use one lifecycle controller and a guarded Reddit telemetry router.
The five variation branches and stand-alone branch are outside this release.

## Journey map

| Experience             | Intentional start                                                                                       | End                                                        |
| ---------------------- | ------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| Solo Practice / Ranked | Successful new game or explicit Continue                                                                | Canonical win, loss, draw, cancellation, or abandonment    |
| Multiplayer            | Successful queue entry, including immediate pairing                                                     | Canonical result, forfeit, or confirmed queue cancellation |
| Daily / Weekly         | Successful Start / Retry revealing an active attempt                                                    | Solved, explicitly abandoned, expired, or replaced attempt |
| Resume                 | Restore the saved Journey; otherwise explicit Continue or accepted player move starts a resumed segment | The same canonical terminal rules                          |

Queue time belongs to the multiplayer Journey. Pairing promotes the existing
queue binding to the canonical game round without starting a second Journey.
Normal wins, losses, and draws are complete experiences; winning is recorded
separately. A quitter's experience is incomplete, while the opponent's forfeit
win is complete. Challenge Back, reload, and visibility changes preserve an
attempt and do not manufacture a loss or abandonment.

App.Ready occurs once after successful initialization of the expanded document.
The inline preview, tutorials alone, menus, standings, spectators, recordings,
and moderator playground never start gameplay Journeys. Completed result screens
do not reopen Journeys. Post-result sharing retains existing operational metrics.

During an active Journey, useful interactions are bounded to 32. The controller
deduplicates the first accepted move, first player square, and the highest newly
crossed 25/50/75 percent milestone. Match progress follows leading score divided
by target; challenge progress follows squares completed divided by its objective.
Terminal progress is sent once. Fixed configuration labels distinguish mode,
variant, difficulty, and new/resumed/rematch activity. No usernames, chat, board
contents, private game data, or arbitrary text are sent as custom telemetry.

## Reliability and authority

The public `@devvit/analytics` Reddit entrypoints are pinned with the other Devvit
packages at 0.14.6. Session storage is scoped to post, player, and tab, with memory fallback.
After 30 minutes idle, only another intentional action can open a resumed segment.
Gameplay telemetry runs in its own serialized queue with a two-second timeout
covering the response body. App.Ready uses a separate bounded request so it cannot
delay Start. Gameplay never waits for analytics, and uncertain delivery is not retried.

The `x-euclid-activity` header identifies an exact canonical activity to this
server; it is not forwarded as custom analytics data. Small JSON limits,
request budgets, expiring journey bindings, trusted player/post context, fixed
event vocabulary, and canonical read-only getters guard the official router.
Scores, progress, completion, and winners come from stored state, including
terminal archives. Each multiplayer participant reports through their own
authenticated requests; jobs and opponents cannot attribute events to them.
The optional `roundStartRevision` identifies rematches because game ID and board
creation time remain unchanged across rounds. Legacy records keep the field absent and use a distinct legacy activity marker.

Known duplicate events are suppressed. There is no external exactly-once
delivery guarantee, telemetry outbox, or second analytics database. Browser
closure may leave a Journey incomplete; canonical game records remain the
source of results. Unit tests and the local adapter replace the SDK transport
and cannot report real ingestion.

A very short activity can finish or be canceled before its Start request reaches
the server. The server rejects a Start for a no-longer-active activity, so that
Journey can be absent. This is best-effort analytics, not an audit of every game.

## Validation and release gates

- [x] Tests cover lifecycle, canonical outcomes, replay/stale response races,
      storage failure, idle resume, rematches, queue cancellation/pairing races,
      challenge retry/back/abandon/replacement, receipt categories, timeouts,
      payload limits, tampering, and no passive starts.
- [x] Correctness, security, duplicate code, and hot-path review is clean.
- [x] Full tests with bounded workers, type checking, lint, production/local
      builds, dependency checks, local-adapter checks, and Devvit packaging pass.
- [x] Uploaded version 0.2.37 is installed on `r/ripred_euclid_dev`.
- [x] Version 0.2.37 is installed on `r/EuclidTheGame`,
      the user's requested deployment and live-verification target.
      Version 0.2.36 is the pre-change rollback baseline.
- [x] Version 0.2.38 was submitted for unlisted review with its source and
      Journey map. Reddit readback confirms PENDING, UNLISTED, and build READY.
- [ ] Reddit approves 0.2.38; install that approved version on `r/EuclidTheGame`
      and recheck real Journey receipts.
- [ ] Deployed gameplay smoke checks are complete.
- [ ] Real gameplay produces representative `JOURNEY_RECEIPT_VALID` receipts
      for Ready, Start, Progress, Interaction, and End, including a queue cancel
      and a real two-player match/rematch. HTTP 200 alone is insufficient.
- [ ] Native dashboard evidence appears after aggregation. Screenshots occur
      only during final deployed verification, with approval before each;
      Firefox is foregrounded explicitly and the original iTerm2 window restored.

Local validation on 2026-09-29: 1,303 tests across 80 suites, 18 dependency checks,
23 local-adapter checks, and a real local HTTP smoke test passed. The smoke test
confirmed canonical solo play, disabled telemetry receipts, and the 2 KB request
limit. Production bundles contain neither local telemetry substitutes nor PostHog.

Live verification on 2026-09-29: Reddit's installation readback confirms 0.2.37
on `r/EuclidTheGame`. The existing three community posts were retained and setup
completed. Firefox loaded the pinned game and its expanded app. The first real
App.Ready returned `JOURNEY_RECEIPT_DENIED_PLAYTEST`, so ingestion and dashboard
acceptance remain unverified. Version readback identifies 0.2.37 as PRIVATE (an
uploaded, unpublished app version). Reddit's telemetry schema describes this
denial in terms of the app version, not subreddit privacy. The backend predicate
is not public; publishing an approved unlisted release is the next release-path
candidate, not a guarantee of Journeys activation. No local playtest process was
running.

The unlisted submission completed at 2026-09-29 09:04 UTC. Owner-visible review
request `6d361b64-5a3e-48d1-86b5-ccb9bfaa25d8` is PENDING for version 0.2.38
(`9feab3da-e9b2-4216-81b8-82d2c3a5bbad`), with build READY and source present.
The version remains PRIVATE until Reddit approves it. The publication command
did not replace the installed 0.2.37 build. No public listing was requested.

Committing and pushing the implementation does not establish live acceptance.
A denied-not-allowlisted receipt leaves activation pending; retain this map and
diagnostic evidence for Reddit's review.

Reddit's dashboard reports daily app aggregates and offers a 30-day CSV; a
per-mode funnel UI and an ingestion-latency SLA are not documented. Developer
diagnostics distinguish accepted, disabled, playtest, denied, invalid, duplicate,
and unknown receipts without claiming that a successful HTTP request was ingested.

References: [Journeys](https://developers.reddit.com/docs/capabilities/analytics/devvit-journeys),
[receipts](https://developers.reddit.com/docs/capabilities/analytics/journeys-receipts),
[dashboard](https://developers.reddit.com/docs/capabilities/analytics/journeys-dashboard).
