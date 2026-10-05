import type { RESULT_HUB_TITLES } from "../shared/result-sharing";

const GAME_SUMMARY =
  "Euclid is a strategy game about placing dots and completing squares.";
const GAME_DESCRIPTION = `${GAME_SUMMARY} Open the post on reddit.com to play.`;

export function gamePostContent(imageUrl?: string) {
  // Put the image link first for Reddit preview extraction. Regular Markdown
  // also preserves the complete body on old Reddit and custom fallbacks.
  return {
    text: imageUrl
      ? `[Euclid](${imageUrl})\n\n${GAME_DESCRIPTION}`
      : GAME_DESCRIPTION,
  };
}

/**
 * Every current result hub body has this heading. Older hubs, including the
 * first text hubs, never did, so setup can tell them apart.
 */
export const RESULT_HUB_HEADING = "About this post";

const HUB_CONTENTS: Record<
  keyof typeof RESULT_HUB_TITLES,
  { results: string; share: string }
> = {
  ai: {
    results:
      "finished games against Euclid, the computer opponent, shared by the Redditors who played them",
    share: "after a win or loss",
  },
  h2h: {
    results: "finished matches between two Redditors, shared by their winners",
    share: "after you win a match",
  },
};

const text = (t: string) => ({ e: "text", t });

/**
 * The rich-text body of a result hub. The community icon comes first, so
 * Reddit can use it as the post's thumbnail in collapsed feed views.
 */
export function resultHubBody(
  kind: keyof typeof RESULT_HUB_TITLES,
  gamePermalink: string,
  iconUrl?: string,
) {
  const { results, share } = HUB_CONTENTS[kind];
  return {
    document: [
      ...(iconUrl ? [{ e: "img", mediaUrl: iconUrl }] : []),
      { e: "h", l: 2, c: [{ e: "raw", t: RESULT_HUB_HEADING }] },
      {
        e: "par",
        c: [
          text(
            `${GAME_SUMMARY} This post collects ${results}. Each comment is one result, newest first.`,
          ),
        ],
      },
      {
        e: "par",
        c: [
          text("The post is locked, so only the Euclid app adds results. "),
          {
            e: "link",
            t: "Play Euclid",
            u: new URL(gamePermalink, "https://www.reddit.com").href,
          },
          text(` and choose Share result ${share} to add yours.`),
        ],
      },
    ],
  };
}
