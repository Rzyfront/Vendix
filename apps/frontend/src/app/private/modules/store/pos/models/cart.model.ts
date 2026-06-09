import { Product, PosProductVariant } from '../services/pos-product.service';
import { PosCustomer } from '../models/customer.model';
import { WithholdingLine } from '../../withholding-tax/interfaces/withholding.interface';

export interface CartItem {
  id: string;
  itemType?: 'product' | 'custom';
  product: Product;
  quantity: number;
  unitPrice: number;
  finalPrice: number;
  totalPrice: number;
  taxAmount: number;
  addedAt: Date;
  notes?: string;
  description?: string;
  taxCategoryId?: number | null;
  taxRate?: number;
  originalFinalPrice?: number;
  isPriceOverridden?: boolean;
  priceOverrideReason?: string;
  discounts?: CartDiscount[];
  variant_id?: number;
  variant_sku?: string;
  variant_attributes?: string;
  variant_display_name?: string;
  // Weight product fields
  weight?: number;
  weight_unit?: 'kg' | 'g' | 'lb';
  is_weight_product?: boolean;
  // Multi-tarifa (Phase 5) + Empaque por tarifa.
  applied_price_tier_id?: number | null;
  applied_price_tier_name?: string | null;
  // `is_package_unit` is true when the applied tier resolves a pack size > 1.
  is_package_unit?: boolean;
  // Resolved pack size for the applied tier (packaging cascade:
  // override_units_per_package ?? tier.units_per_package). When > 1 the cart
  // `quantity` counts PACKAGES; stock consumed = quantity * units_per_package
  // and `unitPrice`/`finalPrice` are WHOLE-PACKAGE prices.
  units_per_package?: number | null;
}

export interface CartDiscount {
  id: string;
  type: 'percentage' | 'fixed';
  value: number;
  description: string;
  amount: number;
  promotion_id?: number;
  coupon_id?: number;
  coupon_code?: string;
  is_auto_applied?: boolean;
}

export interface CartSummary {
  subtotal: number;
  taxAmount: number;
  discountAmount: number;
  total: number;
  itemCount: number;
  totalItems: number;
  /**
   * Net withholding the CUSTOMER (agente retenedor) practices on this sale
   * (role='suffered'). Reduces the amount to collect. Sourced exclusively from
   * the backend preview endpoint — never computed client-side. 0 when there is
   * no customer or no applicable withholding.
   */
  withholdingAmount?: number;
  /** Resolved withholding lines for display/breakdown (preview, informative). */
  withholdingLines?: WithholdingLine[];
}

export interface PendingBooking {
  id: number;
  booking_number: string;
  product_id: number;
  product_name: string;
  product_variant_id?: number;
  variant_name?: string;
  customer_id: number;
  date: string;
  start_time: string;
  end_time: string;
  provider_name?: string;
}

export interface CartState {
  items: CartItem[];
  customer: PosCustomer | null;
  notes: string;
  appliedDiscounts: CartDiscount[];
  appliedCoupon?: { id: number; code: string; discount_type: string; discount_value: number };
  pendingBookings: PendingBooking[];
  summary: CartSummary;
  createdAt: Date;
  updatedAt: Date;
}

export interface AddToCartRequest {
  product: Product;
  quantity: number;
  notes?: string;
  variant?: PosProductVariant;
  // Weight product fields
  weight?: number;
  weight_unit?: 'kg' | 'g' | 'lb';
}

export interface AddCustomItemRequest {
  name: string;
  description?: string;
  quantity: number;
  finalPrice: number;
  taxCategory?: {
    id: number;
    name: string;
    tax_rates?: Array<{ rate: string | number }>;
  } | null;
}

export interface UpdateCartItemRequest {
  itemId: string;
  quantity: number;
  notes?: string;
}

export interface UpdateCartItemPriceRequest {
  itemId: string;
  finalPrice: number;
  reason?: string;
}

export interface ApplyDiscountRequest {
  type: 'percentage' | 'fixed';
  value: number;
  description: string;
  promotion_id?: number;
}

export interface CartValidationError {
  field: string;
  message: string;
  itemId?: string;
}
