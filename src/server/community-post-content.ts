const GAME_DESCRIPTION =
  "Euclid is a strategy game about placing dots and completing squares. Open the post on reddit.com to play.";

export function gamePostContent(imageUrl?: string) {
  // Put the image link first for Reddit preview extraction. Regular Markdown
  // also preserves the complete body on old Reddit and custom fallbacks.
  return {
    text: imageUrl
      ? `[Euclid](${imageUrl})\n\n${GAME_DESCRIPTION}`
      : GAME_DESCRIPTION,
  };
}
