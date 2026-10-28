import { OrderItem } from '../interfaces/order.interface';
import {
  CustomerTierPrompt,
  CustomerTierRef,
  withRestoreAfter,
} from '../../pos/utils/customer-tier-prompt.util';

const lineLabel = (item: OrderItem): string =>
  item.variant_sku ? `${item.product_name} · ${item.variant_sku}` : item.product_name;

/**
 * Líneas cuyo precio puede cambiar de tarifa desde el detalle: activas, de
 * producto, sin peso, sin precio editado a mano y sin presentación (paquete).
 * Mismo criterio que bloquea el backend (`items/changes` retier).
 */
const isRetierable = (item: OrderItem): boolean =>
  !item.cancelled_at &&
  item.product_id != null &&
  !(Number(item.weight ?? 0) > 0) &&
  item.is_price_overridden !== true &&
  item.stock_units_consumed == null;

const acceptsTier = (item: OrderItem, tierId: number): boolean =>
  isRetierable(item) &&
  item.products?.has_multiple_price_tiers === true &&
  (item.products.product_price_tier_assignments ?? []).some(
    (assignment) => Number(assignment.price_tier_id) === tierId,
  );

/**
 * Decide qué preguntar al cambiar el cliente de una orden editable (S6):
 * aplicar la tarifa del nuevo cliente o restaurar el precio regular de las
 * líneas que llevan la del anterior. `null` = no hay nada que preguntar.
 */
export function orderCustomerTierPrompt(input: {
  items: OrderItem[];
  previousTier: CustomerTierRef | null;
  nextTier: CustomerTierRef | null;
  canApplyTier: boolean;
}): CustomerTierPrompt | null {
  const { items, previousTier, nextTier, canApplyTier } = input;
  if (!canApplyTier) return null;

  const restoreLines =
    previousTier && previousTier.id !== nextTier?.id
      ? items
          .filter(
            (item) =>
              isRetierable(item) && item.applied_price_tier_id === previousTier.id,
          )
          .map((item) => ({ itemId: String(item.id), label: lineLabel(item) }))
      : [];

  if (nextTier && nextTier.id !== previousTier?.id) {
    const lines = items
      .filter(
        (item) =>
          acceptsTier(item, nextTier.id) &&
          item.applied_price_tier_id !== nextTier.id,
      )
      .map((item) => ({ itemId: String(item.id), label: lineLabel(item) }));
    if (lines.length > 0) {
      return withRestoreAfter({ mode: 'apply', tier: nextTier, lines }, previousTier, restoreLines);
    }
  }

  if (previousTier && restoreLines.length > 0) {
    return { mode: 'restore', tier: previousTier, lines: restoreLines };
  }

  return null;
}
