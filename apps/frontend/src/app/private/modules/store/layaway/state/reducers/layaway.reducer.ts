import { createReducer, on } from '@ngrx/store';
import { INITIAL_LAYAWAY_STATE } from '../layaway.state';
import * as LayawayActions from '../actions/layaway.actions';

export const layawayReducer = createReducer(
  INITIAL_LAYAWAY_STATE,

  // Load
  on(LayawayActions.loadLayaways, (state) => ({ ...state, layaway_loading: true, error: null })),
  on(LayawayActions.loadLayawaysSuccess, (state, { layaways, meta }) => ({ ...state, layaways, meta, layaway_loading: false })),
  on(LayawayActions.loadLayawaysFailure, (state, { error }) => ({ ...state, layaway_loading: false, error })),

  // Create
  on(LayawayActions.createLayaway, (state) => ({ ...state, layaway_loading: true, error: null })),
  on(LayawayActions.createLayawaySuccess, (state) => ({ ...state, layaway_loading: false })),
  on(LayawayActions.createLayawayFailure, (state, { error }) => ({ ...state, layaway_loading: false, error })),

  // Payment
  on(LayawayActions.makePayment, (state) => ({ ...state, layaway_loading: true, error: null })),
  on(LayawayActions.makePaymentSuccess, (state) => ({ ...state, layaway_loading: false })),
  on(LayawayActions.makePaymentFailure, (state, { error }) => ({ ...state, layaway_loading: false, error })),

  // Cancel
  on(LayawayActions.cancelLayaway, (state) => ({ ...state, layaway_loading: true, error: null })),
  on(LayawayActions.cancelLayawaySuccess, (state) => ({ ...state, layaway_loading: false })),
  on(LayawayActions.cancelLayawayFailure, (state, { error }) => ({ ...state, layaway_loading: false, error })),

  // Stats
  on(LayawayActions.loadStats, (state) => ({ ...state, stats_loading: true })),
  on(LayawayActions.loadStatsSuccess, (state, { stats }) => ({ ...state, stats, stats_loading: false })),
  on(LayawayActions.loadStatsFailure, (state, { error }) => ({ ...state, stats_loading: false, error })),

  // Filters
  on(LayawayActions.setSearch, (state, { search }) => ({ ...state, search, page: 1 })),
  on(LayawayActions.setPage, (state, { page }) => ({ ...state, page })),
  on(LayawayActions.setSort, (state, { sort_by, sort_order }) => ({ ...state, sort_by, sort_order, page: 1 })),
  on(LayawayActions.setStateFilter, (state, { state: state_filter }) => ({ ...state, state_filter, page: 1 })),
);
