import { ErrorCodes, VendixHttpException } from 'src/common/errors';

export interface VariantRemovalCandidate {
  id: number;
  sku: string | null;
  /** Suma de `quantity_on_hand` de la variante en todas sus ubicaciones. */
  on_hand: number;
  has_active_reservations: boolean;
}

export interface VariantRemovalContext {
  /** Se quitan TODAS las variantes: el saldo pasa al producto base. */
  removingAll: boolean;
  removalMode?: 'first' | 'distribute' | 'reset' | null;
}

/**
 * Guarda de las variantes que un `update` de producto va a borrar.
 *
 * - Quitar TODAS: el saldo se transfiere al producto base
 *   (`transferVariantStockToBase`), así que basta la confirmación explícita
 *   `variant_removal_stock_mode`, como antes.
 * - Quitar ALGUNAS: no hay a dónde mover el saldo; borrar la variante borraba
 *   sus `stock_levels` sin ajuste ni movimiento. Se bloquea igual que
 *   `removeVariant`: con reservas activas o existencias, sin importar el modo.
 */
export function assertVariantRemovalAllowed(
  candidates: VariantRemovalCandidate[],
  context: VariantRemovalContext,
): void {
  if (context.removingAll) {
    const needsConfirmation = candidates.some(
      (v) => v.on_hand > 0 || v.has_active_reservations,
    );
    if (needsConfirmation && !context.removalMode) {
      throw new VendixHttpException(
        ErrorCodes.PROD_VALIDATE_001,
        'Deleting variants with stock or active reservations requires explicit variant_removal_stock_mode',
      );
    }
    return;
  }

  const label = (v: VariantRemovalCandidate) => v.sku || `#${v.id}`;

  const reserved = candidates.find((v) => v.has_active_reservations);
  if (reserved) {
    throw new VendixHttpException(
      ErrorCodes.PROD_HAS_RESERVATIONS_001,
      `Operación bloqueada: la variante ${label(reserved)} tiene reservas de stock activas.`,
    );
  }

  const withStock = candidates.find((v) => v.on_hand > 0);
  if (withStock) {
    throw new VendixHttpException(
      ErrorCodes.PROD_VARIANT_HAS_STOCK_001,
      `Operación bloqueada: la variante ${label(withStock)} tiene ${withStock.on_hand} unidad(es) en existencia. Ajusta su stock a 0 antes de quitarla.`,
    );
  }
}
