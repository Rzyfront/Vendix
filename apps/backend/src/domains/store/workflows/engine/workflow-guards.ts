import {
  WorkflowFieldDef,
  WorkflowGuardDef,
  WorkflowStageDef,
  evaluateCondition,
} from '@common/workflows/contract';

/**
 * P2.5: outcomes that move a request forward. Sending back or rejecting is
 * never held by a guard (a guard protects the next step, not the way out).
 */
export const GUARDED_OUTCOMES: ReadonlySet<string> = new Set([
  'submit',
  'approve',
  'auto',
  'joined',
  'completed',
  'elapsed',
  'continue',
  'done',
]);

/** First guard of the stage whose condition holds for `data`, if any. */
export function firedGuard(
  stage: WorkflowStageDef,
  outcome: string,
  data: Record<string, unknown>,
  fields: WorkflowFieldDef[],
): WorkflowGuardDef | null {
  if (!GUARDED_OUTCOMES.has(outcome)) return null;
  for (const guard of stage.guards ?? []) {
    if (evaluateCondition(guard.when, data, fields)) return guard;
  }
  return null;
}
