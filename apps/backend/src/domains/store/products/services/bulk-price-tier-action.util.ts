import { RelationalActionMode } from '../dto/bulk-edit-products.dto';

/**
 * Acción masiva de tarifas — resolución PURA compartida por el preview y el
 * apply de la edición masiva. Lo que el preview anuncia es exactamente lo que
 * el apply envía a `ProductsService.update()`.
 */

/** Conjunto destino de tarifas de UN producto según el modo de la acción. */
export function resolveBulkPriceTierTarget(
  mode: RelationalActionMode,
  ids: number[],
  currentIds: number[],
): number[] {
  const current = [...new Set(currentIds)];
  if (mode === RelationalActionMode.REPLACE) {
    return [...new Set(ids)];
  }
  if (mode === RelationalActionMode.REMOVE) {
    // Ids que el producto no tiene no son error: simplemente no cambian nada.
    const removed = new Set(ids);
    return current.filter((id) => !removed.has(id));
  }
  return [...new Set([...current, ...ids])];
}

export interface BulkPriceTierPlan {
  /** Conjunto destino ordenado ascendentemente. */
  targetIds: number[];
  /** El conjunto destino difiere del actual. */
  setChanged: boolean;
  /** La acción enciende `has_multiple_price_tiers` en este producto. */
  enablesFlag: boolean;
  /** `setChanged || enablesFlag`: el producto cuenta como "cambia de tarifas". */
  changed: boolean;
  /**
   * Lo que se envía a `update()`. Vacío cuando nada cambia (idempotencia: un
   * `replace` reaplicado no genera escrituras).
   */
  payload: {
    enabled_price_tier_ids?: number[];
    has_multiple_price_tiers?: true;
  };
}

/**
 * Plan por producto.
 *
 * Criterio del flag:
 * - Conjunto destino NO vacío y flag apagado ⇒ se envía
 *   `has_multiple_price_tiers: true` (sin el flag las tarifas no surten efecto).
 * - Modo `remove` NUNCA enciende el flag: quitar tarifas no puede volver
 *   multi-tarifa a un producto que hoy no lo es (y con variantes haría fallar
 *   la fila por `PRODUCT_TIERS_VARIANTS_EXCLUSIVE`).
 * - Conjunto destino vacío ⇒ el flag NO se toca: apagar multi-tarifa es una
 *   decisión explícita del usuario (el interruptor de la misma sección), no un
 *   efecto colateral de quitar tarifas.
 * - Si el lote ya trae `has_multiple_price_tiers` explícito, ese valor manda y
 *   la acción no lo vuelve a enviar.
 */
export function planBulkPriceTierUpdate(input: {
  mode: RelationalActionMode;
  ids: number[];
  currentIds: number[];
  currentFlag: boolean;
  explicitFlag?: boolean;
}): BulkPriceTierPlan {
  const targetIds = resolveBulkPriceTierTarget(
    input.mode,
    input.ids,
    input.currentIds,
  ).sort((a, b) => a - b);
  const currentSorted = [...new Set(input.currentIds)].sort((a, b) => a - b);
  const setChanged =
    currentSorted.length !== targetIds.length ||
    currentSorted.some((id, index) => id !== targetIds[index]);
  const enablesFlag =
    input.mode !== RelationalActionMode.REMOVE &&
    targetIds.length > 0 &&
    input.currentFlag !== true &&
    input.explicitFlag === undefined;

  const payload: BulkPriceTierPlan['payload'] = {};
  if (setChanged) payload.enabled_price_tier_ids = targetIds;
  if (enablesFlag) payload.has_multiple_price_tiers = true;

  return {
    targetIds,
    setChanged,
    enablesFlag,
    changed: setChanged || enablesFlag,
    payload,
  };
}
