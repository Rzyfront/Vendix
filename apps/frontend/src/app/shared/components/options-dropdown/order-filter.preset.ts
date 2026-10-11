import type { FilterConfig } from './options-dropdown.interfaces';

/**
 * Filtro de orden alfabético reutilizable para `<app-options-dropdown>`.
 *
 * Cualquier vista que use el componente de filtros lo activa con una línea:
 *
 * ```ts
 * import { buildAlphabeticalOrderFilter } from '@shared/components/options-dropdown';
 *
 * filters: FilterConfig[] = [buildAlphabeticalOrderFilter('order')];
 * ```
 *
 * Emite `'asc' | 'desc' | null` en la key indicada vía `filterChange`. El padre
 * decide qué ordenar (p. ej. `sort_by=name&sort_direction=` en Stock Bajo).
 * Usa el render `select` existente: sin cambios de plantilla.
 */
export function buildAlphabeticalOrderFilter(
  key = 'order',
  label = 'Orden',
): FilterConfig {
  return {
    key,
    label,
    type: 'select',
    placeholder: 'Sin ordenar',
    options: [
      { label: 'A → Z', value: 'asc' },
      { label: 'Z → A', value: 'desc' },
    ],
  };
}
