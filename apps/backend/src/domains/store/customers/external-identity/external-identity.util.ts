import { ExternalPersonType } from './external-identity.types';

export function clean(value: string | undefined | null): string | null {
  const v = (value ?? '').trim();
  return v === '' ? null : v;
}

export function join(...parts: Array<string | undefined>): string | null {
  const v = parts
    .map((p) => (p ?? '').trim())
    .filter(Boolean)
    .join(' ');
  return v === '' ? null : v;
}

/** Mayúsculas y espacios colapsados; null si queda vacío. */
export function normalizeName(value: string | undefined | null): string | null {
  const v = (value ?? '').replace(/\s+/g, ' ').trim().toUpperCase();
  return v === '' ? null : v;
}

/** 9 dígitos que empiezan en 8 o 9 → NIT jurídica; si no, CC natural. */
export function inferDocTypeByShape(doc: string): {
  document_type: 'NIT' | 'CC';
  person_type: ExternalPersonType;
} {
  return /^[89]\d{8}$/.test(doc)
    ? { document_type: 'NIT', person_type: 'JURIDICA' }
    : { document_type: 'CC', person_type: 'NATURAL' };
}
