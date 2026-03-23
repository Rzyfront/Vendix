import { createFeatureSelector, createSelector } from '@ngrx/store';
import { CreditsState } from '../credits.state';

export const selectCreditsState = createFeatureSelector<CreditsState>('credits');

export const selectCredits = createSelector(selectCreditsState, (state) => state.credits);
export const selectCreditsLoading = createSelector(selectCreditsState, (state) => state.credits_loading);
export const selectCreditsMeta = createSelector(selectCreditsState, (state) => state.meta);
export const selectStats = createSelector(selectCreditsState, (state) => state.stats);
export const selectStatsLoading = createSelector(selectCreditsState, (state) => state.stats_loading);
export const selectError = createSelector(selectCreditsState, (state) => state.error);
export const selectSearch = createSelector(selectCreditsState, (state) => state.search);
export const selectPage = createSelector(selectCreditsState, (state) => state.page);
export const selectStateFilter = createSelector(selectCreditsState, (state) => state.state_filter);
