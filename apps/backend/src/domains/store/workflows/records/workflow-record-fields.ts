import {
  WORKFLOW_KEY_PATTERN,
  WORKFLOW_RECORD_FIELD_TYPES,
  WorkflowRecordFieldDef,
  WorkflowRecordFieldType,
  WORKFLOW_LIMITS,
  zonedParts,
} from '@common/workflows/contract';

/** P3.6: at most this many fields per collection. */
export const MAX_COLLECTION_FIELDS = 50;
const MAX_TEXT = 500;
const MAX_TEXTAREA = 5000;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE = /^\+?[0-9][0-9\s().-]{4,24}$/;
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

export interface FieldIssue {
  field: string;
  message: string;
}

export type FieldsResult =
  | { ok: true; fields: WorkflowRecordFieldDef[] }
  | { ok: false; errors: FieldIssue[] };

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** Validates the field list of a collection (shape, unique keys, select options). */
export function validateCollectionFields(input: unknown): FieldsResult {
  const errors: FieldIssue[] = [];
  if (!Array.isArray(input)) {
    return { ok: false, errors: [{ field: 'fields', message: 'Los campos deben ser una lista.' }] };
  }
  if (input.length > MAX_COLLECTION_FIELDS) {
    errors.push({
      field: 'fields',
      message: `Una colección admite hasta ${MAX_COLLECTION_FIELDS} campos.`,
    });
  }
  const fields: WorkflowRecordFieldDef[] = [];
  const seen = new Set<string>();
  input.forEach((raw, i) => {
    const path = `fields[${i}]`;
    if (!isObj(raw)) {
      errors.push({ field: path, message: 'Cada campo debe ser un objeto.' });
      return;
    }
    const key = raw['key'];
    const label = raw['label'];
    const type = raw['type'];
    if (typeof key !== 'string' || !WORKFLOW_KEY_PATTERN.test(key)) {
      errors.push({
        field: `${path}.key`,
        message: 'La clave del campo debe empezar con una letra minúscula y usar solo minúsculas, números, guion o guion bajo.',
      });
    } else if (seen.has(key)) {
      errors.push({ field: `${path}.key`, message: `La clave "${key}" está repetida.` });
    } else {
      seen.add(key);
    }
    if (typeof label !== 'string' || !label.trim() || label.length > 120) {
      errors.push({ field: `${path}.label`, message: 'El nombre del campo es obligatorio (máximo 120 caracteres).' });
    }
    if (!WORKFLOW_RECORD_FIELD_TYPES.includes(type as WorkflowRecordFieldType)) {
      errors.push({ field: `${path}.type`, message: 'El tipo de campo no es válido.' });
      return;
    }
    const def: WorkflowRecordFieldDef = {
      key: String(key),
      label: typeof label === 'string' ? label.trim() : '',
      type: type as WorkflowRecordFieldType,
    };
    if (raw['required'] === true) def.required = true;
    if (type === 'select') {
      const options = raw['options'];
      const valid =
        Array.isArray(options) &&
        options.length > 0 &&
        options.length <= WORKFLOW_LIMITS.maxSelectOptions &&
        options.every(
          (o) =>
            isObj(o) &&
            typeof o['value'] === 'string' &&
            !!o['value'] &&
            typeof o['label'] === 'string' &&
            !!o['label'],
        );
      if (!valid) {
        errors.push({
          field: `${path}.options`,
          message: 'Un campo de selección necesita al menos una opción con valor y nombre.',
        });
      } else {
        const values = (options as { value: string; label: string }[]).map((o) => o.value);
        if (new Set(values).size !== values.length) {
          errors.push({ field: `${path}.options`, message: 'Las opciones no pueden repetir su valor.' });
        } else {
          def.options = (options as { value: string; label: string }[]).map((o) => ({
            value: o.value,
            label: o.label,
          }));
        }
      }
    }
    fields.push(def);
  });
  return errors.length ? { ok: false, errors } : { ok: true, fields };
}

/** Reference prefix proposed from the collection name: 2..6 uppercase letters. */
export function defaultReferencePrefix(name: string): string {
  const letters = name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z]/g, '');
  const prefix = letters.slice(0, 3);
  return prefix.length >= 2 ? prefix : 'REG';
}

export const REFERENCE_PREFIX_PATTERN = /^[A-Z]{2,6}$/;

export function formatReference(prefix: string, n: number): string {
  return `${prefix}-${String(n).padStart(6, '0')}`;
}

export type RecordValues = Record<string, string | number | boolean>;

export type ValuesResult =
  | { ok: true; values: RecordValues }
  | { ok: false; errors: FieldIssue[] };

const isBlank = (v: unknown) =>
  v === undefined || v === null || (typeof v === 'string' && v.trim() === '');

