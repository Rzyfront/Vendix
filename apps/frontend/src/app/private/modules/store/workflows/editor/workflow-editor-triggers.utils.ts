import {
  WORKFLOW_ACTION_CATALOG,
  WORKFLOW_EMAIL_TOKENS,
  WORKFLOW_EVENT_CATALOG,
  WORKFLOW_GATE_OPERATIONS,
  WORKFLOW_INSTANCE_TOKENS,
  WORKFLOW_RECORD_TOKENS,
  WORKFLOW_TRIGGER_EVENTS,
  WORKFLOW_VENDIX_ACTIONS,
  WorkflowActionInputSpec,
  WorkflowCatalogToken,
  WorkflowFieldDef,
  WorkflowGateOperation,
  WorkflowRecordFieldDef,
  WorkflowTriggerEvent,
  WorkflowVendixActionName,
} from '../../../../../shared/workflows/contract/workflow-contract';

// ─── Triggers and Vendix actions ─────────────────────────────────────

export interface EditorOption {
  value: string;
  label: string;
  disabled?: boolean;
}

/** Event label from the registry. */
export const TRIGGER_EVENT_LABEL = Object.fromEntries(
  WORKFLOW_TRIGGER_EVENTS.map((e) => [e, WORKFLOW_EVENT_CATALOG[e].label]),
) as Record<WorkflowTriggerEvent, string>;

/** Action label from the registry. */
export const VENDIX_ACTION_LABEL = Object.fromEntries(
  WORKFLOW_VENDIX_ACTIONS.map((a) => [a, WORKFLOW_ACTION_CATALOG[a].label]),
) as Record<WorkflowVendixActionName, string>;

/** Label of each action input key (first registry entry that declares it). */
export const ACTION_MAP_KEY_LABEL: Record<string, string> = (() => {
  const labels: Record<string, string> = {};
  for (const name of WORKFLOW_VENDIX_ACTIONS) {
    const inputs = WORKFLOW_ACTION_CATALOG[name].inputs as Record<string, WorkflowActionInputSpec>;
    for (const [key, spec] of Object.entries(inputs)) labels[key] ??= spec.label;
  }
  return labels;
})();

/**
 * Options grouped by module for a native select: a disabled header per module
 * followed by its entries, in registry order of first appearance.
 */
export function groupOptionsByModule<T extends string>(
  keys: readonly T[],
  moduleOf: (key: T) => string,
  labelOf: (key: T) => string,
): EditorOption[] {
  const groups = new Map<string, T[]>();
  for (const key of keys) {
    const module = moduleOf(key);
    groups.set(module, [...(groups.get(module) ?? []), key]);
  }
  return [...groups.entries()].flatMap(([module, members]) => [
    { value: `__group__${module}`, label: `— ${module} —`, disabled: true },
    ...members.map((key) => ({ value: key, label: labelOf(key) })),
  ]);
}

/** Registry events (limited to `keys`) grouped by module. */
export function eventOptions(keys: readonly WorkflowTriggerEvent[]): EditorOption[] {
  return groupOptionsByModule(
    keys,
    (e) => WORKFLOW_EVENT_CATALOG[e].module,
    (e) => WORKFLOW_EVENT_CATALOG[e].label,
  );
}

/** Registry Vendix actions grouped by module. */
export function vendixActionOptions(): EditorOption[] {
  return groupOptionsByModule(
    WORKFLOW_VENDIX_ACTIONS,
    (a) => WORKFLOW_ACTION_CATALOG[a].module,
    (a) => WORKFLOW_ACTION_CATALOG[a].label,
  );
}

const INSTANCE_TOKEN_LABEL: Record<string, string> = {
  'instance.reference': 'Referencia de la solicitud',
  'instance.title': 'Título de la solicitud',
  'instance.subject_id': 'Registro de la solicitud',
};

/** Tokens offered by an action map: declared fields plus the instance ones. */
export function actionTokenOptions(fields: WorkflowFieldDef[]): EditorOption[] {
  return [
    ...fields.map((f) => ({ value: `{{fields.${f.key}}}`, label: `Campo: ${f.label}` })),
    ...WORKFLOW_INSTANCE_TOKENS.map((t) => ({
      value: `{{${t}}}`,
      label: INSTANCE_TOKEN_LABEL[t] ?? t,
    })),
  ];
}

/** `{{event.<key>}}` options for a list of catalog tokens (label from the registry). */
export function catalogTokenOptions(tokens: readonly WorkflowCatalogToken[]): EditorOption[] {
  return tokens.map((t) => ({ value: `{{event.${t.key}}}`, label: t.label }));
}

/** Tokens offered by an event trigger map. */
export function eventTokenOptions(event: WorkflowTriggerEvent): EditorOption[] {
  return catalogTokenOptions(WORKFLOW_EVENT_CATALOG[event].tokens);
}

/** Tokens offered by an inbound-email trigger map (`{{email.<key>}}`). */
export function emailTokenOptions(): EditorOption[] {
  return WORKFLOW_EMAIL_TOKENS.map((t) => ({ value: `{{email.${t.key}}}`, label: t.label }));
}

/** Tokens offered by the approval gate map of an operation. */
export function gateTokenOptions(operation: WorkflowGateOperation): EditorOption[] {
  return catalogTokenOptions(WORKFLOW_GATE_OPERATIONS[operation].tokens);
}

const RECORD_TOKEN_LABEL: Record<string, string> = {
  'record.title': 'Título del registro',
  'record.reference': 'Referencia del registro',
};

/** Tokens offered by a record-date trigger map (`{{record.<key>}}`): fixed ones plus the collection's fields. */
export function recordTokenOptions(fields: readonly WorkflowRecordFieldDef[]): EditorOption[] {
  return [
    ...WORKFLOW_RECORD_TOKENS.map((t) => ({ value: `{{${t}}}`, label: RECORD_TOKEN_LABEL[t] ?? t })),
    ...fields.map((f) => ({ value: `{{record.${f.key}}}`, label: `Registro: ${f.label}` })),
  ];
}

/** Date fields of a collection: the only ones a record-date trigger can watch. */
export function recordDateFieldOptions(fields: readonly WorkflowRecordFieldDef[]): EditorOption[] {
  return fields.filter((f) => f.type === 'date').map((f) => ({ value: f.key, label: f.label }));
}
