# Euclid

A strategy game of squares, played against a computer opponent named Euclid.

Take turns placing one piece on an open point. Own all four corners of a square to score it. Squares can lean at any angle, bigger squares score more, and one move can finish several at once. The first player to the target score wins. It takes a minute to learn and a lifetime to master.

This is the stand-alone edition: a single-player web app that runs in any current browser on any operating system. It needs no account, no server and no network connection. Everything it remembers stays in the browser that plays it.

## Play

There are three ways to play:

- **Open one file.** `npm run build` produces `dist/index.html`, a single self-contained page with the game, its styles, its font and its artwork inside. Copy it anywhere and open it in a browser, straight from disk. Nothing else is required.
- **Host it.** Upload the contents of `dist/` to any static web host. Paths are relative, so the game works from a domain root or a subfolder.
- **Install it.** Served over HTTPS, Euclid is an installable web app: use the browser's _Install_ or _Add to Home Screen_ option. After the first visit it keeps working offline.

Euclid supports current versions of Chrome, Edge, Firefox and Safari on desktop, iOS and Android. It uses no browser plug-ins and asks for no permissions.

## How to play

1. Players alternate placing one piece on any empty point. Red moves first.
2. Four of your pieces at the corners of a square score that square. Tilted squares count, and points inside or along an edge do not matter.
3. One move can complete several squares; each scores once.
4. Reach the target score to win. If the board fills first, the higher score wins; equal scores tie.

Two scoring rules are available in Practice:

- **Grid Footprint** (the default) counts the points along one side of the square's upright bounding box, then squares that number. The smallest upright square scores 4; a one-step diamond scores 9. Tilted squares punch above their size.
- **True Area** scores a square's real area, so a square is worth exactly what it covers.

### Fading pieces

An optional Practice rule, set in **Options**, from Off to 4–8 turns. Each stone lasts that many of its owner's turns, counting the turn it was placed, and thins out as it ages. An unfinished stone washes away just before its owner's next turn after its last. Completing a square anchors all four of its corners for the rest of the game. A dashed ring marks a stone in its owner's final turn.

Four turns is the shortest setting because a new square needs four stones placed on four of its owner's turns. Since stones keep clearing, a fading game also ends after twice as many moves as the board has points; the higher score then wins. Euclid knows the rule and does not chase squares whose corners will wash away first.

## Modes

| Mode         | Rules                                                                                                         | Records                    |
| ------------ | ------------------------------------------------------------------------------------------------------------- | -------------------------- |
| **Practice** | Any even board from 4×4 to 16×16, either scoring rule, any target, nine Euclid styles, optional fading pieces | Wins, losses and ties      |
| **Ranked**   | Fixed: 8×8, Grid Footprint, first to 150, you move first, Euclid plays Tenderfoot, no hints, no fading        | An Elo rating and a record |

- **Euclid's styles** run from Doofus to Brutal, chosen on a slider in **Options**. Each changes how often Euclid overlooks your threats and its own opportunities. Brutal never does: it always takes the biggest square it can score or deny.
- **Ranked ratings** start at 1,200 and move against Euclid's fixed reference rating of 1,600 with a K-factor of 32. Canceling a Ranked game before your first move costs nothing; leaving after it is a forfeit and counts as a loss, so a losing position can never be erased.
- **Square hints** (Practice only) highlight the points that would finish one of your squares in one or two moves.
- **The demo** replays a full recorded game, narrated in six lessons, for anyone who would rather watch before playing.

A game in progress is saved after every move. Close the tab, come back later, and **Continue** from the home screen.

## Your data

Euclid stores four things in the browser's local storage: your settings, your records, the game in progress and whether you have seen the first-game tutorial. Nothing is sent anywhere. Clearing the site's data resets the game; **Options › Reset records** clears only the records. If storage is unavailable (for example in some private windows), the game still plays and simply forgets on close.

## Accessibility

- Every point on the board is a keyboard control: arrow keys move, Home and End jump along a row, and Enter or Space places a piece. A key only places a piece if it was pressed after your turn began, so keystrokes never queue ahead of a move.
- On touch screens with small points, the first tap aims and a second tap on the same point places.
- Dialogs contain focus and close with Escape. Sounds are off until you turn them on.
- Reduced-motion preferences remove animation and confetti.
- The light and dark themes follow the device by default and can be fixed in **Options**. The board looks the same in both.

## Development

Requires Node.js 24 and npm.

```bash
npm ci
npm run dev        # development server at http://localhost:5173
npm run check      # type-check, lint, formatting and tests
npm run build      # the self-contained game in dist/
npm run preview    # serve dist/ at http://localhost:4173
```

The build inlines the script, stylesheet, favicon and the Latin subset of the Archivo font into `dist/index.html`; `dist/` also holds the web-app manifest, the offline service worker and the app icons. The service worker registers only over HTTPS (or `localhost`), never from disk.

App icons are drawn from the game's own board components. With `npm run dev` running, open `http://localhost:5173/src/dev/icons.html` and choose **Export icons** to rewrite `public/icons/`.

### Layout

```text
index.html               Entry page and app metadata
public/                  Web-app manifest, service worker and icons
src/
  main.tsx               Mounts the app; registers the service worker
  App.tsx                Screens, turns, results, saving and settings
  game/                  Rules engine, Euclid's move policy, scoring and board types
  solo/                  One game against Euclid, ratings and records, result copy
  storage.ts             Validated local storage
  settings.ts            Player settings and Practice rules
  home-screen.tsx        Home: play, continue, demo and records
  game-screen.tsx        The board, scores, results and confetti
  setup-screen.tsx       Options: Practice rules, hints and theme
  demo-screen.tsx        The narrated demo game
  how-to-play.tsx        Illustrated rules
  demo/                  The recorded teaching game and its replay frames
  sound/                 Synthesized sound effects
  ui/                    Board renderer, brand art, dialogs and shared controls
  design/                Design tokens and base styles
  dev/                   Development-only icon exporter
```

Tests live beside the code as `*.spec.ts(x)` and run with Vitest; the app-level flows run in jsdom.

## License

MIT. See [LICENSE](LICENSE). The Archivo typeface is distributed under the SIL Open Font License through `@fontsource-variable/archivo`.
