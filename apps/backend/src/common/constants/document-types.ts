/**
 * Colombian DIAN document type catalog used for customer identification.
 *
 * Each code maps to a validation rule (regex + maxLength) and a Spanish label
 * surfaced in validation error messages. Keep this file as the single source
 * of truth for backend document validation.
 */
export const DOCUMENT_TYPE_CODES = [
  'CC',
  'CE',
  'NIT',
  'TI',
  'RC',
  'PA',
  'PEP',
  'PPT',
  'DIE',
  'NUIP',
] as const;

export type DocumentTypeCode = (typeof DOCUMENT_TYPE_CODES)[number];

export interface DocumentTypeRule {
  regex: RegExp;
  maxLength: number;
  label: string; // Spanish label, also used in error messages
}

export const DOCUMENT_TYPE_RULES: Record<DocumentTypeCode, DocumentTypeRule> = {
  CC: { regex: /^\d{6,10}$/, maxLength: 10, label: 'Cédula de Ciudadanía' },
  CE: { regex: /^\d{6,10}$/, maxLength: 10, label: 'Cédula de Extranjería' },
  NIT: { regex: /^\d{8,10}-?\d?$/, maxLength: 12, label: 'NIT' },
  TI: { regex: /^\d{8,11}$/, maxLength: 11, label: 'Tarjeta de Identidad' },
  RC: { regex: /^\d{8,11}$/, maxLength: 11, label: 'Registro Civil' },
  PA: { regex: /^[A-Z0-9]{5,16}$/, maxLength: 16, label: 'Pasaporte' },
  PEP: {
    regex: /^\d{9,15}$/,
    maxLength: 15,
    label: 'Permiso Especial de Permanencia',
  },
  PPT: {
    regex: /^\d{9,15}$/,
    maxLength: 15,
    label: 'Permiso por Protección Temporal',
  },
  DIE: {
    regex: /^[A-Z0-9]{5,20}$/,
    maxLength: 20,
    label: 'Documento de Identificación Extranjero',
  },
  NUIP: {
    regex: /^\d{8,11}$/,
    maxLength: 11,
    label: 'Número Único de Identificación Personal',
  },
};

export function isValidDocumentType(value: unknown): value is DocumentTypeCode {
  return (
    typeof value === 'string' &&
    (DOCUMENT_TYPE_CODES as readonly string[]).includes(value)
  );
}

/**
 * Spanish validation message listing every accepted code, e.g.
 * "Tipo de documento no válido. Usa CC, CE, ..., DIE o NUIP."
 */
export const DOCUMENT_TYPE_INVALID_MESSAGE = `Tipo de documento no válido. Usa ${DOCUMENT_TYPE_CODES.slice(0, -1).join(', ')} o ${DOCUMENT_TYPE_CODES[DOCUMENT_TYPE_CODES.length - 1]}.`;

/**
 * Normalizes a user-supplied document type before it reaches
 * `identification_type_enum` (uppercase in Prisma):
 * - `undefined` stays `undefined` (field not sent, nothing to update).
 * - `null`, empty or whitespace-only strings become `null` (clear the field).
 * - Any other string is trimmed and uppercased (`" cc "` → `"CC"`).
 * Non-string values are returned untouched so validators can reject them.
 */
export function normalizeDocumentType(value: unknown): unknown {
  if (value === undefined || value === null) return value;
  if (typeof value !== 'string') return value;
  const normalized = value.trim().toUpperCase();
  return normalized === '' ? null : normalized;
}

/**
 * Normalizes and validates a document type for writes to
 * `users.document_type`. Returns `undefined` (not sent), `null` (clear) or a
 * valid enum code; throws an Error with DOCUMENT_TYPE_INVALID_MESSAGE otherwise.
 */
export function parseUserDocumentType(
  value: unknown,
): DocumentTypeCode | null | undefined {
  const normalized = normalizeDocumentType(value);
  if (normalized === undefined || normalized === null) return normalized;
  if (!isValidDocumentType(normalized)) {
    throw new Error(DOCUMENT_TYPE_INVALID_MESSAGE);
  }
  return normalized;
}
