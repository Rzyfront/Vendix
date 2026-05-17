import { createFeatureSelector, createSelector } from '@ngrx/store';
import { CustomerAcquisitionState } from './customer-acquisition.state';

export const selectCustomerAcquisitionState =
  createFeatureSelector<CustomerAcquisitionState>('customerAcquisition');

export const selectNewCustomers = createSelector(
  selectCustomerAcquisitionState,
  (state) => state.newCustomers,
);

export const selectConversionRate = createSelector(
  selectCustomerAcquisitionState,
  (state) => state.conversionRate,
);

export const selectAcquisitionCost = createSelector(
  selectCustomerAcquisitionState,
  (state) => state.acquisitionCost,
);

export const selectBestChannel = createSelector(
  selectCustomerAcquisitionState,
  (state) => state.bestChannel,
);

export const selectTrends = createSelector(
  selectCustomerAcquisitionState,
  (state) => state.trends,
);

export const selectChannels = createSelector(
  selectCustomerAcquisitionState,
  (state) => state.channels,
);

export const selectLoading = createSelector(
  selectCustomerAcquisitionState,
  (state) => state.loading,
);

export const selectLoadingTrends = createSelector(
  selectCustomerAcquisitionState,
  (state) => state.loadingTrends,
);

export const selectLoadingChannels = createSelector(
  selectCustomerAcquisitionState,
  (state) => state.loadingChannels,
);

export const selectDateRange = createSelector(
  selectCustomerAcquisitionState,
  (state) => state.dateRange,
);

export const selectGranularity = createSelector(
  selectCustomerAcquisitionState,
  (state) => state.granularity,
);

export const selectError = createSelector(
  selectCustomerAcquisitionState,
  (state) => state.error,
);
