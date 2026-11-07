import {
  RecordFieldDef,
  RecordFieldType,
  RecordValue,
  RecordValues,
} from '../interfaces/records.interfaces';

export const RECORD_FIELD_TYPE_LABEL: Record<RecordFieldType, string> = {
  text: 'Texto corto',
  textarea: 'Texto largo',
  number: 'Número',
  money: 'Dinero',
  date: 'Fecha',
  boolean: 'Sí / No',
  select: 'Lista de opciones',
  email: 'Correo',
  phone: 'Teléfono',
};

export const RECORD_FIELD_TYPE_OPTIONS: { value: RecordFieldType; label: string }[] = (
  Object.keys(RECORD_FIELD_TYPE_LABEL) as RecordFieldType[]
).map((value) => ({ value, label: RECORD_FIELD_TYPE_LABEL[value] }));

/** Icons the designer offers for a collection (all registered in the icon set). */
export const COLLECTION_ICON_OPTIONS = [
  'folder-open',
  'file-text',
  'briefcase',
  'shield',
  'building',
  'clipboard-list',
  'package',
  'users',
].map((value) => ({ value, label: value }));

/** `Vence el` -> `vence_el`: a valid field key (starts with a letter, lowercase, `_`). */
export function keyFromLabel(label: string): string {
  const base = label
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  const key = /^[a-z]/.test(base) ? base : base ? `c_${base}` : '';
  return key.slice(0, 40);
}

/** Default reference prefix for a name: its first letters, 2..6 uppercase. */
export function prefixFromName(name: string): string {
  const letters = name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z]/g, '');
  return letters.length >= 2 ? letters.slice(0, 3) : '';
}

/** `2026-12-07` -> `7/12/2026`, without going through a time zone. */
export function formatDateOnly(value: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  return m ? `${Number(m[3])}/${Number(m[2])}/${m[1]}` : value;
}

/** Text shown for a stored value; `money` receives the injected currency formatter. */
export function formatRecordValue(
  field: RecordFieldDef,
  value: RecordValue | undefined,
  money: (amount: number) => string,
): string {
  if (value === undefined || value === null || value === '') return '—';
  switch (field.type) {
    case 'boolean':
      return value === true ? 'Sí' : 'No';
    case 'money':
      return money(Number(value));
    case 'date':
      return formatDateOnly(String(value));
    case 'select':
      return field.options?.find((o) => o.value === value)?.label ?? String(value);
    default:
      return String(value);
  }
}

/** Form state (every control as text/boolean) -> API values; empty optionals become `null`. */
export function valuesFromForm(
  fields: readonly RecordFieldDef[],
  form: Record<string, string | boolean | null | undefined>,
  includeEmpty: boolean,
): Record<string, RecordValue | null> {
  const out: Record<string, RecordValue | null> = {};
  for (const f of fields) {
    const raw = form[f.key];
    if (f.type === 'boolean') {
      if (raw === true || raw === false) out[f.key] = raw;
      else if (includeEmpty) out[f.key] = null;
      continue;
    }
    const text = typeof raw === 'string' ? raw.trim() : '';
    if (text === '') {
      if (includeEmpty) out[f.key] = null;
      continue;
    }
    out[f.key] = f.type === 'number' || f.type === 'money' ? Number(text) : text;
  }
  return out;
}

/** Stored values -> form state. */
export function formFromValues(
  fields: readonly RecordFieldDef[],
  values: RecordValues,
): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {};
  for (const f of fields) {
    const v = values[f.key];
    if (f.type === 'boolean') out[f.key] = v === true;
    else out[f.key] = v === undefined ? '' : String(v);
  }
  return out;
}
