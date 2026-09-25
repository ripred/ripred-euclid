/* global window */
/**
 * Local-only stand-in for `@devvit/web/client`. Reddit expands an inline post
 * into a named entrypoint; locally that is a same-tab navigation to the
 * matching HTML document.
 */
const ENTRY_DOCUMENTS = {
  default: "preview.html",
  game: "index.html",
  solo: "solo.html",
  reddit: "reddit.html",
  leaderboard: "leaderboard.html",
  watch: "watch.html",
};

export async function requestExpandedMode(_event, entry) {
  window.location.assign(`/${ENTRY_DOCUMENTS[entry] ?? "index.html"}`);
}
