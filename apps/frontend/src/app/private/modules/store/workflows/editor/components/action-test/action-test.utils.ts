import { WorkflowActionDef } from '../../../../../../../shared/workflows/contract/workflow-contract';

const FIELD_TOKEN = /\{\{\s*fields\.([A-Za-z0-9_]+)\s*\}\}/g;

/** Every string an action can carry tokens in (map values, notify message). */
function templates(action: WorkflowActionDef): string[] {
  switch (action.action) {
    case 'notify':
      return [action.message];
    case 'set_field':
      return typeof action.value === 'string' ? [action.value] : [];
    default:
      return Object.values(action.map ?? {}).filter((v): v is string => typeof v === 'string');
  }
}

/** Keys of the `{{fields.<key>}}` the action uses, in order of first use. */
export function referencedFieldKeys(action: WorkflowActionDef): string[] {
  const keys: string[] = [];
  for (const text of templates(action)) {
    for (const match of text.matchAll(FIELD_TOKEN)) {
      if (!keys.includes(match[1])) keys.push(match[1]);
    }
  }
  return keys;
}

/** Display text of a resolved value in the preview table. */
export function previewValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  return typeof value === 'object' ? JSON.stringify(value) : String(value);
}

/** Whether the action runs for real when tested (HTTP and connectors). */
export function runsForReal(action: WorkflowActionDef): boolean {
  return (
    action.action === 'vendix.http.request' ||
    action.action === 'vendix.email.send' ||
    action.action === 'vendix.whatsapp.send'
  );
}
