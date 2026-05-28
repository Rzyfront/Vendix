import type { StoreSettings } from '../../../settings/interfaces/store-settings.interface';

export const DEFAULT_LOW_STOCK_THRESHOLD = 10;

type SettingsLike = Pick<StoreSettings, 'inventory'> | null | undefined;

export interface ProductLowStockThresholdSource {
  reorder_point?: number | string | null;
  min_stock_level?: number | string | null;
}

export interface StockLevelLowStockThresholdSource {
  reorder_point?: number | string | null;
}

export function resolveConfiguredLowStockThreshold(
  settings: SettingsLike,
): number {
  const configured = toFiniteNumber(settings?.inventory?.low_stock_threshold);

  return configured !== null && configured >= 0
    ? configured
    : DEFAULT_LOW_STOCK_THRESHOLD;
}

export function resolveProductLowStockThreshold(
  settings: SettingsLike,
  source?: ProductLowStockThresholdSource | null,
): number {
  return (
    toPositiveNumber(source?.reorder_point) ??
    toPositiveNumber(source?.min_stock_level) ??
    resolveConfiguredLowStockThreshold(settings)
  );
}

export function resolveStockLevelLowStockThreshold(
  settings: SettingsLike,
  source?: StockLevelLowStockThresholdSource | null,
): number {
  return (
    toPositiveNumber(source?.reorder_point) ??
    resolveConfiguredLowStockThreshold(settings)
  );
}

function toPositiveNumber(value: unknown): number | null {
  const parsed = toFiniteNumber(value);
  return parsed !== null && parsed > 0 ? parsed : null;
}

function toFiniteNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
