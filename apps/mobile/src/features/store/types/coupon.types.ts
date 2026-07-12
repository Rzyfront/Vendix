/**
 * Tipos para el módulo Marketing → Cupones.
 * Mirror verbatim de los DTOs del backend `apps/backend/src/domains/store/coupons/dto/`
 * y de la interfaz web `apps/frontend/.../coupon.interface.ts`.
 * NO importar directamente del backend — se replican aquí para cumplir mobile-dev RULE 4.
 */

export type DiscountType = 'PERCENTAGE' | 'FIXED_AMOUNT';
export type AppliesTo = 'ALL_PRODUCTS' | 'SPECIFIC_PRODUCTS' | 'SPECIFIC_CATEGORIES';

export interface CouponProduct {
  product_id?: number;
  product: { id: number; name: string; sku?: string };
}

export interface CouponCategory {
  category_id?: number;
  category: { id: number; name: string };
}

export interface Coupon {
  id: number;
  store_id: number;
  code: string;
  name: string;
  description?: string;
  discount_type: DiscountType;
  discount_value: number;
  min_purchase_amount?: number;
  max_discount_amount?: number;
  max_uses?: number;
  max_uses_per_customer?: number;
  current_uses: number;
  valid_from: string;
  valid_until: string;
  is_active: boolean;
  applies_to: AppliesTo;
  created_at: string;
  updated_at: string;
  coupon_products?: CouponProduct[];
  coupon_categories?: CouponCategory[];
  _count?: { coupon_uses: number };
}

export interface CouponStats {
  total_coupons: number;
  active_coupons: number;
  total_uses: number;
  total_discount_applied: number;
}

export interface CreateCouponDto {
  code: string;
  name: string;
  description?: string;
  discount_type: DiscountType;
  discount_value: number;
  min_purchase_amount?: number;
  max_discount_amount?: number;
  max_uses?: number;
  max_uses_per_customer?: number;
  valid_from: string;
  valid_until: string;
  is_active?: boolean;
  applies_to?: AppliesTo;
  product_ids?: number[];
  category_ids?: number[];
}

export interface UpdateCouponDto extends Partial<Omit<CreateCouponDto, 'code'>> {
  code?: string;
}

export interface CouponQuery {
  page?: number;
  limit?: number;
  search?: string;
  sort_by?: string;
  sort_order?: 'asc' | 'desc';
  is_active?: boolean;
  discount_type?: DiscountType;
}

export interface ValidateCouponDto {
  code: string;
  cart_subtotal: number;
  customer_id?: number;
  product_ids?: number[];
  category_ids?: number[];
  items?: Array<{ product_id: number; line_total: number; category_ids?: number[] }>;
}

export interface ValidateCouponResponse {
  valid: boolean;
  coupon_id: number;
  code: string;
  name: string;
  discount_type: DiscountType;
  discount_value: number;
  discount_amount: number;
  min_purchase_amount: number | null;
  max_discount_amount: number | null;
}

/** Respuesta API estándar — igual que en PromotionsService */
export interface CouponApiResponse<T> {
  data: T;
  message?: string;
  success?: boolean;
}
