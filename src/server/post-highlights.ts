import {
  type LinksAndComments,
  LinksAndCommentsDefinition,
} from "@devvit/protos/types/devvit/plugin/redditapi/linksandcomments/linksandcomments_svc.js";
import { getDevvitConfig } from "@devvit/shared-types/server/get-devvit-config.js";
import { context } from "@devvit/web/server";
import { isRecord } from "../shared/guards";

/** False means this runtime does not implement the SDK's highlight RPCs. */
export async function ensurePostHighlighted(postId: string): Promise<boolean> {
  const client = getDevvitConfig().use<LinksAndComments>(
    LinksAndCommentsDefinition,
  );
  try {
    const { isHighlighted } = await client.GetIsPostHighlighted(
      { postId },
      context.metadata,
    );
    if (!isHighlighted) {
      await client.AddPostToHighlights({ postId }, context.metadata);
      const added = await client.GetIsPostHighlighted(
        { postId },
        context.metadata,
      );
      if (!added.isHighlighted)
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
