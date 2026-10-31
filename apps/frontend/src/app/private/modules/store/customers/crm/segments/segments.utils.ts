import { CRM_CONSENT_LABELS, CRM_SOURCE_LABELS } from '../shared/crm.utils';
import {
  CampaignChannel,
  CampaignStatus,
  SegmentGroup,
  SegmentOperator,
  SegmentRule,
} from '../shared/crm-segments.interface';

/**
 * Closed catalog of the segment builder. It mirrors the backend compiler
 * (`segment-filter.compiler.ts`): the builder only offers a subset of the
 * field/operator pairs the API accepts, never one it rejects. Custom fields
 * (`meta.*`) are not offered here: no frontend service lists them yet.
 */
export type FieldKind = 'tag' | 'stage' | 'owner' | 'enum' | 'int' | 'amount' | 'date';

export interface SelectOption {
  value: string;
  label: string;
}

export interface FieldDef {
  key: string;
  label: string;
  kind: FieldKind;
  operators: readonly SegmentOperator[];
  /** Fixed options of `enum` fields. */
  options?: readonly SelectOption[];
}

/** Keys of `RFM_DEFINITIONS` (customers.tools.ts). */
const RFM_SEGMENTS = [
  'Campeones',
  'Leales',
  'Prometedores / nuevos',
  'Necesitan atención',
  'En riesgo',
  'No podemos perderlos',
  'Hibernando',
  'Perdidos',
];

const CONSENT_OPTIONS: SelectOption[] = Object.entries(CRM_CONSENT_LABELS).map(
  ([value, label]) => ({ value, label }),
);
const DATE_OPS: SegmentOperator[] = ['gte', 'lte', 'between', 'within_days', 'older_than_days'];

export const SEGMENT_FIELDS: readonly FieldDef[] = [
  { key: 'tag', label: 'Etiqueta', kind: 'tag', operators: ['eq', 'neq', 'in', 'exists'] },
  { key: 'rfm', label: 'Segmento RFM', kind: 'enum', operators: ['eq', 'neq', 'in'], options: RFM_SEGMENTS.map((value) => ({ value, label: value })) },
  { key: 'total_spent', label: 'Gasto total', kind: 'amount', operators: ['gte', 'lte', 'between'] },
  { key: 'orders_count', label: 'Número de compras', kind: 'int', operators: ['eq', 'neq', 'gte', 'lte', 'between'] },
  { key: 'last_order_at', label: 'Última compra', kind: 'date', operators: [...DATE_OPS, 'exists'] },
  { key: 'created_at', label: 'Cliente desde', kind: 'date', operators: DATE_OPS },
  {
    key: 'source',
    label: 'Origen',
    kind: 'enum',
    operators: ['eq', 'neq', 'in', 'exists'],
    options: Object.entries(CRM_SOURCE_LABELS).map(([value, label]) => ({ value, label })),
  },
  { key: 'stage', label: 'Etapa del pipeline', kind: 'stage', operators: ['eq', 'neq', 'in', 'exists'] },
  { key: 'owner', label: 'Responsable', kind: 'owner', operators: ['eq', 'neq', 'exists'] },
  { key: 'consent.whatsapp', label: 'Consentimiento WhatsApp', kind: 'enum', operators: ['eq', 'neq', 'in'], options: CONSENT_OPTIONS },
  { key: 'consent.sms', label: 'Consentimiento SMS', kind: 'enum', operators: ['eq', 'neq', 'in'], options: CONSENT_OPTIONS },
  { key: 'consent.email', label: 'Consentimiento correo', kind: 'enum', operators: ['eq', 'neq', 'in'], options: CONSENT_OPTIONS },
];

export const SEGMENT_MAX_RULES = 20;

export function fieldDef(key: string): FieldDef | undefined {
  return SEGMENT_FIELDS.find((field) => field.key === key);
}

export function operatorLabel(kind: FieldKind, cmp: SegmentOperator): string {
  const date = kind === 'date';
  switch (cmp) {
    case 'eq':
      return kind === 'int' ? 'es igual a' : 'es';
    case 'neq':
      return kind === 'int' ? 'es distinto de' : 'no es';
    case 'in':
      return 'es alguno de';
    case 'gte':
      return date ? 'desde' : 'mayor o igual a';
    case 'lte':
      return date ? 'hasta' : 'menor o igual a';
    case 'between':
      return 'entre';
    case 'exists':
      return 'tiene dato';
    case 'within_days':
      return 'en los últimos (días)';
    case 'older_than_days':
      return 'hace más de (días)';
  }
}

// ── Draft model (what the builder edits) ───────────────────

export interface RuleDraft {
  uid: number;
  field: string;
  cmp: SegmentOperator;
  /** Scalar value as typed; `exists` uses 'true' | 'false'. */
  value: string;
  value2: string;
  multi: string[];
}

export interface GroupDraft {
  uid: number;
  op: 'and' | 'or';
  rules: RuleDraft[];
  /** One nested level at most. */
  groups: GroupDraft[];
}

let uidSeq = 0;
export function nextUid(): number {
  uidSeq += 1;
  return uidSeq;
}

export function newRule(field = 'tag'): RuleDraft {
  const def = fieldDef(field) ?? SEGMENT_FIELDS[0];
  return blankRule(def);
}

export function blankRule(def: FieldDef): RuleDraft {
  const cmp = def.operators[0];
  return { uid: nextUid(), field: def.key, cmp, value: cmp === 'exists' ? 'true' : '', value2: '', multi: [] };
}

export function newGroup(): GroupDraft {
  return { uid: nextUid(), op: 'and', rules: [newRule()], groups: [] };
}

