import {
  WorkflowActionDef,
  WorkflowActionMapValue,
  WorkflowAssigneeDef,
  WorkflowRequirementDef,
  WorkflowVendixActionName,
  resolveTokens,
} from '@common/workflows/contract';

/** A `notify` action resolved to its content (who is still the definition's `to`). */
export interface AppliedNotify {
  message: string;
  to: WorkflowAssigneeDef;
}

/**
 * A `vendix.*` action with its `map` already resolved against the instance
 * data. Strings only (the action parses numbers); `assignee` stays a definition.
 * The engine writes it to the outbox, the simulator only reports it.
 */
export interface AppliedVendixAction {
  action: WorkflowVendixActionName;
  map_resolved: Record<string, string | WorkflowAssigneeDef>;
}

/** What `{{instance.*}}` resolves to while applying a hook. */
export interface ActionInstanceRef {
  reference?: string | null;
  title?: string | null;
}

function resolveMap(
  map: Record<string, WorkflowActionMapValue> | undefined,
  data: Record<string, unknown>,
  instance: ActionInstanceRef | undefined,
): Record<string, string | WorkflowAssigneeDef> {
  const out: Record<string, string | WorkflowAssigneeDef> = {};
  for (const [key, value] of Object.entries(map ?? {})) {
    if (typeof value === 'string') {
      out[key] = resolveTokens(value, { fields: data, instance });
    } else if (typeof value === 'number' || typeof value === 'boolean') {
      out[key] = String(value);
    } else if (value && typeof value === 'object') {
      out[key] = value;
    }
  }
  return out;
}

/**
 * Pure part of entering / leaving a stage: `set_field` mutates a copy of
 * `data`; `notify` is collected (the engine queues it, the simulator only
 * reports it). Shared by the engine and the simulator.
 */
export function applyActionList(
  actions: WorkflowActionDef[] | undefined,
  data: Record<string, unknown>,
  instance?: ActionInstanceRef,
): {
  data: Record<string, unknown>;
  notifies: AppliedNotify[];
  vendix: AppliedVendixAction[];
} {
  const next = { ...data };
  const notifies: AppliedNotify[] = [];
  const vendix: AppliedVendixAction[] = [];
  for (const a of actions ?? []) {
    if (a.action === 'set_field') next[a.field] = a.value;
    else if (a.action === 'notify') notifies.push({ message: a.message, to: a.to });
    else if (
      a.action === 'vendix.purchase_order.create_draft' ||
      a.action === 'vendix.crm_task.create'
    ) {
      vendix.push({
        action: a.action,
        map_resolved: resolveMap(a.map, next, instance),
      });
    }
  }
  return { data: next, notifies, vendix };
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
