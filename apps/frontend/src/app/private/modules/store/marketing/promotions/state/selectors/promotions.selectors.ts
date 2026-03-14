import { createFeatureSelector, createSelector } from '@ngrx/store';
import { PromotionsState } from '../promotions.state';

export const selectPromotionsState =
  createFeatureSelector<PromotionsState>('promotions');

// ── Promotions List ───────────────────────────────────────────────────
export const selectPromotions = createSelector(
  selectPromotionsState,
  (state) => state.promotions,
);

export const selectPromotionsLoading = createSelector(
  selectPromotionsState,
  (state) => state.promotions_loading,
);

export const selectPromotionsMeta = createSelector(
  selectPromotionsState,
  (state) => state.promotions_meta,
);

// ── Current Promotion ─────────────────────────────────────────────────
export const selectCurrentPromotion = createSelector(
  selectPromotionsState,
  (state) => state.current_promotion,
);

export const selectCurrentPromotionLoading = createSelector(
  selectPromotionsState,
  (state) => state.current_promotion_loading,
);

// ── Summary ───────────────────────────────────────────────────────────
export const selectSummary = createSelector(
  selectPromotionsState,
  (state) => state.summary,
);

export const selectSummaryLoading = createSelector(
  selectPromotionsState,
  (state) => state.summary_loading,
);

// ── Filters ───────────────────────────────────────────────────────────
export const selectSearch = createSelector(
  selectPromotionsState,
  (state) => state.search,
);

export const selectPage = createSelector(
  selectPromotionsState,
  (state) => state.page,
);

export const selectStateFilter = createSelector(
  selectPromotionsState,
  (state) => state.state_filter,
);

export const selectTypeFilter = createSelector(
  selectPromotionsState,
  (state) => state.type_filter,
);

export const selectScopeFilter = createSelector(
  selectPromotionsState,
  (state) => state.scope_filter,
);

// ── Error ─────────────────────────────────────────────────────────────
export const selectError = createSelector(
  selectPromotionsState,
  (state) => state.error,
);
