import { DateRangeFilter } from '../../../interfaces/analytics.interface';
import { SalesSummary, SalesTrend } from '../../../interfaces/sales-analytics.interface';

export interface SalesSummaryState {
  summary: SalesSummary | null;
  trends: SalesTrend[];
  dateRange: DateRangeFilter;
  granularity: string;
  channel: string;
  loading: boolean;
  loadingTrends: boolean;
  exporting: boolean;
  error: string | null;
}

export const initialSalesSummaryState: SalesSummaryState = {
  summary: null,
  trends: [],
  dateRange: {
    start_date: getDefaultStartDate(),
    end_date: getDefaultEndDate(),
    preset: 'thisMonth',
  },
  granularity: 'day',
  channel: '',
  loading: false,
  loadingTrends: false,
  exporting: false,
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
