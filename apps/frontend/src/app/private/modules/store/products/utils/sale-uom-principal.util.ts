/**
 * PR #1062 (ronda 2) — la unidad principal de venta fija la escala del precio
 * (`price_unit_quantity`). Elegirla o cambiarla nunca puede dejar el precio
 * digitado en la escala vieja: $25.000/kg no puede pasar a cobrarse por gramo.
 */

/** Escala de precio que impone una unidad: `factor / stockFactor`, entera ≥ 1. */
export function priceScaleFor(
  uomFactor: number,
  stockFactor: number,
): number | null {
  if (!(uomFactor > 0) || !(stockFactor > 0)) return null;
  const ratio = uomFactor / stockFactor;
  const scale = Math.round(ratio);
  return scale >= 1 && Math.abs(ratio - scale) <= 1e-6 ? scale : null;
}

/**
 * Principal por defecto entre las marcadas: se conserva la actual si sigue
 * marcada; si no, la que corresponde a la escala vigente del precio. Si
 * ninguna coincide devuelve `null` (PR #1062 ronda 3, H1): marcar g antes que
 * kg con precio por kg no puede fijar g ni reescalar; se espera a que se
 * marque la que coincide o a que el usuario la elija explícitamente.
 */
export function pickDefaultPrincipal(
  checkedIds: readonly number[],
  currentPrincipal: number | null,
  currentScale: number,
  scaleOf: (id: number) => number | null,
): number | null {
  if (checkedIds.length === 0) return null;
  if (currentPrincipal != null && checkedIds.includes(currentPrincipal)) {
    return currentPrincipal;
  }
  const matching = checkedIds.find((id) => scaleOf(id) === currentScale);
  return matching ?? null;
}

/**
 * Precio llevado de una escala a otra conservando el precio por unidad de
 * stock: $25.000 por 1000 g → $25 por 1 g. Redondeo a centavos.
 */
export function rescalePrice(
  price: number,
  fromScale: number,
  toScale: number,
): number {
  if (!(price > 0) || !(fromScale > 0) || !(toScale > 0)) return price;
  if (fromScale === toScale) return price;
  return Math.round(((price * toScale) / fromScale) * 100) / 100;
}

/** Precio de referencia (sin redondeo intermedio) y la escala en que se digitó. */
export interface PriceAnchor {
  value: number;
  scale: number;
}

/**
 * PR #1062 ronda 4 (punto 1) — reescalado sin deriva acumulada.
 *
 * `base_price` es `Decimal(12,2)`: $21.008,40/kg pasa a $21,01/g, y volver
 * a kg desde 21,01 daba 21.010 (el ida y vuelta no regresaba al precio
 * original). Si el precio vigente es justo la derivación redondeada del
 * ancla, el nuevo valor se deriva del ancla; si se editó a mano, el precio
 * vigente pasa a ser el ancla.
 */
export function rescalePriceAnchored(
  price: number,
  fromScale: number,
  toScale: number,
  anchor: PriceAnchor | null,
): { value: number; anchor: PriceAnchor } {
  const fromAnchor =
    anchor != null &&
    anchor.scale > 0 &&
    rescalePrice(anchor.value, anchor.scale, fromScale) === price;
  const source: PriceAnchor = fromAnchor
    ? anchor
    : { value: price, scale: fromScale };
  return {
    value: rescalePrice(source.value, source.scale, toScale),
    anchor: source,
  };
}

/** Lo mínimo de una fila de tarifa que el reescalado necesita leer. */
export interface TierOverrideRescaleRow {
  tier: { id: number; kind: string };
  enabled: boolean;
  override_price: number | null;
}

/**
 * PR #1062 ronda 5 (H2) — los precios fijos de las tarifas de cliente
 * (`customer_tier` habilitadas con `override_price`) están en la misma escala
 * que `base_price`: al cambiar la principal se reescalan con el mismo ancla.
 * Mayorista a $22.000/kg pasa a $22/g, no se queda en $22.000 por gramo. Las
 * presentaciones (`sale_unit`, precio por empaque) y las tarifas por
 * porcentaje (sin `override_price`) no se tocan.
 */
export function rescaleTierOverrides<T extends TierOverrideRescaleRow>(
  rows: readonly T[],
  fromScale: number,
  toScale: number,
  anchors: ReadonlyMap<number, PriceAnchor> | null,
): { rows: T[]; anchors: Map<number, PriceAnchor>; changed: number } {
  const nextAnchors = new Map(anchors ?? []);
  let changed = 0;
  const next = rows.map((row) => {
    const price = Number(row.override_price);
    if (
      row.tier.kind !== 'customer_tier' ||
      !row.enabled ||
      row.override_price == null ||
      !(price > 0)
    ) {
      return row;
    }
    const scaled = rescalePriceAnchored(
      price,
      fromScale,
      toScale,
      nextAnchors.get(row.tier.id) ?? null,
    );
    nextAnchors.set(row.tier.id, scaled.anchor);
    if (scaled.value === price) return row;
    changed++;
    return { ...row, override_price: scaled.value };
  });
  return { rows: next, anchors: nextAnchors, changed };
}

/** Cuántas tarifas de cliente tienen un precio fijo que se reescalaría. */
export function countRescalableTierOverrides(
  rows: readonly TierOverrideRescaleRow[],
): number {
  return rows.filter(
    (row) =>
      row.tier.kind === 'customer_tier' &&
      row.enabled &&
      Number(row.override_price) > 0,
  ).length;
}
