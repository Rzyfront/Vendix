/**
 * Tools that exist only on the Vex surface (/admin/vex).
 *
 * `vex_*` block tools are matched by prefix; the rest are listed here by exact
 * name. Offering them to Vexi would call a tool whose result its panel cannot
 * show, so a surface tool of another agent is never part of that agent's
 * authority (mirror of the Vex row denying `ui_*`).
 */
export const VEX_ONLY_TOOL_NAMES: ReadonlySet<string> = new Set([
  'suggest_followup',
  // F4 T31: store memory is Vex-only (D7); the turn injects conversation_id so
  // the purge of a conversation can delete the memories born in it.
  'remember',
  'forget',
]);

export function isVexOnlyTool(name: string): boolean {
  return name.startsWith('vex_') || VEX_ONLY_TOOL_NAMES.has(name);
}

export function isForeignSurfaceTool(name: string, agentKey?: string): boolean {
  return agentKey !== 'vex' && isVexOnlyTool(name);
}

/**
 * Tools whose `conversation_id` is always the turn's (H6). `remember` ties a
 * memory to the conversation whose purge may delete it, so a model-chosen id
 * would bind it to another conversation of the store.
 */
const TURN_CONVERSATION_TOOL_NAMES: ReadonlySet<string> = new Set(['remember']);

/**
 * Tool arguments with the conversation the turn owns. `remember` always gets
 * the turn's id (or none when the turn has no conversation); the other
 * Vex-only tools get it only as a default when the model sent no integer.
 */
export function withTurnConversationId(
  name: string,
  args: Record<string, unknown>,
  turnConversationId: number | null | undefined,
): Record<string, unknown> {
  if (TURN_CONVERSATION_TOOL_NAMES.has(name)) {
    const rest = { ...args };
    delete rest.conversation_id;
    return turnConversationId != null
      ? { ...rest, conversation_id: turnConversationId }
      : rest;
  }
  if (
    isVexOnlyTool(name) &&
    turnConversationId != null &&
    !Number.isInteger(args.conversation_id)
  ) {
    return { ...args, conversation_id: turnConversationId };
  }
  return args;
}
