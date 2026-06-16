/**
 * POP (Point of Purchase) Order Models
 * Models for creating and submitting purchase orders
 */

import { PopCartState, PopCartItem, LotInfo, PreBulkData } from './pop-cart.interface';
import { ApiResponse, PurchaseOrderStatus } from '../../interfaces';

// PurchaseOrderStatus imported from interfaces

import { PurchaseOrder, PurchaseOrderItem } from '../../interfaces';

export type PurchaseOrderResponse = PurchaseOrder;
export type PurchaseOrderItemResponse = PurchaseOrderItem;

/**
 * Purchase order item for API request
 */
export interface PurchaseOrderItemRequest {
  product_id: number;
  product_variant_id?: number;
  quantity: number;
  unit_price: number;
  discount_percentage?: number;
  tax_rate?: number;
  notes?: string;
  // Batch/lot tracking fields
  batch_number?: string;
  manufacturing_date?: string;
  expiration_date?: string;
  // New fields for prebulk items
  product_name?: string;
  sku?: string;
  product_description?: string;
  product_type?: string;
  track_inventory?: boolean;
  pricing_type?: string;
  tax_category_ids?: number[];
  state?: string;
  weight?: number;
  available_for_ecommerce?: boolean;
  is_featured?: boolean;
  allow_pos_price_override?: boolean;
  has_multiple_price_tiers?: boolean;
  // Packaging is tier-owned now (price tier / per-product override), not a
  // product field. Removed from the purchase-order item request.
  base_price?: number;
  profit_margin?: number;
  is_on_sale?: boolean;
  sale_price?: number;
  brand_name?: string;
  category_names?: string;
  /**
   * Fase 3: UoM FKs. The receiving engine uses these to derive
   * `purchase_to_stock_factor`. Required when the parent PO has
   * `order_type='ingredient'`; ignored otherwise.
   */
  purchase_uom_id?: number | null;
  stock_uom_id?: number | null;

}

/**
 * Complete purchase order creation request
 */
export interface CreatePurchaseOrderRequest {
  organization_id?: number;
  supplier_id: number;
  location_id: number;
  status?: PurchaseOrderStatus;
  order_date?: string;
  expected_date?: string;
  payment_terms?: string;
  shipping_method?: string;
  shipping_cost?: number;
  subtotal_amount?: number;
  tax_amount?: number;
  total_amount?: number;
  discount_amount?: number;
  notes?: string;
  internal_notes?: string;
  created_by_user_id?: number;
  items: PurchaseOrderItemRequest[];
  /**
   * Fase 2: primary order type. Defaults to `retail`. When any line in
   * the cart carries a product that is a pure ingredient, the cart
   * service sets this to `ingredient`. Mixed-line orders (retail +
   * ingredient in the same PO) are out of scope for V1 and will be
   * rejected by the backend.
   */
  order_type?: 'retail' | 'ingredient';

}

/**
 * Convert cart state to create purchase order request
 */
export function cartToPurchaseOrderRequest(
  cartState: PopCartState,
  userId: number,
  organizationId?: number,
): CreatePurchaseOrderRequest {
  const items: PurchaseOrderItemRequest[] = cartState.items.map(
    (item: PopCartItem) => {
      const requestItem: PurchaseOrderItemRequest = {
        product_id: item.product.id,
        product_variant_id: item.variant?.id,
        quantity: item.quantity,
        unit_price: item.unit_cost,
        notes: item.notes,
        // Fase 3: UoM FKs. The cart stores the FKs chosen in the modal
        // (defaults to the product's persisted UoMs in ingredient mode).
        // We pass them through as-is. If the parent PO is `retail`, the
        // backend will null them out at the DB level.
        purchase_uom_id: (item as any).purchase_uom_id ?? null,
        stock_uom_id: (item as any).stock_uom_id ?? null,
        // Map lot/batch info
        batch_number: item.lot_info?.batch_number,
        manufacturing_date: item.lot_info?.manufacturing_date
          ? new Date(item.lot_info.manufacturing_date).toISOString()
          : undefined,
        expiration_date: item.lot_info?.expiration_date
          ? new Date(item.lot_info.expiration_date).toISOString()
          : undefined,
      };

      if (item.is_prebulk && item.prebulk_data) {
        requestItem.product_name = item.prebulk_data.name;
        requestItem.sku = item.prebulk_data.code;
        requestItem.product_description = item.prebulk_data.description;
        requestItem.product_type = item.prebulk_data.product_type;
        requestItem.track_inventory = item.prebulk_data.track_inventory;
        requestItem.pricing_type = item.prebulk_data.pricing_type;
        requestItem.tax_category_ids = item.prebulk_data.tax_category_ids;
        requestItem.state = item.prebulk_data.state;
        requestItem.weight = item.prebulk_data.weight;
        requestItem.available_for_ecommerce = item.prebulk_data.available_for_ecommerce;
        requestItem.is_featured = item.prebulk_data.is_featured;
        requestItem.allow_pos_price_override = item.prebulk_data.allow_pos_price_override;
        requestItem.has_multiple_price_tiers = item.prebulk_data.has_multiple_price_tiers;
        requestItem.base_price = item.prebulk_data.base_price;
        requestItem.profit_margin = item.prebulk_data.profit_margin;
        requestItem.is_on_sale = item.prebulk_data.is_on_sale;
        requestItem.sale_price = item.prebulk_data.sale_price;
        requestItem.brand_name = typeof item.prebulk_data.brand_id === 'string' ? item.prebulk_data.brand_id : undefined;
        requestItem.category_names = typeof item.prebulk_data.category_ids === 'string' ? item.prebulk_data.category_ids : undefined;
      }

      return requestItem;
    },
  );

  // Fase 2: infer order_type from the cart items. Mixed-line is out
  // of scope; if any item is a pure ingredient, the whole order is
  // `ingredient`. Otherwise `retail` (default).
  const isIngredientOrder = cartState.items.some((it: any) => {
    const p: any = it.product;
    if (!p) return false;
    const sellable =
      p.is_sellable === undefined || p.is_sellable === null
        ? true
        : !!p.is_sellable;
    return !!p.is_ingredient && !sellable;
  });

  return {
    organization_id: organizationId,
    supplier_id: cartState.supplierId!,
    location_id: cartState.locationId!,
    status: cartState.status === 'draft' ? 'draft' : 'approved',
    order_type: isIngredientOrder ? 'ingredient' : 'retail',
    order_date: cartState.orderDate.toISOString(),
    expected_date: cartState.expectedDate?.toISOString(),
    payment_terms: cartState.paymentTerms,
    shipping_method: cartState.shippingMethod,
    shipping_cost: cartState.shippingCost,
    subtotal_amount: cartState.summary.subtotal,
    tax_amount: cartState.summary.tax_amount,
    total_amount: cartState.summary.total,
    notes: cartState.notes,
    internal_notes: cartState.internalNotes,
    created_by_user_id: userId,
    items,
  };
}

/**
 * Save draft request (minimal validation)
 */
export interface SaveDraftRequest {
  supplier_id: number;
  location_id: number;
  order_date: string;
  expected_date?: string;
  notes?: string;
  internal_notes?: string;
  items: Array<{
    product_id: number;
    quantity_ordered: number;
    unit_cost: number;
  }>;
}
