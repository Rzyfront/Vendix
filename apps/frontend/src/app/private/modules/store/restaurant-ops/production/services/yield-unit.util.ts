/** Plural forms for the word-like yield units of the recipe unit catalog. */
const YIELD_UNIT_PLURALS: Record<string, string> = {
  porción: 'porciones',
  porcion: 'porciones',
  plato: 'platos',
  unidad: 'unidades',
  ración: 'raciones',
  racion: 'raciones',
};

/**
 * Unit label in Spanish for a quantity: word units take the plural when the
 * quantity is not exactly 1 ("4 unidad" → "4 unidades"); symbols such as
 * g, kg, ml or L never change.
 */
export function pluralizeYieldUnit(
  quantity: number | string | null | undefined,
  unit: string | null | undefined,
): string {
  const label = (unit ?? '').trim();
  if (!label) return '';
  const plural = YIELD_UNIT_PLURALS[label.toLowerCase()];
  if (!plural) return label;
  return Number(quantity) === 1 ? label : plural;
}

/** "4 unidades", "1 plato", "250 g". */
export function formatYieldQuantity(
  quantity: number | string | null | undefined,
  unit: string | null | undefined,
  formatted: string = String(quantity ?? 0),
): string {
  return `${formatted} ${pluralizeYieldUnit(quantity, unit)}`.trim();
}
