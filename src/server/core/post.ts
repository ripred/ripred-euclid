import { context, reddit } from '@devvit/web/server';

export const createPost = async () => {
  const { subredditName } = context;
  if (!subredditName) {
    throw new Error('subredditName is required');
  }

  return await reddit.submitCustomPost({
    textFallback: {
      text: 'Euclid is a strategy game about placing dots and completing squares. Open the post on reddit.com to play.',
    },
    subredditName: subredditName,
    title: 'Euclid',
  });
};
