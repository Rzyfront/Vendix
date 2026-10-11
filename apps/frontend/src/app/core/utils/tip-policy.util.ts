import { TipsSettings } from '../models/store-settings.interface';

export interface TipPolicy {
  manualEnabled: boolean;
  suggested: { type: 'percentage' | 'fixed'; value: number } | null;
}

/**
 * Resuelve la política de propinas efectiva. `tips.enabled` sin valor cae al
 * default por industria (restaurante = true, resto = false).
 */
export function resolveTipPolicy(
  tips: Partial<TipsSettings> | null | undefined,
  isRestaurant: boolean,
): TipPolicy {
  const value = Number(tips?.suggested_value);
  return {
    manualEnabled: tips?.enabled ?? isRestaurant,
    suggested:
      tips?.suggested_enabled && value > 0
        ? { type: tips.suggested_type ?? 'percentage', value }
        : null,
  };
}

export function isTipPolicyActive(policy: TipPolicy): boolean {
  return policy.manualEnabled || policy.suggested != null;
}

/** Propina sugerida sobre la base bruta de productos; 0 si no hay sugerida. */
export function computeSuggestedTip(
  policy: TipPolicy,
  grossProductsBase: number,
): number {
  const suggested = policy.suggested;
  if (!suggested) return 0;
  if (suggested.type === 'fixed') return suggested.value;
  return Math.round(((grossProductsBase * suggested.value) / 100) * 100) / 100;
}
