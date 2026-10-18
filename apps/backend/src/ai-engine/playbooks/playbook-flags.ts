/** Shared C gate without loader/registry/DI imports. Only the literal true opts in. */
export const playbooksEnabled = (): boolean =>
  process.env.AI_AGENT_PLAYBOOKS_ENABLED === 'true';
