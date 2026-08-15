/**
 * Tax regime (régimen tributario) catalog for Colombian clients.
 *
 * This is the frontend mirror of the backend `tax_regime_enum` (DIAN RUT field
 * 8 "Régimen"). It MUST match the backend enumeration exactly — a value present
 * here but absent from the backend DTO will silently strip on save.
 *
 * Six canonical regimes per Anexo Técnico 19 / Estatuto Tributario:
 * - COMUN (Responsable de IVA / régimen ordinario)
 * - SIMPLIFICADO (Régimen simplificado — personas naturales con topes)
 * - GRAN_CONTRIBUYENTE (Resolución DIAN de gran contribuyente)
 * - AUTORRETENEDOR (Resolución DIAN de autorretenedor)
 * - ESPECIAL (Régimen especial — entidades sin ánimo de lucro, etc.)
 * - NO_APLICA (clientes finales ocasionales que no requieren RUT)
 */
export interface TaxRegimeOption {
  /** Value persisted in `users.tax_regime`; must match `tax_regime_enum`. */
  value: string;
  /** Display label for selectors, chips, error messages. */
  label: string;
}

export const TAX_REGIMES: ReadonlyArray<TaxRegimeOption> = [
  { value: 'COMUN', label: 'Régimen común' },
  { value: 'SIMPLIFICADO', label: 'Régimen simplificado' },
  { value: 'GRAN_CONTRIBUYENTE', label: 'Gran contribuyente' },
  { value: 'AUTORRETENEDOR', label: 'Autorretenedor' },
  { value: 'ESPECIAL', label: 'Régimen especial' },
  { value: 'NO_APLICA', label: 'No aplica' },
];

/**
 * Union type for the six regime values. Useful for typed FormControls and
 * exhaustive matching in switch statements.
 */
export type TaxRegimeValue = typeof TAX_REGIMES[number]['value'];

/** Look up the display label for a regime code; falls back to the raw value. */
export function getTaxRegimeLabel(code: string | null | undefined): string {
  if (!code) return '';
  const found = TAX_REGIMES.find((r) => r.value === code);
  return found?.label ?? code;
}
