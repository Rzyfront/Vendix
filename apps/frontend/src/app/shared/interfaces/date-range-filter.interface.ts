/**
 * Rango de fechas compartido por analíticas, reportes y el
 * `<app-options-dropdown>` (FilterType `'date-range'`).
 *
 * Vive en `shared/` porque el filtro dejó de ser exclusivo del módulo de
 * analíticas: cualquier módulo que declare un filtro de período lo consume.
 * Es estructuralmente idéntico al `DateRangeFilter` histórico de
 * `analytics/interfaces/analytics.interface.ts`, así que ambos son
 * intercambiables mientras dure la transición.
 */
export interface DateRangeFilter {
  start_date: string;
  end_date: string;
  preset?:
    | 'today'
    | 'yesterday'
    | 'thisWeek'
    | 'lastWeek'
    | 'thisMonth'
    | 'lastMonth'
    | 'thisYear'
    | 'lastYear'
    | 'custom';
}

/** Preset nombrado que resuelve a un rango concreto. */
export type DatePreset = NonNullable<DateRangeFilter['preset']>;
