// ─────────────────────────────────────────────
// DatePreset — tipo canónico de presets de período
//
// Single source of truth compartido entre:
//   - features/store/types/dashboard.types.ts (DateRange.preset)
//   - shared/components/date-range-filter    (DateRangeFilterValue.preset)
//
// Paridad con apps/frontend (DateRangeFilter en
// apps/frontend/src/app/private/modules/store/analytics/interfaces/analytics.interface.ts).
//
// Si agregas un nuevo preset, edita SOLO este archivo — el resto lo
// re-exporta y se mantiene sincronizado automáticamente.
// ─────────────────────────────────────────────

export type DatePreset =
  | 'today'
  | 'yesterday'
  | 'thisWeek'
  | 'lastWeek'
  | 'thisMonth'
  | 'lastMonth'
  | 'thisYear'
  | 'lastYear'
  | 'custom';
