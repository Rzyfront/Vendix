import { createReducer, on } from '@ngrx/store';
import { INITIAL_CREDITS_STATE } from '../credits.state';
import * as CreditsActions from '../actions/credits.actions';

export const creditsReducer = createReducer(
  INITIAL_CREDITS_STATE,

  // Load
  on(CreditsActions.loadCredits, (state) => ({ ...state, credits_loading: true, error: null })),
  on(CreditsActions.loadCreditsSuccess, (state, { credits, meta }) => ({ ...state, credits, meta, credits_loading: false })),
  on(CreditsActions.loadCreditsFailure, (state, { error }) => ({ ...state, credits_loading: false, error })),

  // Payment
  on(CreditsActions.registerPayment, (state) => ({ ...state, credits_loading: true, error: null })),
  on(CreditsActions.registerPaymentSuccess, (state) => ({ ...state, credits_loading: false })),
  on(CreditsActions.registerPaymentFailure, (state, { error }) => ({ ...state, credits_loading: false, error })),

  // Cancel
  on(CreditsActions.cancelCredit, (state) => ({ ...state, credits_loading: true, error: null })),
  on(CreditsActions.cancelCreditSuccess, (state) => ({ ...state, credits_loading: false })),
  on(CreditsActions.cancelCreditFailure, (state, { error }) => ({ ...state, credits_loading: false, error })),

  // Stats
  on(CreditsActions.loadStats, (state) => ({ ...state, stats_loading: true })),
  on(CreditsActions.loadStatsSuccess, (state, { stats }) => ({ ...state, stats, stats_loading: false })),
  on(CreditsActions.loadStatsFailure, (state, { error }) => ({ ...state, stats_loading: false, error })),

  // Filters
  on(CreditsActions.setSearch, (state, { search }) => ({ ...state, search, page: 1 })),
  on(CreditsActions.setPage, (state, { page }) => ({ ...state, page })),
  on(CreditsActions.setSort, (state, { sort_by, sort_order }) => ({ ...state, sort_by, sort_order, page: 1 })),
  on(CreditsActions.setStateFilter, (state, { state: state_filter }) => ({ ...state, state_filter, page: 1 })),
);
