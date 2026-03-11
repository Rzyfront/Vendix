/**
 * Colombian tax type codes used in UBL 2.1 electronic invoicing.
 * These correspond to DIAN's tax classification system.
 */
export const DIAN_TAX_CODES = {
  /** IVA - Impuesto al Valor Agregado */
  IVA: '01',
  /** INC - Impuesto Nacional al Consumo */
  INC: '04',
  /** ICA - Impuesto de Industria y Comercio */
  ICA: '03',
} as const;

/**
 * Tax scheme names mapping for UBL TaxScheme elements.
 */
export const DIAN_TAX_NAMES: Record<string, string> = {
  '01': 'IVA',
  '03': 'ICA',
  '04': 'INC',
};

/**
 * Common IVA rates in Colombia.
 */
export const COMMON_IVA_RATES = {
  GENERAL: '19.00',
  REDUCED: '5.00',
  EXEMPT: '0.00',
} as const;
