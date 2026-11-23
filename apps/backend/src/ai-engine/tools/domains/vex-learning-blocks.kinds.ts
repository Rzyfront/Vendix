/**
 * Block kind each help-center "show in chat" tool produces
 * (`vex-learning-blocks.tools.ts`). Read by the stream (`ui_block` frame) and
 * by the sync path that recovers block refs from the tool trace, so both see
 * the same kinds.
 */
export const VEX_LEARNING_BLOCK_KIND: Readonly<
  Record<string, 'video' | 'help_article' | 'learning_path'>
> = {
  vex_show_help_video: 'video',
  vex_show_help_article: 'help_article',
  vex_show_learning_path: 'learning_path',
};

/** Kind for a show-in-chat tool name, or null for any other tool. */
export function vexLearningBlockKind(
  toolName: string,
): 'video' | 'help_article' | 'learning_path' | null {
  return Object.prototype.hasOwnProperty.call(VEX_LEARNING_BLOCK_KIND, toolName)
    ? VEX_LEARNING_BLOCK_KIND[toolName]
    : null;
}
