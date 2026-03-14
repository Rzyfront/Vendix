import { createFeatureSelector, createSelector } from '@ngrx/store';
import { CouponState } from '../coupon.state';

export const selectCouponState =
  createFeatureSelector<CouponState>('coupons');

export const selectCoupons = createSelector(
  selectCouponState,
  (state) => state.coupons,
);

export const selectCouponsLoading = createSelector(
  selectCouponState,
  (state) => state.coupons_loading,
);

export const selectCouponsMeta = createSelector(
  selectCouponState,
  (state) => state.meta,
);

export const selectStats = createSelector(
  selectCouponState,
  (state) => state.stats,
);

export const selectStatsLoading = createSelector(
  selectCouponState,
  (state) => state.stats_loading,
);

export const selectError = createSelector(
  selectCouponState,
  (state) => state.error,
);

export const selectSearch = createSelector(
  selectCouponState,
  (state) => state.search,
);

export const selectPage = createSelector(
  selectCouponState,
  (state) => state.page,
);
