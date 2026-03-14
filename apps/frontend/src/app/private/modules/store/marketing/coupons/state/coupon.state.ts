import { Coupon, CouponStats } from '../interfaces/coupon.interface';

export interface CouponState {
  coupons: Coupon[];
  coupons_loading: boolean;
  stats: CouponStats | null;
  stats_loading: boolean;
  meta: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  } | null;
  error: string | null;

  // Filters
  search: string;
  page: number;
  limit: number;
  sort_by: string;
  sort_order: 'asc' | 'desc';
  is_active_filter: boolean | null;
  discount_type_filter: string;
}

export const initialCouponState: CouponState = {
  coupons: [],
  coupons_loading: false,
  stats: null,
  stats_loading: false,
  meta: null,
  error: null,

  search: '',
  page: 1,
  limit: 10,
  sort_by: 'created_at',
  sort_order: 'desc',
  is_active_filter: null,
  discount_type_filter: '',
};
