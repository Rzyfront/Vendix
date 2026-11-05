import {
  WorkflowActionDef,
  WorkflowAssigneeDef,
  WorkflowRequirementDef,
} from '@common/workflows/contract';

/** A `notify` action resolved to its content (who is still the definition's `to`). */
export interface AppliedNotify {
  message: string;
  to: WorkflowAssigneeDef;
}

/**
 * Pure part of entering / leaving a stage: `set_field` mutates a copy of
 * `data`; `notify` is collected (the engine queues it, the simulator only
 * reports it). Shared by the engine and the simulator.
 */
export function applyActionList(
  actions: WorkflowActionDef[] | undefined,
  data: Record<string, unknown>,
): { data: Record<string, unknown>; notifies: AppliedNotify[] } {
  const next = { ...data };
  const notifies: AppliedNotify[] = [];
  for (const a of actions ?? []) {
    if (a.action === 'set_field') next[a.field] = a.value;
    else if (a.action === 'notify') notifies.push({ message: a.message, to: a.to });
  }
  return { data: next, notifies };
}

/** Whether a requirement can hold back `approve` / `submit` (engine rule). */
export function isBlockingRequirement(req: WorkflowRequirementDef): boolean {
  switch (req.kind) {
    case 'upload':
    case 'signature':
      return req.blocks_exit !== false;
    default:
      return true;
  }
}

/** A data value counts as "filled" when it is not empty. */
export function isFilledValue(v: unknown): boolean {
  return !(
    v === undefined ||
    v === null ||
    v === '' ||
    (Array.isArray(v) && v.length === 0)
  );
}