function isRealDate(value: string): boolean {
  const m = DATE.exec(value);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

/**
 * Validates `input` against the collection fields. Unknown keys are rejected;
 * blank optional values are dropped; `required` fields must be present
 * (`false` counts as present for booleans).
 */
export function validateRecordValues(
  fields: readonly WorkflowRecordFieldDef[],
  input: unknown,
): ValuesResult {
  const errors: FieldIssue[] = [];
  const raw = isObj(input) ? input : {};
  if (input !== undefined && !isObj(input)) {
    return { ok: false, errors: [{ field: 'values', message: 'Los valores deben ser un objeto.' }] };
  }
  const known = new Set(fields.map((f) => f.key));
  for (const k of Object.keys(raw)) {
    if (!known.has(k)) errors.push({ field: k, message: 'Este campo no existe en la colección.' });
  }
  const values: RecordValues = {};
  for (const f of fields) {
    const v = raw[f.key];
    if (isBlank(v)) {
      if (f.required) errors.push({ field: f.key, message: `"${f.label}" es obligatorio.` });
      continue;
    }
    const bad = (message: string) => errors.push({ field: f.key, message });
    switch (f.type) {
      case 'text':
      case 'textarea': {
        const max = f.type === 'text' ? MAX_TEXT : MAX_TEXTAREA;
        if (typeof v !== 'string') bad(`"${f.label}" debe ser texto.`);
        else if (v.length > max) bad(`"${f.label}" admite hasta ${max} caracteres.`);
        else values[f.key] = v.trim();
        break;
      }
      case 'email':
        if (typeof v !== 'string' || !EMAIL.test(v.trim())) bad(`"${f.label}" debe ser un correo válido.`);
        else values[f.key] = v.trim();
        break;
      case 'phone':
        if (typeof v !== 'string' || !PHONE.test(v.trim())) bad(`"${f.label}" debe ser un teléfono válido.`);
        else values[f.key] = v.trim();
        break;
      case 'number':
      case 'money': {
        const n = typeof v === 'string' ? Number(v.trim()) : v;
        if (typeof n !== 'number' || !Number.isFinite(n)) bad(`"${f.label}" debe ser un número.`);
        else values[f.key] = n;
        break;
      }
      case 'date':
        if (typeof v !== 'string' || !isRealDate(v)) bad(`"${f.label}" debe ser una fecha válida (AAAA-MM-DD).`);
        else values[f.key] = v;
        break;
      case 'boolean':
        if (typeof v !== 'boolean') bad(`"${f.label}" debe ser verdadero o falso.`);
        else values[f.key] = v;
        break;
      case 'select':
        if (typeof v !== 'string' || !(f.options ?? []).some((o) => o.value === v)) {
          bad(`"${f.label}" debe ser una de las opciones.`);
        } else values[f.key] = v;
        break;
    }
  }
  return errors.length ? { ok: false, errors } : { ok: true, values };
}

/** Title of a record: the value of the title field, else its reference. */
export function recordTitle(
  titleField: string | null | undefined,
  values: RecordValues,
  reference: string,
): string {
  const t = titleField ? values[titleField] : undefined;
  return (typeof t === 'string' && t.trim() ? t.trim() : reference).slice(0, 200);
}

/** Flow field types that accept a value of each record field type (same-key copy rule). */
const COMPATIBLE: Record<WorkflowRecordFieldType, readonly string[]> = {
  text: ['text', 'textarea'],
  textarea: ['text', 'textarea'],
  number: ['number', 'money'],
  money: ['number', 'money'],
  date: ['date'],
  boolean: ['boolean'],
  select: ['select', 'text'],
  email: ['email', 'text'],
  phone: ['phone', 'text'],
};

/**
 * Pre-fill rule when a flow starts on a record: every record value whose key
 * equals a flow field key is copied when the flow field type is compatible
 * (text/textarea, number/money, select -> select or text, email/phone -> same
 * or text, date and boolean only into the same type). A `select` flow field
 * only takes values among its options. Everything else is left empty.
 */
export function prefillFlowFields(
  recordFields: readonly WorkflowRecordFieldDef[],
  values: Record<string, unknown>,
  flowFields: readonly { key: string; type: string; options?: readonly { value: string }[] }[],
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const rf of recordFields) {
    const v = values[rf.key];
    if (v === undefined || v === null) continue;
    const ff = flowFields.find((f) => f.key === rf.key);
    if (!ff || !COMPATIBLE[rf.type].includes(ff.type)) continue;
    if (ff.type === 'select' && !(ff.options ?? []).some((o) => o.value === v)) continue;
    out[rf.key] = v;
  }
  return out;
}

/** Calendar date `YYYY-MM-DD` of `now` in `timeZone`, moved by `days`. */
export function zonedDatePlus(now: Date, timeZone: string, days: number): string {
  const p = zonedParts(now, timeZone);
  const d = new Date(Date.UTC(p.year, p.month - 1, p.day + days));
  return d.toISOString().slice(0, 10);
}

/** Flat `record.*` context of a record for a `record_date` start: scalars as strings. */
export function recordStartContext(
  values: Record<string, unknown>,
  title: string,
  reference: string,
): Record<string, unknown> {
  const context: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(values)) {
    if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
      context[k] = String(v);
    }
  }
  return { ...context, title, reference };
}
