import { DateRangeFilter } from '../../../interfaces/analytics.interface';
import { CustomersSummary, CustomerTrend, TopCustomer } from '../../../interfaces/customers-analytics.interface';
import { getDefaultStartDate, getDefaultEndDate } from '../../../../../../../shared/utils/date.util';

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
