import { createFeatureSelector, createSelector } from '@ngrx/store';
import { LayawayState } from '../layaway.state';

export const selectLayawayState = createFeatureSelector<LayawayState>('layaway');

export const selectLayaways = createSelector(selectLayawayState, (state) => state.layaways);
export const selectLayawaysLoading = createSelector(selectLayawayState, (state) => state.layaway_loading);
export const selectLayawaysMeta = createSelector(selectLayawayState, (state) => state.meta);
export const selectStats = createSelector(selectLayawayState, (state) => state.stats);
export const selectStatsLoading = createSelector(selectLayawayState, (state) => state.stats_loading);
export const selectError = createSelector(selectLayawayState, (state) => state.error);
export const selectSearch = createSelector(selectLayawayState, (state) => state.search);
export const selectPage = createSelector(selectLayawayState, (state) => state.page);
export const selectStateFilter = createSelector(selectLayawayState, (state) => state.state_filter);
