/**
 * Deterministic fiscal classification helpers for the withholding engine.
 *
 * Reconciles free-text `tax_regime` / `person_type` fields (suppliers, users,
 * tenant fiscal_data) into the closed `withholding_supplier_type_enum` domain so
 * the resolver's legal gates never depend on arbitrary string matching.
 *
 * Pure functions — no DB, no NestJS. Safe to unit test in isolation.
 */

export type CounterpartyType =
  | 'gran_contribuyente'
  | 'regimen_simple'
  | 'persona_natural'
  | 'any';

/** Uppercase + trim a possibly-null free-text fiscal field. */
function normalize(value?: string | null): string {
  return (value ?? '').trim().toUpperCase();
}

const GRAN_CONTRIBUYENTE_REGIMES = new Set([
  'GRAN_CONTRIBUYENTE',
  'GRAN CONTRIBUYENTE',
]);

const SIMPLE_REGIMES = new Set([
  'SIMPLIFICADO',
  'SIMPLE',
  'RST',
  'REGIMEN SIMPLE',
  'REGIMEN_SIMPLE',
  'RÉGIMEN SIMPLE',
]);

const NATURAL_PERSON_TYPES = new Set([
  'NATURAL',
  'PERSONA_NATURAL',
  'PERSONA NATURAL',
]);

/**
 * Maps free-text tax_regime / person_type into the closed counterparty domain.
 *
 * Precedence (deterministic):
 *  1. tax_regime ∈ gran contribuyente  → 'gran_contribuyente'
 *  2. tax_regime ∈ simple/RST          → 'regimen_simple'
 *  3. person_type ∈ natural            → 'persona_natural'
 *  4. otherwise                        → 'any'
 */
export function deriveCounterpartyType(
  taxRegime?: string | null,
  personType?: string | null,
): CounterpartyType {
  const regime = normalize(taxRegime);
  const person = normalize(personType);

  if (GRAN_CONTRIBUYENTE_REGIMES.has(regime)) return 'gran_contribuyente';
  if (SIMPLE_REGIMES.has(regime)) return 'regimen_simple';
  if (NATURAL_PERSON_TYPES.has(person)) return 'persona_natural';
  return 'any';
}

/**
 * True when the given tax_regime denotes a régimen simple / RST taxpayer.
 * Used to gate retefuente in CASO 2 (régimen simple no le retienen renta).
 */
export function isSimpleRegime(taxRegime?: string | null): boolean {
  return SIMPLE_REGIMES.has(normalize(taxRegime));
}
