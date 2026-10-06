# Amber and amethyst review

Amber and amethyst are the default player palette. Red and blue remain available as an explicit compatibility build, and both palettes retain the same player indices, game rules, scores and saved data.

The proposed palette uses warm amber (`#FBB80F`) and deep amethyst (`#5E3478`). Lighter square edges, darker hint rings and separate light/dark text colors keep the pieces and controls readable against the existing graphite board. The community mark uses a complete tilted square with an open center. Both banners reuse the original red/blue banner geometry: identical piece and square sizes, counts, positions, dimensions and crop, with only the palette changed. The icon and entry splash retain their separate proposed compositions.

The app's purple-first interface uses amethyst for primary actions, menu emphasis, lesson progress, switches, difficulty controls and focus indicators. These semantic interface accents are independent of the two board players: player one remains amber and player two remains amethyst. Gold still marks awards and wins, and warning colors retain their existing meaning.

## Compare the artwork

| Current                                                                        | Proposed                                                                                 |
| ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| ![Current community icon](../subreddit/images/euclid_board_icon_300.png)       | ![Proposed community icon](../subreddit/images/euclid_amber_amethyst_icon_300.png)       |
| ![Current desktop banner](../subreddit/images/euclid_board_banner_desktop.png) | ![Proposed desktop banner](../subreddit/images/euclid_amber_amethyst_banner_desktop.png) |
| ![Current mobile banner](../subreddit/images/euclid_board_banner_mobile.png)   | ![Proposed mobile banner](../subreddit/images/euclid_amber_amethyst_banner_mobile.png)   |

The [proposed entry splash](../src/client/public/splash-amber-amethyst.jpg) shows sparse completed shapes on the board. It is supplied as a separate candidate; existing public artwork files are preserved.

## Preview and export

```bash
VITE_COLOR_SCHEME=amber-amethyst npm run dev:local
```

Open `/dev/brand-assets.html` to compare the current and proposed icon, desktop banner, mobile banner and splash. **Export current** writes the existing red/blue paths, while **Export proposal** writes only the separate amber/amethyst files. The page links to the inline game preview and expanded app.

The supported build values are `red-blue` and `amber-amethyst`. Omission selects `amber-amethyst`; unsupported values fail explicitly. This setting selects both player names and rendering tokens. Reddit's light/dark appearance remains independent.

```bash
npm run build
VITE_COLOR_SCHEME=red-blue npm run build
```

## Community colors

The purple-first staging community uses these seeds in Reddit's **Community appearance** settings:

| Setting           | Seed      | Role                                          |
| ----------------- | --------- | --------------------------------------------- |
| Key color         | `#5E3478` | Amethyst navigation links and primary buttons |
| Base color        | `#6F6579` | Subtle graphite-violet surfaces and borders   |
| Pinned post color | `#5E3478` | Amethyst highlights for pinned posts          |

Reddit derives the rendered shades from these seeds for light and dark modes, so the displayed colors can differ from the entered hex values. These controls do not change Reddit's native vote colors. The banner, icon and in-game player palette remain unchanged; gold is retained in the artwork rather than the surrounding post surfaces. The previous amber-led preset used base `#706B76` and pinned-post color `#D9A626`, with the same key color.

To restore Reddit's original default colors, choose **Reset to Default** for each of these three settings, return to the appearance overview and save. This does not require changing the installed app version or artwork. Check both light and dark views after any color update; platform-owned button text is not independently configurable.

## Review deployment

Use `r/ripred_euclid_dev` as staging. Record the currently installed versions and preserve the existing artwork for both communities before making changes. After the checks pass, upload the proposed palette once and install that version in staging:

```bash
VITE_COLOR_SCHEME=amber-amethyst npm run deploy
npx devvit view ripred-euclid@<uploaded-version>
npx devvit install ripred_euclid_dev ripred-euclid@<uploaded-version>
npx devvit list installs ripred_euclid_dev
```

Verify the installed staging version, gameplay, layout and palette before promoting the same uploaded version to `r/EuclidTheGame`:

```bash
npx devvit install EuclidTheGame ripred-euclid@<uploaded-version>
npx devvit list installs EuclidTheGame
```

Installing an app version does not change community appearance. The proposed 300×300 icon, 3168×256 desktop banner and 1592×128 mobile banner are separate moderator uploads. Apply and verify those appearance updates in staging first, then in `r/EuclidTheGame`. Preserve the previous appearance and app version when comparing, and restore them independently if reverting the proposal.

Red and blue can still be built explicitly for comparison or rollback.
