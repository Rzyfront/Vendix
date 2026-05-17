import { createReducer, on } from '@ngrx/store';
import { CustomerAcquisitionState, initialCustomerAcquisitionState } from './customer-acquisition.state';
import * as AcquisitionActions from './customer-acquisition.actions';

export const customerAcquisitionReducer = createReducer(
  initialCustomerAcquisitionState,

  on(AcquisitionActions.setDateRange, (state, { dateRange }) => ({
    ...state,
    dateRange,
  })),
  on(AcquisitionActions.setGranularity, (state, { granularity }) => ({
    ...state,
    granularity,
  })),

  on(AcquisitionActions.loadAcquisitionSummary, (state) => ({
    ...state,
    loading: true,
    error: null,
  })),
  on(AcquisitionActions.loadAcquisitionSummarySuccess, (state, { newCustomers, conversionRate, acquisitionCost, bestChannel }) => ({
    ...state,
    newCustomers,
    conversionRate,
    acquisitionCost,
    bestChannel,
    loading: false,
    error: null,
  })),
  on(AcquisitionActions.loadAcquisitionSummaryFailure, (state, { error }) => ({
    ...state,
    loading: false,
    error,
  })),

  on(AcquisitionActions.loadAcquisitionTrends, (state) => ({
    ...state,
    loadingTrends: true,
    error: null,
  })),
  on(AcquisitionActions.loadAcquisitionTrendsSuccess, (state, { trends }) => ({
    ...state,
    trends,
    loadingTrends: false,
    error: null,
  })),
  on(AcquisitionActions.loadAcquisitionTrendsFailure, (state, { error }) => ({
    ...state,
    loadingTrends: false,
    error,
  })),

  on(AcquisitionActions.loadAcquisitionChannels, (state) => ({
    ...state,
    loadingChannels: true,
    error: null,
  })),
  on(AcquisitionActions.loadAcquisitionChannelsSuccess, (state, { channels }) => ({
    ...state,
    channels,
    loadingChannels: false,
    error: null,
  })),
  on(AcquisitionActions.loadAcquisitionChannelsFailure, (state, { error }) => ({
    ...state,
    loadingChannels: false,
    error,
  })),

  on(AcquisitionActions.clearCustomerAcquisitionState, () => initialCustomerAcquisitionState),
);
