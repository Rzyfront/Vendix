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
  /**
   * Image URL of the selected variant, captured from `PosProductVariant.image_url`
   * at add-to-cart time. Used by the POS cart templates as the primary image
   * source before falling back to the parent product's image. Falls back to
   * `product.image_url` when the variant has no own image (most seed variants
   * have `image_id = null` in the DB).
   */
  variant_image_url?: string;
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
  // Restaurant Suite — Fase K Gap 1: when true the cart item is
  // excluded from the kitchen-fire call (`fireOrderItems` will not
  // receive its order_item_id). The product's own stock is then
  // consumed at PAYMENT time as a regular `sale` movement. The flag
  // is purely cart-local — it is NOT persisted to `order_items` so
  // no DB migration is required. Defaults to false (legacy
  // behaviour: send to kitchen).
  skipKds?: boolean;
  // QUI-431 — Serial numbers chosen by the cashier for a serialized
  // product (`requires_serial_numbers=true`). `serial_ids` are existing
  // pool rows picked from the selector; `serial_numbers` are free-text
  // entries the backend resolves-or-creates as real pool rows at payment.
  // Both are threaded onto the POS order line and sent to the backend on
  // checkout. Ignored for non-serialized products.
  serial_ids?: number[];
  serial_numbers?: string[];
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
  /**
   * Human tier/benefit label for scaled (quantity_tiered) promotions, mirroring
   * the backend enrichment ("Desde N und: -X%" / "Desde N und: -$Y"). Presentation
   * only — the discount amount is already computed. Undefined for flat promos.
   */
  badge_label?: string;
  /**
   * Backend-defined promotion priority that determined this promo as the
   * winner. With the winner-takes-all engine, the cart has at most one
   * applied discount. Surfaced for the operator audit trail.
   */
  priority?: number;
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
  /**
   * Restaurant Suite — Fase K Gap 1: when true the item is added to
   * the cart with `skipKds=true`, meaning the POS will NOT fire it
   * to the kitchen. The product's own stock is deducted at payment
   * time. The cashier UI surfaces this choice via the
   * `pos-prepared-choice-modal` for `prepared` products that track
   * inventory and have stock > 0.
   */
  skipKds?: boolean;
  // QUI-431 — Pre-selected serials for serialized products. The POS opens a
  // selector modal before calling addToCart and passes the cashier's choice
  // here. `serial_ids` are pool rows; `serial_numbers` are free-text entries.
  serial_ids?: number[];
  serial_numbers?: string[];
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
