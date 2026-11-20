/**
 * Dónde se produce cada producto: `kitchen` = Cocina (Producción),
 * `plant` = Planta. Espejo de `production-site.util.ts` del backend.
 */
export type ProductionSite = 'kitchen' | 'plant';

type Industries = readonly string[] | null | undefined;

const has = (industries: Industries, industry: string) =>
  (industries ?? []).includes(industry);

/**
 * La tienda manda a producción las líneas producibles (selector Del stock / A
 * producción en el POS): restaurante (Cocina) y manufactura (Planta). Espeja la
 * compuerta de `resolveLineDestinations` del backend.
 */
export function usesProductionDestinations(industries: Industries): boolean {
  return has(industries, 'restaurant') || has(industries, 'manufacturing');
}

/** El formulario muestra "Dónde se produce": con manufactura y producto por lote. */
export function productionSiteVisible(industries: Industries, isBatchProduced: boolean): boolean {
  return has(industries, 'manufacturing') && isBatchProduced === true;
}

/** Restaurante + manufactura: la industria no decide, el producto debe decirlo. */
export function productionSiteRequired(industries: Industries, isBatchProduced: boolean): boolean {
  return productionSiteVisible(industries, isBatchProduced) && has(industries, 'restaurant');
}

/** Aviso "Elige dónde se produce": obligatorio y vacío (también productos existentes). */
export function productionSiteMissing(
  industries: Industries,
  isBatchProduced: boolean,
  site: string | null | undefined,
): boolean {
  return productionSiteRequired(industries, isBatchProduced) && !site;
}

/** Opciones del selector: Cocina solo existe si la tienda es restaurante. */
export function productionSiteOptions(
  industries: Industries,
): Array<{ value: ProductionSite; label: string }> {
  return [
    ...(has(industries, 'restaurant')
      ? [{ value: 'kitchen' as const, label: 'Cocina (Producción)' }]
      : []),
    { value: 'plant' as const, label: 'Planta' },
  ];
}
