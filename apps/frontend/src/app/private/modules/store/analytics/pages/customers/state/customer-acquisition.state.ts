import { DateRangeFilter } from '../../../interfaces/analytics.interface';
import { CustomerTrend } from '../../../interfaces/customers-analytics.interface';
import { getDefaultStartDate, getDefaultEndDate } from '../../../../../../../shared/utils/date.util';
import { AcquisitionChannel } from './customer-acquisition.actions';

export interface CustomerAcquisitionState {
  newCustomers: number;
  conversionRate: number;
  acquisitionCost: number;
  bestChannel: string;
  trends: CustomerTrend[];
  channels: AcquisitionChannel[];
  dateRange: DateRangeFilter;
  granularity: string;
  loading: boolean;
  loadingTrends: boolean;
  loadingChannels: boolean;
  error: string | null;
}

export const initialCustomerAcquisitionState: CustomerAcquisitionState = {
  newCustomers: 0,
  conversionRate: 0,
  acquisitionCost: 0,
  bestChannel: 'Directo',
  trends: [],
  channels: [],
  dateRange: {
    start_date: getDefaultStartDate(),
    end_date: getDefaultEndDate(),
    preset: 'thisMonth',
  },
  granularity: 'day',
  loading: false,
  loadingTrends: false,
  loadingChannels: false,
  error: null,
};
