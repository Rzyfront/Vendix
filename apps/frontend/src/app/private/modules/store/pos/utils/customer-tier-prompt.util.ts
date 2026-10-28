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
  /**
   * Solo en `apply` al cambiar entre dos clientes con tarifa: líneas que llevan
   * la tarifa del cliente anterior. Las que no reciban la nueva se ofrecen
   * después para restaurar (`followUpRestorePrompt`), así no quedan con el
   * precio del cliente anterior.
   */
  restoreAfter?: { tier: CustomerTierRef; lines: CustomerTierPromptLine[] };
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

  const restoreLines =
    previousTier && previousTier.id !== nextTier?.id
      ? items
          .filter((item) => item.applied_price_tier_id === previousTier.id)
          .map((item) => ({ itemId: item.id, label: lineLabel(item) }))
      : [];

  if (nextTier && nextTier.id !== previousTier?.id) {
    const lines = items
      .filter(
        (item) =>
          acceptsTier(item, nextTier.id) &&
          item.applied_price_tier_id !== nextTier.id,
      )
      .map((item) => ({ itemId: item.id, label: lineLabel(item) }));
    if (lines.length > 0) {
      return withRestoreAfter({ mode: 'apply', tier: nextTier, lines }, previousTier, restoreLines);
    }
  }

  if (previousTier && restoreLines.length > 0) {
    return { mode: 'restore', tier: previousTier, lines: restoreLines };
  }

  return null;
}

/** Adjunta al aviso de aplicar las líneas de la tarifa anterior, si hay. */
export function withRestoreAfter(
  prompt: CustomerTierPrompt,
  previousTier: CustomerTierRef | null,
  restoreLines: CustomerTierPromptLine[],
): CustomerTierPrompt {
  return previousTier && restoreLines.length > 0
    ? { ...prompt, restoreAfter: { tier: previousTier, lines: restoreLines } }
    : prompt;
}

/**
 * Segundo aviso tras responder uno de `apply` que cambió de cliente con
 * tarifa: restaurar las líneas que siguen con la tarifa anterior, es decir,
 * las que no recibieron la nueva (`appliedIds`; vacío si se eligió "No
 * aplicar"). `null` si no queda ninguna.
 */
export function followUpRestorePrompt(
  prompt: CustomerTierPrompt | null,
  appliedIds: string[],
): CustomerTierPrompt | null {
  const pending = prompt?.mode === 'apply' ? prompt.restoreAfter : undefined;
  if (!pending) return null;
  const applied = new Set(appliedIds);
  const lines = pending.lines.filter((line) => !applied.has(line.itemId));
  return lines.length > 0 ? { mode: 'restore', tier: pending.tier, lines } : null;
}