export function countRules(group: GroupDraft): number {
  return group.rules.length + group.groups.reduce((sum, child) => sum + countRules(child), 0);
}

function scalar(kind: FieldKind, raw: string): number | string | null {
  const text = raw.trim();
  if (!text) return null;
  switch (kind) {
    case 'tag':
    case 'stage':
    case 'owner': {
      const n = Number(text);
      return Number.isInteger(n) && n >= 1 ? n : null;
    }
    case 'int': {
      const n = Number(text);
      return Number.isInteger(n) && n >= 0 ? n : null;
    }
    case 'amount': {
      const n = Number(text);
      return Number.isFinite(n) ? n : null;
    }
    case 'date':
      return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
    case 'enum':
      return text;
  }
}

/** The API rule of a draft, or null while it is incomplete. */
export function ruleFromDraft(draft: RuleDraft): SegmentRule | null {
  const def = fieldDef(draft.field);
  if (!def || !def.operators.includes(draft.cmp)) return null;
  const { cmp } = draft;
  if (cmp === 'exists') return { field: def.key, cmp, value: draft.value === 'true' };
  if (cmp === 'within_days' || cmp === 'older_than_days') {
    const days = scalar('int', draft.value);
    return typeof days === 'number' && days >= 1 && days <= 3650
      ? { field: def.key, cmp, value: days }
      : null;
  }
  if (cmp === 'in') {
    const items = draft.multi.map((item) => scalar(def.kind, item));
    if (!items.length || items.some((item) => item === null)) return null;
    return { field: def.key, cmp, value: items as number[] | string[] };
  }
  if (cmp === 'between') {
    const from = scalar(def.kind, draft.value);
    const to = scalar(def.kind, draft.value2);
    if (from === null || to === null || from > to) return null;
    return { field: def.key, cmp, value: [from, to] as [number, number] | [string, string] };
  }
  const value = scalar(def.kind, draft.value);
  return value === null ? null : { field: def.key, cmp, value };
}

/** The API filter of a draft, or null while any rule is incomplete. */
export function filterFromDraft(group: GroupDraft): SegmentGroup | null {
  const items: Array<SegmentRule | SegmentGroup> = [];
  for (const draft of group.rules) {
    const rule = ruleFromDraft(draft);
    if (!rule) return null;
    items.push(rule);
  }
  for (const child of group.groups) {
    const nested = filterFromDraft(child);
    if (!nested) return null;
    items.push(nested);
  }
  if (!items.length || countRules(group) > SEGMENT_MAX_RULES) return null;
  return { op: group.op, rules: items };
}

function ruleToDraft(rule: SegmentRule): RuleDraft | null {
  const def = fieldDef(rule.field);
  if (!def || !def.operators.includes(rule.cmp)) return null;
  const draft: RuleDraft = { uid: nextUid(), field: def.key, cmp: rule.cmp, value: '', value2: '', multi: [] };
  const { value } = rule;
  if (rule.cmp === 'in' && Array.isArray(value)) {
    draft.multi = (value as Array<number | string>).map(String);
  } else if (rule.cmp === 'between' && Array.isArray(value) && value.length === 2) {
    draft.value = String(value[0]);
    draft.value2 = String(value[1]);
  } else if (!Array.isArray(value)) {
    draft.value = String(value);
  } else {
    return null;
  }
  return draft;
}

function groupToDraft(group: SegmentGroup, depth: number): GroupDraft | null {
  const draft: GroupDraft = { uid: nextUid(), op: group.op, rules: [], groups: [] };
  for (const item of group.rules) {
    if ('rules' in item) {
      if (depth >= 2) return null;
      const child = groupToDraft(item, depth + 1);
      if (!child) return null;
      draft.groups.push(child);
    } else {
      const rule = ruleToDraft(item);
      if (!rule) return null;
      draft.rules.push(rule);
    }
  }
  return draft;
}

/** Loads a saved filter into the builder; null when it uses what the builder cannot edit. */
export function draftFromFilter(filter: SegmentGroup | null | undefined): GroupDraft | null {
  if (!filter || !Array.isArray(filter.rules)) return null;
  return groupToDraft(filter, 1);
}

// ── Display helpers ────────────────────────────────────────

/** Costs are USD with 4 decimals: never the store currency. */
export function formatUsd(value: number | string | null | undefined): string {
  const n = Number(value ?? 0);
  return new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 4,
    maximumFractionDigits: 4,
  }).format(Number.isFinite(n) ? n : 0);
}

export const CAMPAIGN_CHANNEL_LABELS: Record<CampaignChannel, string> = {
  whatsapp: 'WhatsApp',
  sms: 'SMS',
  email: 'Correo',
};

export const CAMPAIGN_CHANNEL_ICONS: Record<CampaignChannel, string> = {
  whatsapp: 'message-circle',
  sms: 'smartphone',
  email: 'mail',
};

export const CAMPAIGN_STATUS_META: Record<
  CampaignStatus,
  { label: string; variant: 'neutral' | 'info' | 'warning' | 'success' | 'error' }
> = {
  draft: { label: 'Borrador', variant: 'neutral' },
  scheduled: { label: 'Programada', variant: 'info' },
  sending: { label: 'Enviando', variant: 'warning' },
  sent: { label: 'Enviada', variant: 'success' },
  cancelled: { label: 'Cancelada', variant: 'neutral' },
  failed: { label: 'Fallida', variant: 'error' },
};

export const CAMPAIGN_PLACEHOLDERS = ['{first_name}', '{last_name}', '{store_name}'];

export function customerName(c: { first_name: string | null; last_name: string | null }): string {
  return `${c.first_name ?? ''} ${c.last_name ?? ''}`.trim() || 'Sin nombre';
}
