import { computeNitDv } from '../utils/nit.util';
import { isVatResponsible } from './vat-responsibility.helper';

/**
 * Traduce `settings.fiscal_data` (vocabulario de formulario) a las columnas
 * reales de `organizations` (vocabulario DIAN).
 *
 * Son DOS vocabularios distintos para los mismos conceptos, y copiarlos tal cual
 * es un bug silencioso: el emisor lee las columnas para armar
 * `cac:AccountingCustomerParty`, así que un `'JURIDICA'` guardado donde la DIAN
 * espera `'1'` produce un XML que se rechaza sin explicar por qué.
 *
 *   fiscal_data (JSON)              organizations (columna)
 *   ─────────────────────────────   ───────────────────────────────────────
 *   nit_type: 'NIT' | 'CC' | ...    document_type: '31' | '13' | ...
 *   person_type: 'JURIDICA'         person_type: '1'  (cbc:AdditionalAccountID)
 *   tax_responsibilities: ['O-48']  tax_regime: '48'  (PartyTaxScheme)
 *                                   fiscal_responsibilities: ['O-48'] (copia)
 *
 * Semántica PATCH: solo se devuelve una columna cuando el campo que la alimenta
 * viene en el patch. Un PATCH que solo trae `legal_name` no debe borrar el NIT.
 */

/** DIAN, tipos de documento de identificación (anexo técnico, tabla 13.2.1). */
export const DIAN_DOCUMENT_TYPE_BY_NIT_TYPE: Record<string, string> = {
  NIT: '31',
  CC: '13',
  CE: '22',
  TI: '12',
  PP: '41',
  NIT_EXTRANJERIA: '50',
};

/** `cbc:AdditionalAccountID`: 1 = Persona Jurídica, 2 = Persona Natural. */
export const DIAN_PERSON_TYPE_BY_LABEL: Record<string, string> = {
  JURIDICA: '1',
  NATURAL: '2',
};

/** Código DIAN del NIT — el único tipo de documento que lleva DV. */
const DIAN_DOCUMENT_TYPE_NIT = '31';

export interface OrganizationFiscalColumns {
  legal_name?: string | null;
  tax_id?: string | null;
  verification_digit?: string | null;
  document_type?: string | null;
  person_type?: string | null;
  tax_regime?: string | null;
  fiscal_responsibilities?: string[];
  ciiu_code?: string | null;
}

/** Lee una clave del patch solo si viene presente y es string; si no, undefined. */
function readTrimmed(
  patch: Record<string, unknown>,
  key: string,
): string | undefined {
  if (!(key in patch)) return undefined;
  const value = patch[key];
  return typeof value === 'string' ? value.trim() : undefined;
}

/** Primera clave presente con valor string. Soporta alias (`tax_id` / `nit`). */
function readFirst(
  patch: Record<string, unknown>,
  keys: string[],
): string | undefined {
  for (const key of keys) {
    const value = readTrimmed(patch, key);
    if (value !== undefined) return value;
  }
  return undefined;
}

/**
 * @param patch Campos que llegaron en el PATCH (ya sin `store_id`).
 * @param merged `fiscal_data` resultante tras el merge — necesario porque
 *   `tax_regime` depende de `tax_responsibilities`, que puede venir de un PATCH
 *   anterior y no del actual.
 */
export function buildOrganizationFiscalColumns(
  patch: Record<string, unknown>,
  merged: { tax_responsibilities?: unknown; tax_regime?: unknown },
): OrganizationFiscalColumns {
  const columns: OrganizationFiscalColumns = {};

  const legalName = readTrimmed(patch, 'legal_name');
  if (legalName !== undefined) columns.legal_name = legalName || null;

  const ciiuCode = readTrimmed(patch, 'ciiu_code');
  if (ciiuCode !== undefined) columns.ciiu_code = ciiuCode || null;

  const nitType = readTrimmed(patch, 'nit_type');
  if (nitType !== undefined) {
    // Un tipo desconocido se guarda como null en vez de propagarse crudo: es
    // preferible una columna vacía a un código que la DIAN no reconoce.
    columns.document_type = DIAN_DOCUMENT_TYPE_BY_NIT_TYPE[nitType] ?? null;
  }

  const personType = readTrimmed(patch, 'person_type');
  if (personType !== undefined) {
    columns.person_type =
      DIAN_PERSON_TYPE_BY_LABEL[personType.toUpperCase()] ?? null;
  }

  const taxId = readFirst(patch, ['tax_id', 'nit']);
  if (taxId !== undefined) {
    columns.tax_id = taxId || null;
    // El DV se DERIVA, nunca se copia del formulario (ver nit.util.ts). Solo el
    // NIT lo lleva; una cédula con DV es un dato inventado.
    const documentType =
      columns.document_type !== undefined
        ? columns.document_type
        : DIAN_DOCUMENT_TYPE_NIT;
    columns.verification_digit =
      taxId && documentType === DIAN_DOCUMENT_TYPE_NIT
        ? computeNitDv(taxId) || null
        : null;
  }

  if ('tax_responsibilities' in patch) {
    const responsibilities = Array.isArray(patch.tax_responsibilities)
      ? (patch.tax_responsibilities as unknown[]).filter(
          (code): code is string => typeof code === 'string',
        )
      : [];
    columns.fiscal_responsibilities = responsibilities;
  }

  // `tax_regime` en columna es '48'/'49' (responsable o no de IVA), NO el
  // régimen COMUN/SIMPLIFICADO del formulario. Se resuelve con el mismo helper
  // canónico que usan productos y ventas, para que no existan dos verdades.
  if ('tax_responsibilities' in patch || 'tax_regime' in patch) {
    columns.tax_regime = isVatResponsible(merged) ? '48' : '49';
  }

  return columns;
}
