import { WorkflowFieldDef } from '@common/workflows/contract';

/** Field types the AI may fill (never files, users, multiselects or computed fields). */
export const READABLE_FIELD_TYPES: ReadonlySet<string> = new Set([
  'text',
  'textarea',
  'number',
  'money',
  'date',
  'boolean',
  'select',
  'email',
  'phone',
]);

export type NormalizedValue = string | number | boolean;

const TAX_ID_HINT = /(^|[^a-z])(nit|rut|cedula|c[eé]dula|identificacion|identificaci[oó]n|documento|cc)([^a-z]|$)/i;

function stripAccents(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/** `YYYY-MM-DD`, `DD/MM/YYYY` or `DD-MM-YYYY` → ISO date; null when not a real date. */
export function normalizeDate(raw: unknown): string | null {
  const s = String(raw ?? '').trim();
  let y: number;
  let m: number;
  let d: number;
  let match = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ].*)?$/.exec(s);
  if (match) {
    [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  } else {
    match = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(s);
    if (!match) return null;
    [d, m, y] = [Number(match[1]), Number(match[2]), Number(match[3])];
  }
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) {
    return null;
  }
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/**
 * Colombian-aware number parsing: "1.234.567,89", "1,234,567.89", "24.990",
 * "$ 1 500 000", plain numbers. Null when it is not a finite number.
 */
export function normalizeNumber(raw: unknown): number | null {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
  let s = String(raw ?? '')
    .replace(/[^\d.,-]/g, '')
    .trim();
  if (!/\d/.test(s)) return null;
  const negative = s.startsWith('-');
  s = s.replace(/-/g, '');
  const lastDot = s.lastIndexOf('.');
  const lastComma = s.lastIndexOf(',');
  let decimal: '.' | ',' | null = null;
  if (lastDot >= 0 && lastComma >= 0) {
    decimal = lastDot > lastComma ? '.' : ',';
  } else if (lastDot >= 0 || lastComma >= 0) {
    const sep = lastDot >= 0 ? '.' : ',';
    const count = s.split(sep).length - 1;
    const tail = s.length - s.lastIndexOf(sep) - 1;
    // One separator followed by exactly three digits is a thousands group.
    decimal = count === 1 && tail !== 3 ? sep : null;
  }
  let intPart = s;
  let frac = '';
  if (decimal) {
    const at = s.lastIndexOf(decimal);
    intPart = s.slice(0, at);
    frac = s.slice(at + 1);
  }
  intPart = intPart.replace(/[.,]/g, '');
  if (!/^\d*$/.test(frac)) return null;
  const n = Number(`${intPart || '0'}${frac ? `.${frac}` : ''}`);
  if (!Number.isFinite(n)) return null;
  return negative ? -n : n;
}

/** NIT / document number: digits, optionally followed by `-DV`. */
export function normalizeTaxId(raw: unknown): string | null {
  const s = String(raw ?? '').trim();
  const withDv = /^([\d.\s]+)\s*-\s*(\d)$/.exec(s);
  if (withDv) {
    const digits = withDv[1].replace(/\D/g, '');
    return digits ? `${digits}-${withDv[2]}` : null;
  }
  const digits = s.replace(/\D/g, '');
  return digits.length >= 5 ? digits : null;
}

export function isTaxIdField(def: Pick<WorkflowFieldDef, 'key' | 'label' | 'type'>): boolean {
  if (def.type !== 'text') return false;
  return TAX_ID_HINT.test(def.key) || TAX_ID_HINT.test(def.label);
}

function normalizeText(raw: unknown, max: number): string | null {
  if (raw === null || raw === undefined || typeof raw === 'object') return null;
  const s = String(raw).replace(/\s+/g, ' ').trim();
  return s ? s.slice(0, max) : null;
}

/**
 * Deterministic normalization of an AI value by the field's type. Null means
 * "unusable": the field is dropped instead of being filled with a bad value.
 */
export function normalizeFieldValue(def: WorkflowFieldDef, raw: unknown): NormalizedValue | null {
  if (raw === null || raw === undefined || raw === '') return null;
  switch (def.type) {
    case 'date':
      return normalizeDate(raw);
    case 'number':
      return normalizeNumber(raw);
    case 'money': {
      const n = normalizeNumber(raw);
      return n === null ? null : Math.round(n * 100) / 100;
    }
    case 'boolean': {
      if (typeof raw === 'boolean') return raw;
      const s = stripAccents(String(raw).trim().toLowerCase());
      if (['true', 'si', 'yes', '1'].includes(s)) return true;
      if (['false', 'no', '0'].includes(s)) return false;
      return null;
    }
    case 'email': {
      const s = normalizeText(raw, 254)?.toLowerCase() ?? null;
      return s && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) ? s : null;
    }
    case 'phone': {
      const s = normalizeText(raw, 40);
      if (!s) return null;
      const digits = s.replace(/\D/g, '');
      if (digits.length < 7 || digits.length > 15) return null;
      return `${s.startsWith('+') ? '+' : ''}${digits}`;
    }
    case 'select': {
      const wanted = stripAccents(String(raw).trim().toLowerCase());
      const hit = (def.options ?? []).find(
        (o) =>
          stripAccents(o.value.toLowerCase()) === wanted ||
          stripAccents(o.label.toLowerCase()) === wanted,
      );
      return hit ? hit.value : null;
    }
    case 'textarea':
      return normalizeText(raw, 2000);
    case 'text':
      return isTaxIdField(def) ? normalizeTaxId(raw) : normalizeText(raw, 500);
    default:
      return null;
  }
}
