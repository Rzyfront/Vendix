/**
 * Lógica pura de conversión `DatePreset` → `DateRangeFilterValue`.
 *
 * Separada del `.tsx` para que sea trivial de testear con jest
 * (configurado con `testEnvironment: 'node'` y `jsx: 'react-native'`
 * que no transpila JSX en runtime).
 *
 * Paridad con apps/frontend (DateRangeFilter en
 * apps/frontend/src/app/private/modules/store/analytics/utils/date.utils.ts).
 *
 * Si modificas esta función, asegúrate de que los tests en
 * `preset-to-date-range.spec.ts` siguen pasando — la lógica de fechas
 * alimenta TODA la capa de analytics.
 */
import type { DatePreset } from '@/shared/types/date';
import type { DateRangeFilterValue } from './date-range-filter';

export function presetToDateRange(preset: DatePreset): DateRangeFilterValue | null {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const toIso = (d: Date) => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${dd}`;
  };

  let start: Date;
  let end: Date;

  switch (preset) {
    case 'today':
      start = today; end = today; break;
    case 'yesterday': {
      start = new Date(today); start.setDate(start.getDate() - 1); end = start; break;
    }
    case 'thisWeek': {
      start = new Date(today); start.setDate(start.getDate() - start.getDay()); end = today; break;
    }
    case 'lastWeek': {
      start = new Date(today); start.setDate(start.getDate() - start.getDay() - 7);
      end = new Date(start); end.setDate(end.getDate() + 6); break;
    }
    case 'thisMonth':
      start = new Date(today.getFullYear(), today.getMonth(), 1); end = today; break;
    case 'lastMonth':
      start = new Date(today.getFullYear(), today.getMonth() - 1, 1);
      end = new Date(today.getFullYear(), today.getMonth(), 0); break;
    case 'thisYear':
      start = new Date(today.getFullYear(), 0, 1); end = today; break;
    case 'lastYear':
      start = new Date(today.getFullYear() - 1, 0, 1);
      end = new Date(today.getFullYear() - 1, 11, 31); break;
    default:
      return null;
  }

  return { start_date: toIso(start), end_date: toIso(end), preset };
}
