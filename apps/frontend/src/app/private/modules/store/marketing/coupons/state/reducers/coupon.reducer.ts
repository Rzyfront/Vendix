import { createReducer, on } from '@ngrx/store';
import { CouponState, initialCouponState } from '../coupon.state';
import * as CouponActions from '../actions/coupon.actions';

export const couponReducer = createReducer(
  initialCouponState,

  // ── Load Coupons ──────────────────────────────────────────────
  on(CouponActions.loadCoupons, (state) => ({
    ...state,
    coupons_loading: true,
    error: null,
  })),
  on(CouponActions.loadCouponsSuccess, (state, { coupons, meta }) => ({
    ...state,
    coupons,
    meta,
    coupons_loading: false,
    error: null,
  })),
  on(CouponActions.loadCouponsFailure, (state, { error }) => ({
    ...state,
    coupons_loading: false,
    error,
  })),

  // ── Create Coupon ─────────────────────────────────────────────
  on(CouponActions.createCoupon, (state) => ({
    ...state,
    coupons_loading: true,
    error: null,
  })),
  on(CouponActions.createCouponSuccess, (state) => ({
    ...state,
    coupons_loading: false,
    error: null,
  })),
  on(CouponActions.createCouponFailure, (state, { error }) => ({
    ...state,
    coupons_loading: false,
    error,
  })),

  // ── Update Coupon ─────────────────────────────────────────────
  on(CouponActions.updateCoupon, (state) => ({
    ...state,
    coupons_loading: true,
    error: null,
  })),
  on(CouponActions.updateCouponSuccess, (state) => ({
    ...state,
    coupons_loading: false,
    error: null,
  })),
  on(CouponActions.updateCouponFailure, (state, { error }) => ({
    ...state,
    coupons_loading: false,
    error,
  })),

  // ── Delete Coupon ─────────────────────────────────────────────
  on(CouponActions.deleteCoupon, (state) => ({
    ...state,
    coupons_loading: true,
    error: null,
  })),
  on(CouponActions.deleteCouponSuccess, (state) => ({
    ...state,
    coupons_loading: false,
    error: null,
  })),
  on(CouponActions.deleteCouponFailure, (state, { error }) => ({
    ...state,
    coupons_loading: false,
    error,
  })),

  // ── Stats ─────────────────────────────────────────────────────
  on(CouponActions.loadStats, (state) => ({
    ...state,
    stats_loading: true,
  })),
  on(CouponActions.loadStatsSuccess, (state, { stats }) => ({
    ...state,
    stats,
    stats_loading: false,
  })),
  on(CouponActions.loadStatsFailure, (state, { error }) => ({
    ...state,
    stats_loading: false,
    error,
  })),

  // ── Filters ───────────────────────────────────────────────────
  on(CouponActions.setSearch, (state, { search }) => ({
    ...state,
    search,
    page: 1,
  })),
  on(CouponActions.setPage, (state, { page }) => ({
    ...state,
    page,
  })),
  on(CouponActions.setSort, (state, { sort_by, sort_order }) => ({
    ...state,
    sort_by,
    sort_order,
    page: 1,
  })),
  on(CouponActions.setActiveFilter, (state, { is_active }) => ({
    ...state,
    is_active_filter: is_active,
    page: 1,
  })),
  on(CouponActions.clearFilters, (state) => ({
    ...state,
    search: '',
    page: 1,
    is_active_filter: null,
    discount_type_filter: '',
  })),
);
