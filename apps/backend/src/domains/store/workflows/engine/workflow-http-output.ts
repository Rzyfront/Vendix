import {
  WorkflowDefinitionV1,
  WorkflowFieldDef,
} from '@common/workflows/contract';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE = /^\+?[0-9][0-9\s().-]{5,24}$/;

function asText(v: unknown): string | null {
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (v !== null && typeof v === 'object') {
    try {
      return JSON.stringify(v);
    } catch {
      return null;
    }
  }
  return null;
}

/** One response value → the declared type of the field, or `undefined` (dropped). */
function coerceOne(f: WorkflowFieldDef, v: unknown): unknown {
  switch (f.type) {
    case 'number':
    case 'money': {
      const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
      if (!Number.isFinite(n)) return undefined;
      return f.type === 'money' ? Math.round(n * 100) / 100 : n;
    }
    case 'boolean':
      if (typeof v === 'boolean') return v;
      if (v === 'true') return true;
      if (v === 'false') return false;
      return undefined;
    case 'date': {
      if (typeof v !== 'string') return undefined;
      const day = v.slice(0, 10);
      return ISO_DATE.test(day) && !Number.isNaN(Date.parse(day)) ? day : undefined;
    }
    case 'select': {
      const t = typeof v === 'object' ? null : asText(v);
      return t !== null && (f.options ?? []).some((o) => o.value === t) ? t : undefined;
    }
    case 'email': {
      const t = typeof v === 'string' ? v.trim() : '';
      return t.length <= 254 && EMAIL.test(t) ? t : undefined;
    }
    case 'phone': {
      const t = typeof v === 'string' ? v.trim() : '';
      return PHONE.test(t) ? t : undefined;
    }
    case 'text':
    case 'textarea': {
      const t = asText(v);
      return t !== null && t.length <= (f.type === 'text' ? 2000 : 10000) ? t : undefined;
    }
    default:
      // multiselect, file and user cannot be filled from a response.
      return undefined;
  }
}

/**
 * P3.2: keeps the response values that fit a declared, non-calculated field of
 * the definition (coerced to its type) and reports the keys it dropped.
 */
export function coerceOutputFields(
  definition: Pick<WorkflowDefinitionV1, 'fields'>,
  values: Record<string, unknown>,
): { coerced: Record<string, unknown>; dropped: string[] } {
  const byKey = new Map((definition.fields ?? []).map((f) => [f.key, f]));
  const coerced: Record<string, unknown> = {};
  const dropped: string[] = [];
  for (const [key, raw] of Object.entries(values)) {
    const field = byKey.get(key);
    const value = field && !field.compute ? coerceOne(field, raw) : undefined;
    if (value === undefined) dropped.push(key);
    else coerced[key] = value;
  }
  return { coerced, dropped };
}
