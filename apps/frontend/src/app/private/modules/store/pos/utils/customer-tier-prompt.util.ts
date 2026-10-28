import { CartItem } from '../models/cart.model';

export interface CustomerTierRef {
  id: number;
  name: string;
}

export interface CustomerTierPromptLine {
  itemId: string;
  label: string;
}

/**
 * `apply`: el cliente elegido tiene tarifa y hay líneas que la habilitan.
 * `restore`: se quitó (o cambió) un cliente con tarifa y hay líneas que la
 * llevan; se ofrece volver al precio regular.
 */
export interface CustomerTierPrompt {
  mode: 'apply' | 'restore';
  tier: CustomerTierRef;
  lines: CustomerTierPromptLine[];
}

const lineLabel = (item: CartItem): string =>
  item.variant_display_name
    ? `${item.product.name} · ${item.variant_display_name}`
    : item.product.name;

/**
 * Mismo criterio que el selector de tarifa de la línea: productos (no ítems
 * libres), sin captura por peso, con multi-tarifa activa y con la tarifa
 * habilitada en el producto. Sin multi-tarifa el resolver ignora la tarifa y el
 * precio no cambiaría; el backend rechaza (`PRICE_TIER_NOT_ALLOWED`) una
 * tarifa no habilitada.
 */
const acceptsTier = (item: CartItem, tierId: number): boolean =>
  item.itemType !== 'custom' &&
  item.captured_by_scale !== true &&
  !item.is_weight_product &&
  item.product.has_multiple_price_tiers === true &&
  (item.product.enabled_price_tier_ids ?? []).map(Number).includes(tierId);

/**
 * Decide qué preguntar al cambiar el cliente del POS. Sin permiso para
 * aplicar tarifas, o sin líneas que ofrecer, no hay aviso (`null`).
 */
export function customerTierPrompt(input: {
  items: CartItem[];
  previousTier: CustomerTierRef | null;
  nextTier: CustomerTierRef | null;
  canApplyTier: boolean;
}): CustomerTierPrompt | null {
  const { items, previousTier, nextTier, canApplyTier } = input;
  if (!canApplyTier) return null;

  if (nextTier && nextTier.id !== previousTier?.id) {
    const lines = items
      .filter(
        (item) =>
          acceptsTier(item, nextTier.id) &&
          item.applied_price_tier_id !== nextTier.id,
      )
      .map((item) => ({ itemId: item.id, label: lineLabel(item) }));
    if (lines.length > 0) return { mode: 'apply', tier: nextTier, lines };
  }

  if (previousTier && previousTier.id !== nextTier?.id) {
    const lines = items
      .filter((item) => item.applied_price_tier_id === previousTier.id)
      .map((item) => ({ itemId: item.id, label: lineLabel(item) }));
    if (lines.length > 0) return { mode: 'restore', tier: previousTier, lines };
  }

  return null;
}
