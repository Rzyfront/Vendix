import type { ISODateString, MoneyAmount } from './common.types';

// Status values are normalized to UPPERCASE at the service choke-point
// (`OrgPurchaseOrdersService`) — consumers always see the literals below.
export type PurchaseOrderStatus =
  | 'DRAFT'
  | 'PENDING'
  | 'APPROVED'
  | 'IN_TRANSIT'
  | 'PARTIAL'
  | 'RECEIVED'
  | 'CANCELLED';

/**
 * Lowercase status values accepted by the backend DTO
 * (`purchase_order_status_enum` in Prisma). The mobile service
 * (`OrgPurchaseOrdersService`) translates between this and the uppercase
 * `PurchaseOrderStatus` used internally.
 */
export type PurchaseOrderStatusBackend =
  | 'draft'
  | 'pending'
  | 'approved'
  | 'in_transit'
  | 'partial'
  | 'received'
  | 'cancelled';

export interface PurchaseOrder {
  id: string;
  po_number: string;
  supplier_id: string;
  supplier_name: string;
  store_id?: string;
  store_name?: string;
  location_id?: string;
  location_name?: string;
  status: PurchaseOrderStatus;
  order_date: ISODateString;
  expected_date?: ISODateString;
  received_date?: ISODateString;
  total_items: number;
  total_quantity: number;
  subtotal: MoneyAmount;
  tax_total: MoneyAmount;
  total: MoneyAmount;
  notes?: string;
  approved_at?: ISODateString;
  approved_by?: string;
  received_at?: ISODateString;
  created_at: ISODateString;
  updated_at: ISODateString;
}

export interface PurchaseOrderItem {
  id?: string;
  product_id: string;
  product_name?: string;
  product_sku?: string;
  quantity: number;
  received_quantity?: number;
  unit_cost: MoneyAmount;
  discount?: number;
  tax_rate?: number;
  subtotal: MoneyAmount;
  total: MoneyAmount;
}

/**
 * Body que `OrgPurchaseOrdersService.create` envía al backend.
 * Espejo fiel de `CreateOrgPurchaseOrderDto` (apps/backend/.../create-org-purchase-order.dto.ts).
 *
 * `destination_location_id` reemplaza al antiguo `store_id`: Plan §6.4.1 —
 * destino único a nivel cabecera, no por item.
 */
export interface PurchaseOrderCreate {
  supplier_id: number;
  destination_location_id: number;
  status?: PurchaseOrderStatusBackend;
  prices_include_tax?: boolean;
  order_date?: ISODateString;
  expected_date?: ISODateString;
  payment_terms?: string;
  shipping_method?: string;
  shipping_cost?: number;
  tax_amount?: number;
  discount_amount?: number;
  notes?: string;
  internal_notes?: string;
  items: PurchaseOrderItemCreate[];
}

/**
 * Body que `OrgPurchaseOrdersService.update` envía al backend.
 * Réplica del DTO backend `UpdateOrgPurchaseOrderDto` (cuando exista); usa
 * `PurchaseOrderStatusBackend` (lowercase) porque el backend valida contra
 * el enum de Prisma directamente.
 */
export interface PurchaseOrderUpdate {
  status?: PurchaseOrderStatusBackend;
  expected_date?: ISODateString;
  payment_terms?: string;
  shipping_method?: string;
  shipping_cost?: number;
  tax_amount?: number;
  discount_amount?: number;
  notes?: string;
  internal_notes?: string;
}

export interface PurchaseOrderItemCreate {
  product_id?: number;
  product_variant_id?: number;
  product_name?: string;
  sku?: string;
  product_description?: string;
  base_price?: number;
  quantity: number;
  unit_price: number;
  discount_percentage?: number;
  tax_rate?: number;
  tax_type?: string;
  prices_include_tax?: boolean;
  notes?: string;
  batch_number?: string;
  manufacturing_date?: string;
  expiration_date?: string;
}
