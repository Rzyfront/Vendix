/**
 * Fiscal responsibilities (responsabilidades fiscales) — RUT field 9 catalog.
 *
 * This is the frontend mirror of the backend `fiscal-responsibilities.ts`
 * catalog. It MUST stay identical to the backend list — codes absent from the
 * backend DTO validator will be rejected with CUSTOMER_INVALID_FISCAL_RESPONSIBILITY,
 * and codes absent here will look like untranslated garbage in the UI.
 *
 * Notes:
 * - The RUT primary "responsabilidad" (field 8 / TaxLevelCode) is a single value
 *   selected from this list. The full multi-select lets the merchant record every
 *   código adicional marcado en el RUT del cliente (gran contribuyente +
 *   autorretenedor + IVA, etc.).
 * - These codes are concatenated with `;` in `cac:TaxScheme/cbc:TaxLevelCode`
 *   when emitting UBL 2.1 (Anexo Técnico 19 de la DIAN).
 */
export const FISCAL_RESPONSIBILITIES = [
  'R-99-PN',
  'O-13',
  'O-14',
  'O-15',
  'O-16',
  'O-17',
  'O-19',
  'O-22',
  'O-23',
  'O-32',
  'O-33',
  'O-47',
  'O-48',
  'O-49',
] as const;

/** Type-level union of the catalog (e.g. for `FormControl<FiscalResponsibility[]>`). */
export type FiscalResponsibility = (typeof FISCAL_RESPONSIBILITIES)[number];

/**
 * Localized labels for each RUT code. Keys are exhaustive over `FiscalResponsibility`
 * so an unknown code is a compile error.
 *
 * Labels are short enough to render in a multi-select chip without truncation.
 */
export const FISCAL_RESPONSIBILITY_LABELS: Record<
  FiscalResponsibility,
  string
> = {
  'R-99-PN': 'No aplica - Persona natural consumidor',
  'O-13': 'Gran contribuyente',
  'O-14': 'Informante de precios de transferencia',
  'O-15': 'Autorretenedor',
  'O-16': 'Obligado a llevar libros',
  'O-17': 'Responsable de IVA (legacy)',
  'O-19': 'Responsable de INC',
  'O-22': 'No responsable de IVA (legacy)',
  'O-23': 'Agente de retención IVA',
  'O-32': 'Responsable de ICUI (bebidas azucaradas)',
  'O-33': 'Responsable de INC (ultraprocesados)',
  'O-47': 'Régimen simple de tributación',
  'O-48': 'Responsable de IVA',
  'O-49': 'No responsable de IVA',
};

/** Look up the label for a code; falls back to the raw code so unknown values are still visible. */
export function getFiscalResponsibilityLabel(
  code: string | null | undefined,
): string {
  if (!code) return '';
  return (
    FISCAL_RESPONSIBILITY_LABELS[code as FiscalResponsibility] ?? code
  );
}

/**
 * Guard for typed narrowing. Useful when decoding FormControl values received
 * from the backend where the type is widened to `string[]`.
 */
export function isFiscalResponsibility(
  value: unknown,
): value is FiscalResponsibility {
  return (
    typeof value === 'string' &&
    (FISCAL_RESPONSIBILITIES as readonly string[]).includes(value)
  );
}
