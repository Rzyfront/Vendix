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
