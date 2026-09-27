/**
 * F-090 (eje de código de F-053) — remediación de la "población 3" de
 * `aggregateOrderTaxes` (`invoicing.service.ts`): líneas de orden con
 * `tax_amount_item > 0` pero CERO filas `order_item_taxes` (origen
 * kitchen-fire / pasarela de pago / split de cuenta). Esa función PURA
 * deliberadamente no sintetiza la fila que falta (ver su docblock: "no se
 * sintetiza la fila que falta") porque no tiene acceso a ninguna fuente real
 * de tarifa — es una agregación sin DB, ejercitada por la matriz fiscal con
 * literales.
 *
 * `createFromOrder` (el llamador impuro, con Prisma) sí tiene acceso a dos
 * fuentes reales:
 *
 *   1. La asignación de impuesto del PRODUCTO (`product_tax_assignments` →
 *      `tax_categories` → `tax_rates`) — la fuente de verdad del catálogo.
 *   2. Una fila `order_item_taxes` REAL de otra línea de la MISMA orden
 *      (un "hermano" con desglose completo) — típico en una cuenta de
 *      restaurante donde unos platos sí traen filas y el huérfano es el
 *      mismo tributo sin desglosar.
 *
 * Este util resuelve esas dos fuentes, EN ESE ORDEN, y NUNCA inventa una
 * tercera: si ninguna explica el escalar persistido sin ambigüedad (dentro
 * de 1 ¢, la misma tolerancia que usa `FiscalDocumentValidator`), el
 * llamador debe cortar con `INVOICING_CALC_001` ANTES de tocar el
 * consecutivo DIAN — nunca sintetizar `tax_name`/`tax_type`/`tax_rate_id`
 * de la nada (ver `project_support_document_invents_tax_rate` en la
 * memoria del proyecto: "el documento soporte inventa la tarifa").
 *
 * Deliberadamente NO encadena el resultado de una línea huérfana como
 * candidato para OTRA línea huérfana de la misma orden: sólo las filas
 * REALES (población 2) alimentan `sibling_candidates`, para no propagar una
 * inferencia no verificada.
 */

/** Candidato de tarifa: la forma mínima para reconstruir un `tax_amount`. */
export interface OrphanTaxCandidate {
  tax_rate_id: number | null;
  tax_name: string;
  /** Fracción (0.08 = 8 %), misma unidad que `order_item_taxes.tax_rate`. */
  tax_rate: number;
  tax_type: string;
  is_inclusive: boolean;
}

export interface ResolveOrphanLineTaxInput {
  /** Base gravable de la línea huérfana (`order_items.total_price`, ya neta). */
  taxable_amount: number;
  /** Impuesto ya implícito en el escalar (`resolveOrderLineTaxTotal`). */
  tax_amount: number;
  product_candidates: OrphanTaxCandidate[];
  sibling_candidates: OrphanTaxCandidate[];
}

export type ResolveOrphanLineTaxResult =
  | { resolved: OrphanTaxCandidate; reason?: undefined }
  | {
      resolved: null;
      /** `no_match`: ninguna fuente lo explica. `ambiguous`: más de una lo explica igual de bien. */
      reason: 'no_match' | 'ambiguous';
      matches?: OrphanTaxCandidate[];
    };

/** Misma tolerancia que `FiscalDocumentValidator` (`ONE_CENT`) para no reñir con el prevalidador real. */
const ONE_CENT = 0.01;
/**
 * Colchón de punto flotante: `4000 - 4000.01` en `number` puede dar
 * `0.010000000000218279` (no exactamente `0.01`), y una comparación `<=`
 * estricta contra `ONE_CENT` rechazaría un caso que SÍ está dentro de 1 ¢.
 * El validador real evita esto operando en `Prisma.Decimal`; acá se prefiere
 * un épsilon minúsculo a arrastrar `Decimal` por un util que sólo compara
 * candidatos ya redondeados a centavos.
 */
const FLOAT_EPSILON = 1e-6;

const round2 = (n: number) => Math.round(n * 100) / 100;

const candidateKey = (c: OrphanTaxCandidate): string =>
  `${c.tax_rate_id ?? ''}|${c.tax_name}|${c.tax_type}|${c.tax_rate}|${c.is_inclusive ? '1' : '0'}`;

/**
 * Filtra `candidates` a los que reconstruyen `tax_amount` (dentro de 1 ¢)
 * a partir de `taxable_amount`, deduplicados por forma. La base de la línea
 * ya es neta (no inclusiva) — igual que `aggregateOrderTaxes` — así que la
 * cuota siempre es `taxable_amount × tax_rate`, sin importar si el catálogo
 * marca la categoría como inclusiva en el precio de venta.
 */
