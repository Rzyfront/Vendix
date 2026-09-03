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

export type FiscalResponsibilityCode =
  (typeof FISCAL_RESPONSIBILITIES)[number];

export const FISCAL_RESPONSIBILITY_LABELS: Record<
  FiscalResponsibilityCode,
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
