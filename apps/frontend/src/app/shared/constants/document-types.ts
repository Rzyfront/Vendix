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

export interface DocumentTypeOption {
  code: DocumentTypeCode;
  label: string;
  shortLabel: string;
  placeholder: string;
  maxLength: number;
  regex: RegExp;
}

export const DOCUMENT_TYPES: DocumentTypeOption[] = [
  {
    code: 'CC',
    label: 'Cédula de Ciudadanía',
    shortLabel: 'CC',
    placeholder: '1023456789',
    maxLength: 10,
    regex: /^\d{6,10}$/,
  },
  {
    code: 'CE',
    label: 'Cédula de Extranjería',
    shortLabel: 'CE',
    placeholder: '1023456789',
    maxLength: 10,
    regex: /^\d{6,10}$/,
  },
  {
    code: 'NIT',
    label: 'NIT',
    shortLabel: 'NIT',
    placeholder: '900123456-7',
    maxLength: 12,
    regex: /^\d{8,10}-?\d?$/,
  },
  {
    code: 'TI',
    label: 'Tarjeta de Identidad',
    shortLabel: 'TI',
    placeholder: '1012345678',
    maxLength: 11,
    regex: /^\d{8,11}$/,
  },
  {
    code: 'RC',
    label: 'Registro Civil',
    shortLabel: 'RC',
    placeholder: '1012345678',
    maxLength: 11,
    regex: /^\d{8,11}$/,
  },
  {
    code: 'PA',
    label: 'Pasaporte',
    shortLabel: 'PA',
    placeholder: 'AB123456',
    maxLength: 16,
    regex: /^[A-Z0-9]{5,16}$/,
  },
  {
    code: 'PEP',
    label: 'Permiso Especial de Permanencia',
    shortLabel: 'PEP',
    placeholder: '123456789',
    maxLength: 15,
    regex: /^\d{9,15}$/,
  },
  {
    code: 'PPT',
    label: 'Permiso por Protección Temporal',
    shortLabel: 'PPT',
    placeholder: '123456789',
    maxLength: 15,
    regex: /^\d{9,15}$/,
  },
  {
    code: 'DIE',
    label: 'Documento de Identificación Extranjero',
    shortLabel: 'DIE',
    placeholder: 'AB12345678',
    maxLength: 20,
    regex: /^[A-Z0-9]{5,20}$/,
  },
  {
    code: 'NUIP',
    label: 'Número Único de Identificación Personal',
    shortLabel: 'NUIP',
    placeholder: '1012345678',
    maxLength: 11,
    regex: /^\d{8,11}$/,
  },
];

const DOCUMENT_TYPE_INDEX: Record<string, DocumentTypeOption> = DOCUMENT_TYPES.reduce(
  (acc, option) => {
    acc[option.code] = option;
    return acc;
  },
  {} as Record<string, DocumentTypeOption>,
);

export function findDocumentType(code: string | null | undefined): DocumentTypeOption | undefined {
  if (!code) return undefined;
  return DOCUMENT_TYPE_INDEX[code.toUpperCase()];
}

export function getDocumentTypeLabel(code: string | null | undefined): string {
  return findDocumentType(code)?.label ?? 'Sin clasificar';
}

export function isValidDocumentType(value: unknown): value is DocumentTypeCode {
  return typeof value === 'string' && value in DOCUMENT_TYPE_INDEX;
}

/** `{ value, label }` options for document-type selectors (uppercase enum codes). */
export const DOCUMENT_TYPE_SELECT_OPTIONS: { value: DocumentTypeCode; label: string }[] =
  DOCUMENT_TYPES.map((t) => ({ value: t.code, label: t.label }));

/** Legacy selector values that older forms sent and the backend enum never accepted. */
const LEGACY_DOCUMENT_TYPE_ALIASES: Record<string, DocumentTypeCode> = {
  PAS: 'PA',
  PASSPORT: 'PA',
};

/**
 * Normalizes a document type before sending it to `users.document_type`
 * (backend `identification_type_enum`, uppercase): trims, uppercases and maps
 * legacy aliases (`'pas'` → `'PA'`). Empty or unknown values become `null` so
 * the field is cleared instead of failing the whole save.
 */
export function toDocumentTypeCode(value: unknown): DocumentTypeCode | null {
  if (typeof value !== 'string') return null;
  const upper = value.trim().toUpperCase();
  const code = LEGACY_DOCUMENT_TYPE_ALIASES[upper] ?? upper;
  return isValidDocumentType(code) ? code : null;
}
