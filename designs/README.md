# Euclid UI style explorations

Static mockups of alternative presentations for the stand-alone game. Every image
shows the same mid-game position (8×8, Grid Footprint, move 25, You 27 – Euclid 29),
so the styles compare like for like. None of these are implemented yet.

| # | Direction | Image |
| --- | --- | --- |
| 01 | Breeze — pastel, airy | [01-breeze.png](01-breeze.png) |
| 02 | Swiss — International Typographic | [02-swiss.png](02-swiss.png) |
| 03 | Kaya — wood, stone and ink | [03-kaya.png](03-kaya.png) |
| 04 | Blueprint — drafting sheet | [04-blueprint.png](04-blueprint.png) |
| 05 | Brutal — neo-brutalist | [05-brutal.png](05-brutal.png) |
| 06 | Orbital — glass in perspective | [06-orbital.png](06-orbital.png) |
| 07 | Deco — black, gold and jade | [07-deco.png](07-deco.png) |
| 08 | Riso — two-ink zine print | [08-riso.png](08-riso.png) |
| 09 | Phosphor — green-screen terminal | [09-phosphor.png](09-phosphor.png) |
| 10 | Paper — cut-paper craft | [10-paper.png](10-paper.png) |
| 11 | Great Wave — ukiyo-e woodblock | [11-great-wave.png](11-great-wave.png) |
| 12 | Cubist — after Picasso | [12-cubist.png](12-cubist.png) |
| 13 | Elements — Byrne's Euclid (earlier, passed) | [13-elements.png](13-elements.png) |
| 14 | EU-8 grid instrument (earlier) | [14-instrument.png](14-instrument.png) |

`source/` holds each mockup as a Design Component (`.dc.html`) file. Mockups 13
and 14 were playable prototypes; the images show their opening position.

`tools/render.mjs` re-renders the sources to 2× PNGs with a minimal template
runtime and Playwright:

```bash
node designs/tools/render.mjs <out-dir> designs/source/*.dc.html
```

It needs `playwright-core` and a Chromium executable; adjust `executablePath`
in the script for your machine.
