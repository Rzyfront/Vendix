import { createAction, props } from '@ngrx/store';
import {
  Coupon,
  CouponStats,
  CreateCouponRequest,
  UpdateCouponRequest,
} from '../../interfaces/coupon.interface';

// ── Load Coupons ──────────────────────────────────────────────────
export const loadCoupons = createAction('[Coupons] Load Coupons');
export const loadCouponsSuccess = createAction(
  '[Coupons] Load Coupons Success',
  props<{ coupons: Coupon[]; meta: any }>(),
);
export const loadCouponsFailure = createAction(
  '[Coupons] Load Coupons Failure',
  props<{ error: string }>(),
);

// ── Create Coupon ─────────────────────────────────────────────────
export const createCoupon = createAction(
  '[Coupons] Create Coupon',
  props<{ coupon: CreateCouponRequest }>(),
);
export const createCouponSuccess = createAction(
  '[Coupons] Create Coupon Success',
  props<{ coupon: Coupon }>(),
);
export const createCouponFailure = createAction(
  '[Coupons] Create Coupon Failure',
  props<{ error: string }>(),
);

// ── Update Coupon ─────────────────────────────────────────────────
export const updateCoupon = createAction(
  '[Coupons] Update Coupon',
  props<{ id: number; coupon: UpdateCouponRequest }>(),
);
export const updateCouponSuccess = createAction(
  '[Coupons] Update Coupon Success',
  props<{ coupon: Coupon }>(),
);
export const updateCouponFailure = createAction(
  '[Coupons] Update Coupon Failure',
  props<{ error: string }>(),
);

// ── Delete Coupon ─────────────────────────────────────────────────
export const deleteCoupon = createAction(
  '[Coupons] Delete Coupon',
  props<{ id: number }>(),
);
export const deleteCouponSuccess = createAction(
  '[Coupons] Delete Coupon Success',
  props<{ id: number }>(),
);
export const deleteCouponFailure = createAction(
  '[Coupons] Delete Coupon Failure',
  props<{ error: string }>(),
);

// ── Stats ─────────────────────────────────────────────────────────
export const loadStats = createAction('[Coupons] Load Stats');
export const loadStatsSuccess = createAction(
  '[Coupons] Load Stats Success',
  props<{ stats: CouponStats }>(),
);
export const loadStatsFailure = createAction(
  '[Coupons] Load Stats Failure',
  props<{ error: string }>(),
);

// ── Filters ───────────────────────────────────────────────────────
export const setSearch = createAction(
  '[Coupons] Set Search',
  props<{ search: string }>(),
);
export const setPage = createAction(
  '[Coupons] Set Page',
  props<{ page: number }>(),
);
export const setSort = createAction(
  '[Coupons] Set Sort',
  props<{ sort_by: string; sort_order: 'asc' | 'desc' }>(),
);
export const setActiveFilter = createAction(
  '[Coupons] Set Active Filter',
  props<{ is_active: boolean | null }>(),
);
export const clearFilters = createAction('[Coupons] Clear Filters');
