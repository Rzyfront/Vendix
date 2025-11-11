import { createFeatureSelector, createSelector } from '@ngrx/store';
import { ConfigState } from './config.reducer';

export const selectConfigState = createFeatureSelector<ConfigState>('config');

export const selectAppConfig = createSelector(
  selectConfigState,
  (state: ConfigState) => state.appConfig
);

export const selectIsLoading = createSelector(
  selectConfigState,
  (state: ConfigState) => state.loading
);

export const selectError = createSelector(
  selectConfigState,
  (state: ConfigState) => state.error
);

export const selectDomainConfig = createSelector(
  selectAppConfig,
  (appConfig) => appConfig?.domainConfig || null
);
