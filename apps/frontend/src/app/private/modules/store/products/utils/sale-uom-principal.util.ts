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
 * marcada; si no, la que corresponde a la escala vigente del precio; solo si
 * ninguna coincide, la primera marcada (y el precio se reescala).
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
  return matching ?? checkedIds[0];
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
