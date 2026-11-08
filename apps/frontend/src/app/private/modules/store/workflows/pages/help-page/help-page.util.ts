import {
  WORKFLOW_ACTION_CATALOG,
  WORKFLOW_AI_TASKS,
  WORKFLOW_CONNECTOR_CATALOG,
  WORKFLOW_EVENT_CATALOG,
  WORKFLOW_HOOK_POINTS,
  WORKFLOW_STAGE_TYPES,
  WORKFLOW_TRIGGER_EVENTS,
  WORKFLOW_VENDIX_ACTIONS,
  WorkflowAiTask,
  WorkflowHookPoint,
} from '../../../../../../shared/workflows/contract/workflow-contract';
import { STAGE_TYPE_LABEL } from '../../editor/workflow-editor.utils';
import {
  WorkflowUsageMetric,
  WorkflowUsageMetricKey,
} from '../../services/workflow-limits-api.service';
import type { HelpEntry, HelpLiveKind } from './help-page.data';

/** Lower-cases and strips diacritics so "firma" finds "Firmas" and "Aprobación". */
export function normalizeText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();
}

/** A group of live rows: a heading (module) and its entries. */
export interface LiveGroup {
  title: string;
  items: string[];
}

const AI_TASK_LABEL: Record<WorkflowAiTask, string> = {
  classify: 'Clasificar',
  extract: 'Extraer a campos',
  summarize: 'Resumir',
  draft: 'Redactar',
  decide: 'Decidir la rama',
};

const HOOK_LABEL: Record<WorkflowHookPoint, string> = {
  on_enter: 'Al entrar a la etapa',
  on_submit: 'Al enviar',
  on_complete: 'Al completar',
  on_exit: 'Al salir de la etapa',
};

function groupByModule<T extends string>(
  keys: readonly T[],
  moduleOf: (key: T) => string,
  labelOf: (key: T) => string,
): LiveGroup[] {
  const groups = new Map<string, string[]>();
  for (const key of keys) {
    const module = moduleOf(key);
    groups.set(module, [...(groups.get(module) ?? []), labelOf(key)]);
  }
  return [...groups.entries()].map(([title, items]) => ({ title, items }));
}

/** Live lists read from the contract registries the editor itself uses. */
export function liveGroups(kind: HelpLiveKind): LiveGroup[] {
  switch (kind) {
    case 'stage_types':
      return [
        {
          title: 'Tipos de etapa',
          items: WORKFLOW_STAGE_TYPES.map((t) => STAGE_TYPE_LABEL[t]),
        },
      ];
    case 'events':
      return groupByModule(
        WORKFLOW_TRIGGER_EVENTS,
        (e) => WORKFLOW_EVENT_CATALOG[e].module,
        (e) => WORKFLOW_EVENT_CATALOG[e].label,
      );
    case 'actions':
      return groupByModule(
        WORKFLOW_VENDIX_ACTIONS,
        (a) => WORKFLOW_ACTION_CATALOG[a].module,
        (a) => WORKFLOW_ACTION_CATALOG[a].label,
      );
    case 'connectors':
      return [
        {
          title: 'Conectores',
          items: Object.values(WORKFLOW_CONNECTOR_CATALOG).map(
            (c) => `${c.label}: ${c.description}`,
          ),
        },
      ];
    case 'ai_tasks':
      return [{ title: 'Tareas de IA', items: WORKFLOW_AI_TASKS.map((t) => AI_TASK_LABEL[t]) }];
    case 'hooks':
      return [
        {
          title: 'Puntos de disparo',
          items: WORKFLOW_HOOK_POINTS.map((h) => HOOK_LABEL[h]),
        },
      ];
    case 'limits':
      return [{ title: 'Límites', items: Object.values(METRIC_LABEL) }];
  }
}

/** Everything a search may match in an entry, accents and case ignored. */
export function entrySearchText(entry: HelpEntry): string {
  const live = entry.live ? liveGroups(entry.live).flatMap((g) => [g.title, ...g.items]) : [];
  return normalizeText(
    [
      entry.question,
      ...entry.paragraphs,
      ...(entry.keywords ?? []),
      ...entry.links.map((l) => l.label),
      ...live,
    ].join(' '),
  );
}

/** Every word of the query must appear in the entry's text. */
export function matchesQuery(entry: HelpEntry, query: string): boolean {
  const words = normalizeText(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const text = entrySearchText(entry);
  return words.every((w) => text.includes(w));
}

export const METRIC_LABEL: Record<WorkflowUsageMetricKey, string> = {
  monthly_instances: 'Solicitudes este mes',
  monthly_http_calls: 'Llamadas HTTP este mes',
  storage_bytes: 'Almacenamiento',
  monthly_ai_tokens: 'Tokens de IA',
};

const NUMBER = new Intl.NumberFormat('es-CO');
const MB = 1024 * 1024;
const GB = 1024 * MB;

export function formatBytes(bytes: number): string {
  return bytes >= GB
    ? `${NUMBER.format(Math.round((bytes / GB) * 10) / 10)} GB`
    : `${NUMBER.format(Math.round(bytes / MB))} MB`;
}

export interface LimitRow {
  key: WorkflowUsageMetricKey;
  label: string;
  text: string;
  state: WorkflowUsageMetric['state'];
}

/** One readable line per plan metric ("Solicitudes este mes: 120 de 20.000"). */
export function limitRow(metric: WorkflowUsageMetric): LimitRow {
  const fmt = metric.key === 'storage_bytes' ? formatBytes : (n: number) => NUMBER.format(n);
  let text: string;
  if (metric.state === 'unavailable') text = 'No incluido en tu plan';
  else if (metric.cap === null) text = `${fmt(metric.used)} (sin límite)`;
  else text = `${fmt(metric.used)} de ${fmt(metric.cap)}`;
  return { key: metric.key, label: METRIC_LABEL[metric.key], text, state: metric.state };
}
