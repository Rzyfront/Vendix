import {
  WorkflowFieldDef,
  WorkflowTriggerEvent,
} from '../../../../../../../shared/workflows/contract/workflow-contract';
import { actionTokenOptions, eventTokenOptions } from '../../workflow-editor-triggers.utils';
import { FIELD_TYPE_TEXT } from '../../workflow-editor.utils';

/** One insertable `{{token}}`. */
export interface VariableOption {
  token: string;
  label: string;
  hint?: string;
}

export interface VariableGroup {
  id: 'form' | 'computed' | 'instance' | 'event';
  label: string;
  options: VariableOption[];
}

/**
 * Token groups for free text. Only scalar fields resolve in `resolveTokens`
 * (file and multi-select values become an empty string), so those are not
 * offered. `events` adds the context of the flow's trigger events; pass it
 * only where the runtime supplies `{{event.*}}`.
 */
export function buildVariableGroups(
  fields: readonly WorkflowFieldDef[],
  events: readonly WorkflowTriggerEvent[] = [],
): VariableGroup[] {
  const scalar = fields.filter((f) => f.type !== 'file' && f.type !== 'multiselect');
  const asOption = (f: WorkflowFieldDef): VariableOption => ({
    token: `{{fields.${f.key}}}`,
    label: f.label || f.key,
    hint: f.compute ? `Calculado · ${FIELD_TYPE_TEXT[f.type]}` : FIELD_TYPE_TEXT[f.type],
  });
  const eventOptions = new Map<string, VariableOption>();
  for (const event of events) {
    for (const o of eventTokenOptions(event)) {
      if (!eventOptions.has(o.value)) eventOptions.set(o.value, { token: o.value, label: o.label });
    }
  }
  const groups: VariableGroup[] = [
    { id: 'form', label: 'Formulario', options: scalar.filter((f) => !f.compute).map(asOption) },
    { id: 'computed', label: 'Calculados', options: scalar.filter((f) => !!f.compute).map(asOption) },
    {
      id: 'instance',
      label: 'Solicitud',
      options: actionTokenOptions([]).map((o) => ({ token: o.value, label: o.label })),
    },
    { id: 'event', label: 'Evento', options: [...eventOptions.values()] },
  ];
  return groups.filter((g) => g.options.length > 0);
}

/** Keeps the options whose label, hint or token contains `query` (case-insensitive). */
export function filterVariableGroups(groups: readonly VariableGroup[], query: string): VariableGroup[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [...groups];
  return groups
    .map((g) => ({
      ...g,
      options: g.options.filter((o) =>
        `${o.label} ${o.hint ?? ''} ${o.token}`.toLowerCase().includes(needle),
      ),
    }))
    .filter((g) => g.options.length > 0);
}

/**
 * Replaces the selection `[start, end)` of `text` with `token`. Out-of-range or
 * missing positions append at the end. Returns the new text and the caret
 * position right after the token.
 */
export function insertAtCursor(
  text: string,
  token: string,
  start: number | null | undefined,
  end: number | null | undefined,
): { text: string; caret: number } {
  const from = clampIndex(start, text.length);
  const to = Math.max(from, clampIndex(end ?? start, text.length));
  return { text: text.slice(0, from) + token + text.slice(to), caret: from + token.length };
}

function clampIndex(value: number | null | undefined, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return max;
  return Math.min(max, Math.max(0, Math.floor(value)));
}
