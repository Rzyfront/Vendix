import { DebugChange, DebugEvent } from '../../interfaces/workflow-debug.interfaces';

export interface VariableRow {
  key: string;
  /** Display text of the value at that event. */
  value: string;
  changed: boolean;
  /** Display text of the previous value; only for changed rows. */
  before: string | null;
}

const EMPTY = '—';

/** Display text of a variable value. */
export function formatValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return EMPTY;
  if (typeof value === 'boolean') return value ? 'Sí' : 'No';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

/**
 * Rows of the variables table of one event: every captured variable (sorted by
 * key), with the ones that differ from the previous capture flagged, plus the
 * ones the event removed. Events without capture have no rows.
 */
export function variableRows(event: DebugEvent): VariableRow[] {
  const snapshot = event.data_snapshot;
  if (!snapshot) return [];
  const changes = new Map<string, DebugChange>(event.changes.map((c) => [c.key, c]));
  const keys = new Set([...Object.keys(snapshot), ...changes.keys()]);
  return [...keys].sort().map((key) => {
    const change = changes.get(key);
    return {
      key,
      value: formatValue(snapshot[key]),
      changed: change !== undefined,
      before: change ? formatValue(change.before) : null,
    };
  });
}

/** Whether the event carries a captured snapshot (legacy events do not). */
export function hasCapture(event: DebugEvent): boolean {
  return event.data_snapshot !== null;
}

/** Who did it: the person by name, the external requester, the AI or the system. */
export function actorLabel(event: DebugEvent): string {
  if (event.actor_name) return event.actor_name;
  if (event.actor_type === 'system') return 'Sistema';
  if (event.actor_type === 'public') return 'Solicitante externo';
  if (event.actor_type === 'ai') return 'Asistente IA';
  return event.actor_id ? `Usuario #${event.actor_id}` : 'Usuario';
}

/** "from → to" using stage names when known; a single name when it stays. */
export function stageText(event: DebugEvent, names: Record<string, string>): string {
  const name = (key: string | null) => (key ? (names[key] ?? key) : null);
  const from = name(event.from_stage_key);
  const to = name(event.to_stage_key);
  if (from && to && from !== to) return `${from} → ${to}`;
  return to ?? from ?? EMPTY;
}
