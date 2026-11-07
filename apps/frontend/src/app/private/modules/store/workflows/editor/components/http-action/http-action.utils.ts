import {
  WORKFLOW_HTTP_OUTPUT_PATH,
  WorkflowActionMapValue,
  WorkflowFieldDef,
} from '../../../../../../../shared/workflows/contract/workflow-contract';

export type HttpTextKey = 'url' | 'headers' | 'body';

export interface OutputRow {
  field: string;
  path: string;
}

const FIELD_TOKEN = /\{\{\s*fields\.([A-Za-z0-9_-]+)\s*\}\}/g;

/** Field types a response value can fill (the rest cannot come from a response). */
const NOT_FILLABLE = new Set(['file', 'user', 'multiselect']);

/** Declared fields the "Salida" mapping may target: not calculated, not files or users. */
export function outputFields(fields: readonly WorkflowFieldDef[]): WorkflowFieldDef[] {
  return fields.filter((f) => !f.compute && !NOT_FILLABLE.has(f.type));
}

/** Keys of `{{fields.<key>}}` used in the URL, headers and body, in order of first use. */
export function usedFieldKeys(map: Record<string, WorkflowActionMapValue>): string[] {
  const keys: string[] = [];
  for (const name of ['url', 'headers', 'body'] as const) {
    const value = map[name];
    if (typeof value !== 'string') continue;
    for (const match of value.matchAll(FIELD_TOKEN)) {
      if (!keys.includes(match[1])) keys.push(match[1]);
    }
  }
  return keys;
}

/** Adds `token` at the end of a text; headers start a new line when it is not empty. */
export function appendToken(text: string, token: string, key: HttpTextKey): string {
  if (text === '') return token;
  if (key === 'headers') return `${text.replace(/\n+$/, '')}\n${token}`;
  return `${text}${token}`;
}

/** Complete rows only (field and valid path); a later row wins over an earlier one for a field. */
export function toOutputRecord(rows: readonly OutputRow[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const row of rows) {
    if (row.field !== '' && isValidOutputPath(row.path)) out[row.field] = row.path.trim();
  }
  return out;
}

export function toOutputRows(output: Record<string, string> | undefined): OutputRow[] {
  return Object.entries(output ?? {}).map(([field, path]) => ({ field, path }));
}

export function isValidOutputPath(path: string): boolean {
  return WORKFLOW_HTTP_OUTPUT_PATH.test(path.trim());
}
