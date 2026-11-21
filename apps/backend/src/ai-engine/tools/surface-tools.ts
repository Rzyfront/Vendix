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
  // F4 T31: store memory is Vex-only (D7). Its conversation comes from the
  // turn's execution options, so the purge of a conversation can delete the
  // memories born in it; never from the tool arguments.
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
 * Tools that never take `conversation_id` as an argument (H6). `remember`
 * ties a memory to the conversation whose purge may delete it, so a
 * caller-chosen id would bind it to another conversation of the store. The
 * handler reads the turn's id from its execution context
 * (`ToolExecutionOptions.conversationId`), which no caller writes.
 */
const TURN_CONVERSATION_TOOL_NAMES: ReadonlySet<string> = new Set(['remember']);

/**
 * Tool arguments with the conversation the turn owns. `remember` loses any
 * `conversation_id` the model sent (the turn binds it outside the arguments);
 * the other Vex-only tools get the turn's id only as a default when the
 * model sent no integer.
 */
export function withTurnConversationId(
  name: string,
  args: Record<string, unknown>,
  turnConversationId: number | null | undefined,
): Record<string, unknown> {
  if (TURN_CONVERSATION_TOOL_NAMES.has(name)) {
    const rest = { ...args };
    delete rest.conversation_id;
    return rest;
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
