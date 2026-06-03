import { ParamMap } from '@angular/router';
import { DateRangeFilter } from '../../analytics/interfaces/analytics.interface';

export function dateRangeToQueryParams(dateRange: DateRangeFilter): Record<string, string> {
  const params: Record<string, string> = {
    start_date: dateRange.start_date,
    end_date: dateRange.end_date,
  };
  if (dateRange.preset) {
    params['preset'] = dateRange.preset;
  }
  return params;
}

export function queryParamsToDateRange(params: ParamMap): DateRangeFilter | null {
  const startDate = params.get('start_date');
  const endDate = params.get('end_date');
  if (!startDate || !endDate) return null;

  return {
    start_date: startDate,
    end_date: endDate,
    preset: (params.get('preset') as DateRangeFilter['preset']) ?? undefined,
  };
}
