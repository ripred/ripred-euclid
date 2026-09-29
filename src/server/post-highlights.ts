import {
  type LinksAndComments,
  LinksAndCommentsDefinition,
} from "@devvit/protos/types/devvit/plugin/redditapi/linksandcomments/linksandcomments_svc.js";
import {
  type Subreddits,
  SubredditsDefinition,
} from "@devvit/protos/types/devvit/plugin/redditapi/subreddits/subreddits_svc.js";
import { getDevvitConfig } from "@devvit/shared-types/server/get-devvit-config.js";
import { context } from "@devvit/web/server";
import { isRecord } from "../shared/guards";

/** False means this runtime does not implement the SDK's highlight RPCs. */
export async function ensurePostHighlighted(postId: string): Promise<boolean> {
  const subredditId = context.subredditId;
  if (!subredditId)
    throw new Error("Subreddit context is required for highlights.");
  const client = getDevvitConfig().use<LinksAndComments>(
    LinksAndCommentsDefinition,
  );
  const subreddits = getDevvitConfig().use<Subreddits>(SubredditsDefinition);
  const isHighlighted = async () => {
    const { highlightedPosts } = await subreddits.GetHighlightedPosts(
      { subredditId },
      context.metadata,
    );
    return highlightedPosts.some((post) => post.postId === postId);
  };
  try {
    if (!(await isHighlighted())) {
      await client.AddPostToHighlights({ postId }, context.metadata);
      if (!(await isHighlighted()))
        throw new Error(`Reddit did not highlight ${postId}`);
    }
    return true;
  } catch (error) {
    const code = isRecord(error) ? error.code : undefined;
    if (
      code === 12 ||
      (typeof code === "string" && code.toLowerCase() === "unimplemented")
    )
      return false;
    throw error;
  }
}
