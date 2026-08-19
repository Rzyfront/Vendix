import { createAction, props } from '@ngrx/store';
import { DateRangeFilter } from '../../../interfaces/analytics.interface';
import { CustomerTrend } from '../../../interfaces/customers-analytics.interface';

export const setDateRange = createAction(
  '[Customer Acquisition] Set Date Range',
  props<{ dateRange: DateRangeFilter }>(),
);
export const setGranularity = createAction(
  '[Customer Acquisition] Set Granularity',
  props<{ granularity: string }>(),
);

export const loadAcquisitionSummary = createAction(
  '[Customer Acquisition] Load Summary',
);
export const loadAcquisitionSummarySuccess = createAction(
  '[Customer Acquisition] Load Summary Success',
  props<{ newCustomers: number; conversionRate: number; acquisitionCost: number; bestChannel: string }>(),
);
export const loadAcquisitionSummaryFailure = createAction(
  '[Customer Acquisition] Load Summary Failure',
  props<{ error: string }>(),
);

export const loadAcquisitionTrends = createAction(
  '[Customer Acquisition] Load Trends',
);
export const loadAcquisitionTrendsSuccess = createAction(
  '[Customer Acquisition] Load Trends Success',
  props<{ trends: CustomerTrend[] }>(),
);
export const loadAcquisitionTrendsFailure = createAction(
  '[Customer Acquisition] Load Trends Failure',
  props<{ error: string }>(),
);

export const loadAcquisitionChannels = createAction(
  '[Customer Acquisition] Load Channels',
);
export const loadAcquisitionChannelsSuccess = createAction(
  '[Customer Acquisition] Load Channels Success',
  props<{ channels: AcquisitionChannel[] }>(),
);
export const loadAcquisitionChannelsFailure = createAction(
  '[Customer Acquisition] Load Channels Failure',
  props<{ error: string }>(),
);

export const clearCustomerAcquisitionState = createAction(
  '[Customer Acquisition] Clear State',
);

export interface AcquisitionChannel {
  channel: string;
  new_customers: number;
  conversion_rate: number;
  spend: number;
}
