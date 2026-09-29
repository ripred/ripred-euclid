import { context, reddit } from "@devvit/web/server";
import { communityPostStyles } from "../post-presentation";

/** Resolve fallible prerequisites before reserving a remote post submission. */
export const prepareGamePost = async () => {
  const { subredditName } = context;
  if (!subredditName) {
    throw new Error("subredditName is required");
  }

  const options = {
    styles: await communityPostStyles(),
    textFallback: {
      text: "Euclid is a strategy game about placing dots and completing squares. Open the post on reddit.com to play.",
    },
    subredditName,
    title: "Euclid",
  };
  return () => reddit.submitCustomPost(options);
};

export const createPost = async () => (await prepareGamePost())();
