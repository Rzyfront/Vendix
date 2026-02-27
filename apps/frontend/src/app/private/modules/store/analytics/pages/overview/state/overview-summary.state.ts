import { DateRangeFilter } from '../../../interfaces/analytics.interface';
import { OverviewSummary, OverviewTrend } from '../../../interfaces/overview-analytics.interface';

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

function getDefaultStartDate(): string {
  const date = new Date();
  date.setDate(1);
  return date.toISOString().split('T')[0];
}

function getDefaultEndDate(): string {
  return new Date().toISOString().split('T')[0];
}
