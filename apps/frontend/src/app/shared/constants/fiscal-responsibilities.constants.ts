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
  'O-01',
  'O-02',
  'O-03',
  'O-04',
  'O-05',
  'O-06',
  'O-07',
  'O-08',
  'O-09',
  'O-10',
  'O-11',
  'O-12',
  'O-13',
  'O-14',
  'O-15',
  'O-16',
  'O-17',
  'O-18',
  'O-19',
  'O-20',
  'O-21',
  'O-22',
  'O-23',
  'O-24',
  'O-26',
  'O-32',
  'O-33',
  'O-35',
  'O-36',
  'O-37',
  'O-38',
  'O-39',
  'O-41',
  'O-42',
  'O-45',
  'O-46',
  'O-47',
  'O-48',
  'O-49',
  'O-50',
  'O-51',
  'O-52',
  'O-53',
  'O-54',
  'O-55',
  'O-56',
  'O-57',
  'O-58',
  'O-59',
  'O-60',
  'O-61',
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
  'O-01': 'Aporte especial para la administración de justicia',
  'O-02': 'Gravamen a los movimientos financieros (GMF)',
  'O-03': 'Impuesto al patrimonio (histórico)',
  'O-04': 'Impuesto sobre la renta - Régimen tributario especial',
  'O-05': 'Impuesto sobre la renta - Régimen ordinario',
  'O-06': 'Ingresos y patrimonio',
  'O-07': 'Retención en la fuente a título de renta',
  'O-08': 'Retención timbre nacional',
  'O-09': 'Retención en la fuente en el impuesto sobre las ventas (IVA)',
  'O-10': 'Obligado aduanero (usuario aduanero)',
  'O-11': 'Ventas régimen común (histórico)',
  'O-12': 'Ventas régimen simplificado (histórico)',
  'O-13': 'Gran contribuyente',
  'O-14': 'Informante de exógena',
  'O-15': 'Autorretenedor',
  'O-16': 'Obligado a facturar por ingresos excluidos',
  'O-17': 'Profesionales de compra y venta de divisas',
  'O-18': 'Precios de transferencia',
  'O-19': 'Productor y/o exportador de bienes exentos',
  'O-20': 'Obtención de NIT',
  'O-21': 'Declarar ingreso o salida de divisas o moneda legal',
  'O-22': 'Obligado a cumplir deberes formales a nombre de terceros',
  'O-23': 'Agente de retención IVA (ReteIVA)',
  'O-24': 'Declaración consolidada precios de transferencia',
  'O-26': 'Declaración individual precios de transferencia',
  'O-32': 'Impuesto nacional a la gasolina y al ACPM',
  'O-33': 'Impuesto nacional al consumo (INC)',
  'O-35': 'Impuesto al patrimonio personas jurídicas (derogada)',
  'O-36': 'Establecimiento permanente (derogada)',
  'O-37': 'Obligado a facturar electrónicamente (derogada / ver 52)',
  'O-38': 'Facturación electrónica voluntaria (derogada / ver 52)',
  'O-39': 'Proveedor de servicios tecnológicos PST (derogada)',
  'O-41': 'Declaración anual de activos en el exterior',
  'O-42': 'Obligado a llevar contabilidad',
  'O-45': 'Autorretenedor de rendimientos financieros',
  'O-46': 'IVA prestadores de servicios desde el exterior (derogada)',
  'O-47': 'Régimen simple de tributación',
  'O-48': 'Responsable de IVA',
  'O-49': 'No responsable de IVA',
  'O-50': 'No responsable de consumo restaurantes y bares',
  'O-51': 'Agente de retención impoconsumo bienes inmuebles',
  'O-52': 'Facturador electrónico',
  'O-53': 'Persona jurídica no responsable de IVA',
  'O-54': 'Intercambio automático de información CRS',
  'O-55': 'Informante de beneficiarios finales (RUB)',
  'O-56': 'Impuesto nacional al carbono',
  'O-57': 'Declaración de activos en el exterior simplificada',
  'O-58': 'Intercambio automático de información FATCA',
  'O-59': 'Autorretención especial de renta',
  'O-60': 'Autorretención intereses y rendimientos financieros',
  'O-61': 'Régimen tributario especial - sector cooperativo',
};

/**
 * Normaliza cualquier código de responsabilidad fiscal a su forma canónica 'O-XX' o 'R-99-PN'.
 * Acepta códigos numéricos directos de la casilla 53 del RUT (ej: '48' -> 'O-48', '5' -> 'O-05'),
 * códigos ya prefijados en minúsculas o mayúsculas ('o-48' -> 'O-48', 'O-5' -> 'O-05'),
 * y reescribe códigos ficticios o descontinuados como 'R-99-PJ' hacia 'R-99-PN' (ADR-04).
 */
export function normalizeFiscalResponsibilityCode(
  code: string | null | undefined,
): string {
  if (!code) return '';
  const trimmed = code.trim().toUpperCase();
  if (!trimmed) return '';

  if (trimmed === 'R-99-PN' || trimmed === 'R-99-PJ') {
    return 'R-99-PN';
  }

  const numericPart = trimmed.startsWith('O-') ? trimmed.slice(2) : trimmed;
  if (/^\d+$/.test(numericPart)) {
    return `O-${numericPart.padStart(2, '0')}`;
  }

  return trimmed;
}

/** Look up the label for a code; falls back to the raw code so unknown values are still visible. */
export function getFiscalResponsibilityLabel(
  code: string | null | undefined,
): string {
  if (!code) return '';
  const normalized = normalizeFiscalResponsibilityCode(code);
  return (
    FISCAL_RESPONSIBILITY_LABELS[normalized as FiscalResponsibility] ??
    FISCAL_RESPONSIBILITY_LABELS[code as FiscalResponsibility] ??
    code
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
    (FISCAL_RESPONSIBILITIES as readonly string[]).includes(
      normalizeFiscalResponsibilityCode(value) as FiscalResponsibility,
    )
  );
}
