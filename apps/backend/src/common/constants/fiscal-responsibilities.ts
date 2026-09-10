/**
 * Catálogo canónico de responsabilidades fiscales del RUT (DIAN).
 *
 * La DIAN emite un Registro Único Tributario (RUT) por cada contribuyente y en
 * él lista las responsabilidades fiscales que la persona o empresa debe asumir
 * ante la autoridad tributaria (Gran Contribuyente, Autorretenedor, Régimen
 * Simple, Responsable de IVA, etc.). Estas responsabilidades son las que el
 * XML UBL Anexo Técnico 19 declara en `cac:TaxScheme/cbc:TaxLevelCode`.
 * `cbc:AdditionalAccountID` NO las lleva: ese elemento declara únicamente el
 * TIPO DE PERSONA del receptor (1 jurídica / 2 natural, lista
 * `TipoOrganizacion-2.1.gc`) y es 1..1 en el perfil DIAN. Confundir ambos
 * elementos —tratar `AdditionalAccountID` como si aceptara responsabilidades
 * del RUT— causó el rechazo real en producción de FVJL7 y FVJL8 (Receptor
 * debe ser persona natural o jurídica); no reintroducir esa premisa.
 *
 * Single source of truth para el backend y el frontend (mirror en
 * `apps/frontend/src/app/shared/constants/fiscal-responsibilities.constants.ts`).
 * Cualquier cambio aquí debe replicarse en el frontend para evitar drift de UI.
 *
 * Mantener sincronizado con:
 * - Anexo Técnico 19 DIAN
 * - Resolución DIAN 000012 de 2021
 * - Estatuto Tributario Art. 437 (Responsable de IVA), Art. 616-1 (INC)
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

export type FiscalResponsibilityCode =
  (typeof FISCAL_RESPONSIBILITIES)[number];

export const FISCAL_RESPONSIBILITY_LABELS: Record<
  FiscalResponsibilityCode,
  string
> = {
  'R-99-PN': 'No aplica - Persona natural consumidor',
  'O-01': 'Aporte especial para la administración de justicia',
  'O-02': 'Gravamen a los movimientos financieros (GMF)',
  'O-03': 'Impuesto al patrimonio (histórico)',
  'O-04': 'Impuesto sobre la renta - Régimen tributario especial',
  'O-05': 'Impuesto sobre la renta - Régimen ordinario',
  'O-06': 'Declaración de ingresos y patrimonio',
  'O-07': 'Retención en la fuente a título de renta',
  'O-08': 'Retención timbre nacional',
  'O-09': 'Retención en la fuente en el impuesto sobre las ventas (IVA)',
  'O-10': 'Obligado aduanero (usuario aduanero)',
  'O-11': 'Ventas régimen común (histórico)',
  'O-12': 'Ventas régimen simplificado (histórico)',
  'O-13': 'Gran contribuyente',
  'O-14': 'Informante de información exógena',
  'O-15': 'Autorretenedor',
  'O-16': 'Obligación de facturar por ingresos excluidos',
  'O-17': 'Profesionales de compra y venta de divisas',
  'O-18': 'Precios de transferencia',
  'O-19': 'Productor y/o exportador de bienes exentos',
  'O-20': 'Obtención de NIT',
  'O-21': 'Declarar ingreso/salida del país de divisas/moneda',
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
  'O-47': 'Régimen Simple de Tributación (SIMPLE)',
  'O-48': 'Responsable del impuesto sobre las ventas (IVA)',
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
  'O-60': 'Autorretención por intereses y rendimientos financieros',
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

/**
 * Returns true si el código pertenece al catálogo RUT canónico.
 * Útil para validación ad-hoc en servicios sin pasar por el DTO.
 */
export function isValidFiscalResponsibility(
  value: unknown,
): value is FiscalResponsibilityCode {
  return (
    typeof value === 'string' &&
    (FISCAL_RESPONSIBILITIES as readonly string[]).includes(value)
  );
}
