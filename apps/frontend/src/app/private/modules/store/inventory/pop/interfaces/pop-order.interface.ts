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
  // New fields for prebulk items
  product_name?: string;
  sku?: string;
  product_description?: string;
  state?: string;
  weight?: number;
  available_for_ecommerce?: boolean;
  base_price?: number;
  profit_margin?: number;
  is_on_sale?: boolean;
  sale_price?: number;
  brand_name?: string;
  category_names?: string;
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
        product_variant_id: undefined, // TODO: Handle variants when implemented
        quantity: item.quantity,
        unit_price: item.unit_cost,
        notes: item.notes,
      };

      if (item.is_prebulk && item.prebulk_data) {
        requestItem.product_name = item.prebulk_data.name;
        requestItem.sku = item.prebulk_data.code;
        requestItem.product_description = item.prebulk_data.description;
        requestItem.state = item.prebulk_data.state;
        requestItem.weight = item.prebulk_data.weight;
        requestItem.available_for_ecommerce = item.prebulk_data.available_for_ecommerce;
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

  return {
    organization_id: organizationId,
    supplier_id: cartState.supplierId!,
    location_id: cartState.locationId!,
    status: cartState.status === 'draft' ? 'draft' : 'approved',
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
