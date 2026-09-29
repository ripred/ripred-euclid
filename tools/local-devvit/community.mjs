import { COMMUNITY_POSTS_KEY } from "../../src/server/community-post-keys.ts";
import { RESULT_HUB_TITLES } from "../../src/shared/result-sharing.ts";

const LOCAL_ICON = "https://i.redd.it/localicon.png";
const reject = (message, code = "invalid_argument") =>
  Object.assign(new Error(message), { code });

/** Process-local Reddit fixtures. No operation in this adapter uses the network. */
export function createLocalCommunity({
  subredditName = "euclid_local",
  appSlug = "euclid",
  currentUsername = () => "local_player",
  maxPosts = 100,
  maxComments = 1000,
} = {}) {
  if (
    !Number.isSafeInteger(maxPosts) ||
    maxPosts < 3 ||
    !Number.isSafeInteger(maxComments) ||
    maxComments < 1
  )
    throw new RangeError(
      "Local community limits must allow its three posts and comments.",
    );
  const posts = new Map();
  const comments = new Map();
  let postCounter = 0;
  let commentCounter = 0;

  function addPost(id, options) {
    if (posts.size >= maxPosts)
      throw reject("Local post limit reached; restart the local server.");
    if (JSON.stringify(options).length > 100_000)
      throw reject("Local post exceeds the fixture size limit.");
    const permalink = `/r/${subredditName}/comments/${id.slice(3)}/`;
    const post = {
      ...structuredClone(options),
      id,
      permalink,
      url: `http://localhost${permalink}`,
      authorName: options.runAs === "USER" ? currentUsername() : appSlug,
      locked: options.locked ?? false,
      async lock() {
        post.locked = true;
      },
      async setSuggestedCommentSort(sort) {
        post.suggestedCommentSort = sort;
      },
    };
    posts.set(id, post);
    return post;
  }

  function getPost(id) {
    const post = posts.get(id);
    if (!post) throw reject("Local post not found.", "not_found");
    return post;
  }

  const game = addPost("t3_local", {
    title: "Euclid",
    styles: { shareImageUrl: LOCAL_ICON },
  });
  const registry = { game: game.id, gamePermalink: game.permalink };
  for (const [kind, title] of Object.entries(RESULT_HUB_TITLES)) {
    const hub = addPost(`t3_local${kind}hub`, {
      title,
      locked: true,
      suggestedCommentSort: "NEW",
      text: `Local result comments. Play Euclid at ${game.permalink}`,
    });
    registry[kind] = hub.id;
  }

  const submitPost = async (options) =>
    addPost(`t3_local${++postCounter}`, options);
  return {
    posts,
    comments,
    registry,
    async seed(redis) {
      await redis.set(COMMUNITY_POSTS_KEY, JSON.stringify(registry), {
        nx: true,
      });
    },
    reddit: {
      submitCustomPost: submitPost,
      submitPost,
      async getPostById(id) {
        return getPost(id);
      },
      getNewPosts({ limit = 100 } = {}) {
        return {
          all: async () =>
            [...posts.values()]
              .reverse()
              .slice(0, Math.max(0, Math.min(limit, 100))),
        };
      },
      async getPostData(id) {
        return structuredClone(getPost(id).postData);
      },
      async getPostStyles(id) {
        return structuredClone(getPost(id).styles ?? {});
      },
      async setPostStyles(id, styles) {
        getPost(id).styles = structuredClone(styles);
      },
      async getSubredditStyles() {
        return { icon: LOCAL_ICON };
      },
      async submitComment({ id, text, runAs = "USER" }) {
        const post = getPost(id);
        if (runAs !== "APP" && post.locked)
          throw reject(
            "This local result hub is locked to ordinary comments.",
            "permission_denied",
          );
        if (typeof text !== "string" || !text.trim() || text.length > 10_000)
          throw reject("Local comments must contain 1–10000 characters.");
        if (comments.size >= maxComments)
          throw reject(
            "Local comment limit reached; restart the local server.",
          );
        const commentId = `t1_local${++commentCounter}`;
        const comment = {
          id: commentId,
          postId: id,
          text,
          authorName: runAs === "APP" ? appSlug : currentUsername(),
          permalink: `${post.permalink}${commentId.slice(3)}/`,
        };
        comments.set(commentId, comment);
        return structuredClone(comment);
      },
    },
    media: {
      async upload() {
        // Deliberately ignore remote sources: the URL is synthetic and no upload occurs.
        return { mediaId: "local_icon", mediaUrl: LOCAL_ICON };
      },
    },
  };
}