function matchCandidates(
  candidates: OrphanTaxCandidate[],
  taxable_amount: number,
  tax_amount: number,
): OrphanTaxCandidate[] {
  const seen = new Map<string, OrphanTaxCandidate>();
  for (const candidate of candidates) {
    const expected = round2(taxable_amount * Number(candidate.tax_rate || 0));
    if (Math.abs(expected - round2(tax_amount)) <= ONE_CENT + FLOAT_EPSILON) {
      const key = candidateKey(candidate);
      if (!seen.has(key)) seen.set(key, candidate);
    }
  }
  return Array.from(seen.values());
}

/**
 * Resuelve la tarifa de una línea huérfana en dos niveles: producto primero,
 * hermano real después. Nunca combina ambos niveles ni cae a un tercer
 * criterio inventado.
 */
export function resolveOrphanLineTax(
  input: ResolveOrphanLineTaxInput,
): ResolveOrphanLineTaxResult {
  const productMatches = matchCandidates(
    input.product_candidates,
    input.taxable_amount,
    input.tax_amount,
  );
  if (productMatches.length === 1) return { resolved: productMatches[0] };
  if (productMatches.length > 1) {
    return { resolved: null, reason: 'ambiguous', matches: productMatches };
  }

  const siblingMatches = matchCandidates(
    input.sibling_candidates,
    input.taxable_amount,
    input.tax_amount,
  );
  if (siblingMatches.length === 1) return { resolved: siblingMatches[0] };
  if (siblingMatches.length > 1) {
    return { resolved: null, reason: 'ambiguous', matches: siblingMatches };
  }

  return { resolved: null, reason: 'no_match' };
}

/**
 * Candidatos desde el catálogo: `products.product_tax_assignments` →
 * `tax_categories` → `tax_rates`. Las asignaciones viven sólo a nivel
 * producto (las variantes heredan la tarifa del producto, ver
 * `vendix-calculated-pricing`), así que no hace falta leer `product_variants`
 * acá. Defensivo ante formas parciales: un `include` que no llegó a anidar
 * `tax_categories`/`tax_rates` (p. ej. un fixture de test) simplemente no
 * aporta candidatos — nunca lanza.
 */
export function extractProductTaxCandidates(
  products: unknown,
): OrphanTaxCandidate[] {
  const assignments = (products as { product_tax_assignments?: unknown[] })
    ?.product_tax_assignments;
  if (!Array.isArray(assignments)) return [];

  const out: OrphanTaxCandidate[] = [];
  for (const assignment of assignments as Array<Record<string, unknown>>) {
    const category = assignment?.tax_categories as
      | Record<string, unknown>
      | undefined;
    const rates = category?.tax_rates;
    if (!category || !Array.isArray(rates)) continue;

    const tax_type = ((category.tax_type as string) || 'iva')
      .toString()
      .toLowerCase();
    // Override por asignación si viene explícito; si no, el default de la
    // categoría. `!= null` (no `??`) porque `false` es un valor válido.
    const is_inclusive =
      assignment.is_inclusive != null
        ? assignment.is_inclusive === true
        : category.is_inclusive === true;

    for (const rate of rates as Array<Record<string, unknown>>) {
      if (!rate) continue;
      out.push({
        tax_rate_id: typeof rate.id === 'number' ? rate.id : null,
        tax_name: (rate.name as string) || tax_type.toUpperCase(),
        tax_rate: Number(rate.rate || 0),
        tax_type,
        is_inclusive,
      });
    }
  }
  return out;
}

/** Forma mínima que necesita `buildSiblingTaxCandidates` de cada línea de la orden. */
export interface SiblingTaxSourceLine {
  order_item_taxes?: Array<{
    tax_rate_id?: unknown;
    tax_name: string;
    tax_rate?: unknown;
    tax_type?: unknown;
    is_inclusive?: unknown;
  }> | null;
}

/**
 * Candidatos desde las filas REALES `order_item_taxes` de cualquier línea de
 * la MISMA orden (población 2 de `aggregateOrderTaxes`). Deduplicados por
 * forma — una cuenta de restaurante con diez platos INC 8 % no produce diez
 * candidatos idénticos.
 */
export function buildSiblingTaxCandidates(
  order_items: SiblingTaxSourceLine[] | null | undefined,
): OrphanTaxCandidate[] {
  const seen = new Map<string, OrphanTaxCandidate>();
  for (const item of order_items || []) {
    for (const row of item.order_item_taxes || []) {
      const tax_type = ((row.tax_type as string) || 'iva')
        .toString()
        .toLowerCase();
      const candidate: OrphanTaxCandidate = {
        tax_rate_id: typeof row.tax_rate_id === 'number' ? row.tax_rate_id : null,
        tax_name: row.tax_name,
        tax_rate: Number(row.tax_rate || 0),
        tax_type,
        is_inclusive: row.is_inclusive === true,
      };
      const key = candidateKey(candidate);
      if (!seen.has(key)) seen.set(key, candidate);
    }
  }
  return Array.from(seen.values());
}
