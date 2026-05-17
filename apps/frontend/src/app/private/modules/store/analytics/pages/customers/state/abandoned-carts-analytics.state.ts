import { DateRangeFilter } from '../../../interfaces/analytics.interface';
import {
  AbandonedCartsSummary,
  AbandonedCartTrend,
  AbandonedCartByReason,
} from '../../../interfaces/abandoned-carts-analytics.interface';
import { getDefaultStartDate, getDefaultEndDate } from '../../../../../../../shared/utils/date.util';

export interface AbandonedCartsAnalyticsState {
  summary: AbandonedCartsSummary | null;
  trends: AbandonedCartTrend[];
  byReason: AbandonedCartByReason[];
  dateRange: DateRangeFilter;
  granularity: string;
  loading: boolean;
  loadingTrends: boolean;
  exporting: boolean;
  error: string | null;
}

export const initialAbandonedCartsAnalyticsState: AbandonedCartsAnalyticsState = {
  summary: null,
  trends: [],
  byReason: [],
  dateRange: {
    start_date: getDefaultStartDate(),
    end_date: getDefaultEndDate(),
    preset: 'thisMonth',
  },
  granularity: 'day',
  loading: false,
  loadingTrends: false,
  exporting: false,
  error: null,
};
