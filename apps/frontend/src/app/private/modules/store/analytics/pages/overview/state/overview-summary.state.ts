import { DateRangeFilter } from '../../../interfaces/analytics.interface';
import { OverviewSummary, OverviewTrend } from '../../../interfaces/overview-analytics.interface';
import { getDefaultStartDate, getDefaultEndDate } from '../../../../../../../shared/utils/date.util';

export interface OverviewSummaryState {
  summary: OverviewSummary | null;
  trends: OverviewTrend[];
  dateRange: DateRangeFilter;
  granularity: string;
  loading: boolean;
  loadingTrends: boolean;
  error: string | null;
}

export const initialOverviewSummaryState: OverviewSummaryState = {
  summary: null,
  trends: [],
  dateRange: {
    start_date: getDefaultStartDate(),
    end_date: getDefaultEndDate(),
    preset: 'thisMonth',
  },
  granularity: 'day',
  loading: false,
  loadingTrends: false,
  error: null,
};
