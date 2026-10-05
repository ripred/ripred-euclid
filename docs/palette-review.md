# Amber and amethyst review

This is an opt-in visual proposal. Red and blue remain the default build, and both palettes retain the same player indices, game rules, scores and saved data.

The proposed palette uses warm amber (`#FBB80F`) and deep amethyst (`#5E3478`). Lighter square edges, darker hint rings and separate light/dark text colors keep the pieces and controls readable against the existing graphite board. The community mark uses a complete tilted square with an open center. Both banners reuse the original red/blue banner geometry: identical piece and square sizes, counts, positions, dimensions and crop, with only the palette changed. The icon and entry splash retain their separate proposed compositions.

## Compare the artwork

| Current                                                                        | Proposed                                                                                 |
| ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| ![Current community icon](../subreddit/images/euclid_board_icon_300.png)       | ![Proposed community icon](../subreddit/images/euclid_amber_amethyst_icon_300.png)       |
| ![Current desktop banner](../subreddit/images/euclid_board_banner_desktop.png) | ![Proposed desktop banner](../subreddit/images/euclid_amber_amethyst_banner_desktop.png) |
| ![Current mobile banner](../subreddit/images/euclid_board_banner_mobile.png)   | ![Proposed mobile banner](../subreddit/images/euclid_amber_amethyst_banner_mobile.png)   |

The [proposed entry splash](../src/client/public/splash-amber-amethyst.jpg) keeps the heading and button areas quiet. It is supplied as a separate candidate; existing public artwork files are preserved.

## Preview and export

```bash
VITE_COLOR_SCHEME=amber-amethyst npm run dev:local
```

Open `/dev/brand-assets.html` to compare the current and proposed icon, desktop banner, mobile banner and splash. **Export proposal** writes only the separate amber/amethyst files. The page links to the inline game preview and expanded app.

The supported build values are `red-blue` and `amber-amethyst`. Omission selects `red-blue`; unsupported values fail explicitly. This setting selects both player names and rendering tokens. Reddit's light/dark appearance remains independent.

```bash
VITE_COLOR_SCHEME=red-blue npm run build
VITE_COLOR_SCHEME=amber-amethyst npm run build
```

## Community colors

The staging community uses these seeds in Reddit's **Community appearance** settings:

| Setting           | Seed      | Role                                          |
| ----------------- | --------- | --------------------------------------------- |
| Key color         | `#5E3478` | Amethyst navigation links and primary buttons |
| Base color        | `#706B76` | Nearly neutral graphite surfaces and borders  |
| Pinned post color | `#D9A626` | Muted amber highlights for pinned posts       |

Reddit derives the rendered shades from these seeds for light and dark modes, so the displayed colors can differ from the entered hex values. These controls do not change Reddit's native vote colors. The banner, icon and in-game player palette are configured separately.

To restore the previous community colors, choose **Reset to Default** for each of these three settings, return to the appearance overview and save. This does not require changing the installed app version or artwork. Check both light and dark views after any color update; platform-owned button text is not independently configurable.

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

Choosing the theme for a future default release remains a separate decision.
