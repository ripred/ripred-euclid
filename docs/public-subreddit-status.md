# Public Subreddit Relaunch Status (Euclid)

## Why this exists
The game has gone through several refactors, and we now need a clear snapshot of where the **public-facing subreddit experience** stands.

This document reflects the current implementation in this branch.

## Current architecture for the public subreddit

### 1) The app now supports two post modes
- **Game post mode (`type: "init"`)**: the standard playable Euclid experience.
- **Share post mode (`type: "share"`)**: a read-only, presentation-oriented view for leaderboard and win-result shares.

The mode is selected during `/api/init` based on `postData` (share descriptor) embedded in the custom post.

### 2) Sharing is implemented server-side with persistent payloads
- Share payloads are saved to Redis with a generated UUID.
- The share post stores only a lightweight descriptor (`shareType`, `shareId`) as `postData`.
- On open, `/api/init` resolves the descriptor and loads the full payload from Redis.

This supports compact custom posts while allowing richer share rendering.

### 3) Share publishing has user-first auth with app fallback
`createCustomSharePost()` attempts to publish as `USER` first, then falls back to `APP` if needed.

This is useful for public rollout because sharing can continue even when user-scope posting fails due to permission or platform constraints.

### 4) A “Play New Game!” sidebar button is auto-managed
On game-post initialization, `ensureSidebarPlayWidget(postId)`:
- creates or updates a button widget named `Euclid`,
- points it to the canonical game post permalink,
- and reorders sidebar widgets so it appears at the top.

This is the strongest signal in code that the subreddit homepage flow has been redesigned around a single launch post + sidebar CTA model.

### 5) Public share types currently supported
- **Leaderboard shares** (`/api/share/rankings`) for both buckets:
  - `hvh` (Redditor vs Redditor)
  - `hva` (Redditor vs Euclid)
- **Human-vs-human win shares** (`/api/share/h2h-result`)
- **Human-vs-AI win shares** (`/api/share/ai-result`)

All share routes include rate limiting and return permalink metadata for UX follow-up.

### 6) Share rendering is implemented in both runtime and local preview
- Runtime shared-post rendering lives in `App.tsx` (`SharedPostView`).
- Design-aligned preview rendering lives in `share-preview.tsx` for standalone visual verification.

## What appears outdated after refactors

### `README.md` still points to the dev subreddit as “Live Game”
The current README markets `r/ripred_euclid_dev` as live production, which no longer matches the “public subreddit under construction” direction.

### `docs/share-post-examples/index.html` is stale
The page currently says share-post concepts are “not wired to the app.”
That is no longer true: share posting and rendering are wired and live in code.

## Public-subreddit readiness checklist (recommended next sequence)

1. **Decide canonical public subreddit name** and update top-level docs.
2. **Create and pin the canonical game post** via moderator menu (`Create Euclid Game Post`).
3. **Validate sidebar widget behavior** in that subreddit (creation, update, ordering).
4. **Smoke-test share publishing** for all 3 share routes from production-like accounts.
5. **Verify share payload retention policy** in Redis (TTL vs indefinite storage).
6. **Define migration/comms plan** from dev subreddit to public subreddit.

## Known product decisions still needed
- Whether share payloads should expire and after how long.
- Whether leaderboard share posts should include stronger anti-staleness cues.
- Whether one canonical game post is sufficient, or if periodic rotating game posts are preferred.

## TL;DR
The new public-facing subreddit design is **mostly implemented in code**: custom share posts, descriptor-based init routing, and automatic sidebar “Play New Game!” entry are all present. The largest gap is now **operational/documentation alignment**, not core feature plumbing.
