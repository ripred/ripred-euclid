import { context, reddit } from "@devvit/web/server";
import { communityPostStyles } from "../post-presentation";
import { gamePostContent } from "../community-post-content";

/** Resolve fallible prerequisites before reserving a remote post submission. */
export const prepareGamePost = async () => {
  const { subredditName } = context;
  if (!subredditName) {
    throw new Error("subredditName is required");
  }

  const styles = await communityPostStyles();
  const options = {
    styles,
    textFallback: gamePostContent(styles.shareImageUrl),
    subredditName,
    title: "Euclid",
  };
  return () => reddit.submitCustomPost(options);
};

export const createPost = async () => (await prepareGamePost())();
