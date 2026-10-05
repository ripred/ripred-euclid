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

/** Retained to recognize existing text hubs before updating them in place. */
export const RESULT_HUB_HEADING = "About this post";

export const RESULT_HUB_DESCRIPTIONS: Record<
  keyof typeof RESULT_HUB_TITLES,
  string
> = {
  ai: "Finished games against Euclid, the computer opponent, shared by the Redditors who played them. Browse the results in the comments below, newest first.",
  h2h: "Finished matches between two Redditors, shared by their winners. Browse the results in the comments below, newest first.",
};

/** Both generations are ordinary text posts; presentation changes must not replace them. */
export const isResultHubText = (body: string | null | undefined): boolean =>
  typeof body === "string" &&
  (body.includes(RESULT_HUB_HEADING) ||
    Object.values(RESULT_HUB_DESCRIPTIONS).some((description) =>
      body.includes(description),
    ));

/**
 * An ordinary text post with an inline banner and one short description.
 * Reddit's rich-text representation preserves the embedded image in the body.
 */
export function resultHubBody(
  kind: keyof typeof RESULT_HUB_TITLES,
  gamePermalink: string,
  bannerUrl?: string,
) {
  return {
    document: [
      ...(bannerUrl ? [{ e: "img", mediaUrl: bannerUrl }] : []),
      {
        e: "par",
        c: [
          { e: "text", t: `${RESULT_HUB_DESCRIPTIONS[kind]} ` },
          {
            e: "link",
            t: "Play Euclid",
            u: new URL(gamePermalink, "https://www.reddit.com").href,
          },
        ],
      },
    ],
  };
}
