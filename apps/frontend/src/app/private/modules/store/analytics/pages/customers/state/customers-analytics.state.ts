import { DateRangeFilter } from '../../../interfaces/analytics.interface';
import { CustomersSummary, CustomerTrend, TopCustomer } from '../../../interfaces/customers-analytics.interface';

export interface CustomersAnalyticsState {
  summary: CustomersSummary | null;
  trends: CustomerTrend[];
  topCustomers: TopCustomer[];
  dateRange: DateRangeFilter;
  granularity: string;
  loading: boolean;
  loadingTrends: boolean;
  exporting: boolean;
  error: string | null;
}

export const initialCustomersAnalyticsState: CustomersAnalyticsState = {
  summary: null,
  trends: [],
  topCustomers: [],
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

function getDefaultStartDate(): string {
  const date = new Date();
  date.setDate(1);
  return date.toISOString().split('T')[0];
}

function getDefaultEndDate(): string {
  return new Date().toISOString().split('T')[0];
}
