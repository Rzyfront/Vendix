import { DateRangeFilter } from '../../../interfaces/analytics.interface';
import { ProductProfitability, ProfitabilitySummary } from '../../../interfaces/products-analytics.interface';
import { getDefaultStartDate, getDefaultEndDate } from '../../../../../../../shared/utils/date.util';

export interface ProfitabilityAnalyticsState {
  products: ProductProfitability[];
  summary: ProfitabilitySummary | null;
  dateRange: DateRangeFilter;
  granularity: string;
  loading: boolean;
  exporting: boolean;
  error: string | null;
}

export const initialProfitabilityAnalyticsState: ProfitabilityAnalyticsState = {
  products: [],
  summary: null,
  dateRange: {
    start_date: getDefaultStartDate(),
    end_date: getDefaultEndDate(),
    preset: 'thisMonth',
  },
  granularity: 'day',
  loading: false,
  exporting: false,
  error: null,
};
