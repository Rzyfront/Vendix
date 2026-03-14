import { createReducer, on } from '@ngrx/store';
import { PromotionsState, initialPromotionsState } from '../promotions.state';
import { PromotionsActions } from '../actions/promotions.actions';

export const promotionsReducer = createReducer(
  initialPromotionsState,

  // ── Load Promotions ────────────────────────────────────────────────
  on(PromotionsActions.loadPromotions, (state) => ({
    ...state,
    promotions_loading: true,
    error: null,
  })),
  on(PromotionsActions.loadPromotionsSuccess, (state, { promotions, meta }) => ({
    ...state,
    promotions,
    promotions_meta: meta,
    promotions_loading: false,
    error: null,
  })),
  on(PromotionsActions.loadPromotionsFailure, (state, { error }) => ({
    ...state,
    promotions_loading: false,
    error,
  })),

  // ── Summary ────────────────────────────────────────────────────────
  on(PromotionsActions.loadSummary, (state) => ({
    ...state,
    summary_loading: true,
    error: null,
  })),
  on(PromotionsActions.loadSummarySuccess, (state, { summary }) => ({
    ...state,
    summary,
    summary_loading: false,
    error: null,
  })),
  on(PromotionsActions.loadSummaryFailure, (state, { error }) => ({
    ...state,
    summary_loading: false,
    error,
  })),

  // ── Create ─────────────────────────────────────────────────────────
  on(PromotionsActions.createPromotion, (state) => ({
    ...state,
    promotions_loading: true,
    error: null,
  })),
  on(PromotionsActions.createPromotionSuccess, (state) => ({
    ...state,
    promotions_loading: false,
    error: null,
  })),
  on(PromotionsActions.createPromotionFailure, (state, { error }) => ({
    ...state,
    promotions_loading: false,
    error,
  })),

  // ── Update ─────────────────────────────────────────────────────────
  on(PromotionsActions.updatePromotion, (state) => ({
    ...state,
    promotions_loading: true,
    error: null,
  })),
  on(PromotionsActions.updatePromotionSuccess, (state) => ({
    ...state,
    promotions_loading: false,
    error: null,
  })),
  on(PromotionsActions.updatePromotionFailure, (state, { error }) => ({
    ...state,
    promotions_loading: false,
    error,
  })),

  // ── Delete ─────────────────────────────────────────────────────────
  on(PromotionsActions.deletePromotion, (state) => ({
    ...state,
    promotions_loading: true,
    error: null,
  })),
  on(PromotionsActions.deletePromotionSuccess, (state) => ({
    ...state,
    promotions_loading: false,
    error: null,
  })),
  on(PromotionsActions.deletePromotionFailure, (state, { error }) => ({
    ...state,
    promotions_loading: false,
    error,
  })),

  // ── Activate ───────────────────────────────────────────────────────
  on(PromotionsActions.activatePromotion, (state) => ({
    ...state,
    promotions_loading: true,
    error: null,
  })),
  on(PromotionsActions.activatePromotionSuccess, (state) => ({
    ...state,
    promotions_loading: false,
    error: null,
  })),
  on(PromotionsActions.activatePromotionFailure, (state, { error }) => ({
    ...state,
    promotions_loading: false,
    error,
  })),

  // ── Pause ──────────────────────────────────────────────────────────
  on(PromotionsActions.pausePromotion, (state) => ({
    ...state,
    promotions_loading: true,
    error: null,
  })),
  on(PromotionsActions.pausePromotionSuccess, (state) => ({
    ...state,
    promotions_loading: false,
    error: null,
  })),
  on(PromotionsActions.pausePromotionFailure, (state, { error }) => ({
    ...state,
    promotions_loading: false,
    error,
  })),

  // ── Cancel ─────────────────────────────────────────────────────────
  on(PromotionsActions.cancelPromotion, (state) => ({
    ...state,
    promotions_loading: true,
    error: null,
  })),
  on(PromotionsActions.cancelPromotionSuccess, (state) => ({
    ...state,
    promotions_loading: false,
    error: null,
  })),
  on(PromotionsActions.cancelPromotionFailure, (state, { error }) => ({
    ...state,
    promotions_loading: false,
    error,
  })),

  // ── Filters ────────────────────────────────────────────────────────
  on(PromotionsActions.setSearch, (state, { search }) => ({
    ...state,
    search,
    page: 1,
  })),
  on(PromotionsActions.setPage, (state, { page }) => ({
    ...state,
    page,
  })),
  on(PromotionsActions.setSort, (state, { sort_by, sort_order }) => ({
    ...state,
    sort_by,
    sort_order,
    page: 1,
  })),
  on(PromotionsActions.setStateFilter, (state, { state: state_filter }) => ({
    ...state,
    state_filter,
    page: 1,
  })),
  on(PromotionsActions.setTypeFilter, (state, { promotion_type }) => ({
    ...state,
    type_filter: promotion_type,
    page: 1,
  })),
  on(PromotionsActions.setScopeFilter, (state, { scope }) => ({
    ...state,
    scope_filter: scope,
    page: 1,
  })),
  on(PromotionsActions.clearFilters, (state) => ({
    ...state,
    search: '',
    page: 1,
    state_filter: '',
    type_filter: '',
    scope_filter: '',
  })),
);
