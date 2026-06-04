export type PopOrderStatus = 'draft' | 'submitted' | 'approved';
export type PopOrderAction = 'draft' | 'create' | 'create-receive';
export type PricingType = 'unit' | 'weight';
export type ShippingMethod = 'supplier_transport' | 'freight' | 'pickup' | 'other';

export interface PopProduct {
  id: number;
  name: string;
  code?: string;
  cost?: number;
  cost_price?: number;
  price?: number;
  stock?: number;
  image_url?: string;
  pricing_type?: PricingType;
  product_variants?: PopProductVariant[];
  requires_batch_tracking?: boolean;
  total_stock_available?: number;
  sku?: string;
}

export interface PopProductVariant {
  id: number;
  name: string;
  sku?: string;
  cost_price?: number;
  stock_quantity?: number;
  attributes?: Record<string, string>;
}

export interface PopSupplier {
  id: number;
  name: string;
  code?: string;
  email?: string;
  phone?: string;
  tax_id?: string;
  is_active?: boolean;
}

export interface PopLocation {
  id: number;
  name: string;
  code?: string;
  type?: string;
  is_active?: boolean;
}

export interface LotInfo {
  batch_number?: string;
  manufacturing_date?: string;
  expiration_date?: string;
}

export interface PreBulkData {
  name: string;
  code: string;
  description?: string;
  base_price?: number;
  unit_cost?: number;
  quantity?: number;
  notes?: string;
  profit_margin?: number;
  sale_price?: number;
  available_for_ecommerce?: boolean;
}

export interface PopCartItem {
  id: string;
  product: PopProduct;
  variant?: PopProductVariant | null;
  quantity: number;
  unit_cost: number;
  discount?: number;
  tax_rate?: number;
  subtotal: number;
  tax_amount?: number;
  total: number;
  lot_info?: LotInfo;
  notes?: string;
  is_prebulk?: boolean;
  prebulk_data?: PreBulkData;
  addedAt: string;
}

export interface PopCartSummary {
  subtotal: number;
  tax_amount: number;
  shipping_cost: number;
  total: number;
  itemCount: number;
  totalItems: number;
}

export interface PopCartState {
  orderId?: number;
  items: PopCartItem[];
  summary: PopCartSummary;
  supplierId?: number;
  supplierName?: string;
  locationId?: number;
  locationName?: string;
  orderDate: string;
  expectedDate?: string;
  shippingMethod?: ShippingMethod;
  shippingCost: number;
  paymentTerms?: string;
  notes?: string;
  internalNotes?: string;
  status: PopOrderStatus;
  createdAt: string;
  updatedAt: string;
}

export interface AddToPopCartRequest {
  product: PopProduct;
  variant?: PopProductVariant | null;
  quantity: number;
  unit_cost: number;
  lot_info?: LotInfo;
  notes?: string;
  is_prebulk?: boolean;
  prebulk_data?: PreBulkData;
}

export interface UpdatePopCartItemRequest {
  itemId: string;
  quantity?: number;
  unit_cost?: number;
  lot_info?: LotInfo;
  notes?: string;
  variant?: PopProductVariant | null;
  pricing_type?: PricingType;
}

export interface PopProductConfigResult {
  variant?: PopProductVariant | null;
  variants?: PopProductVariant[];
  lot_info?: LotInfo;
  quantity: number;
  unit_cost: number;
  pricing_type?: PricingType;
}

export interface PurchaseOrderItemRequest {
  product_id: number;
  product_variant_id?: number;
  quantity: number;
  unit_price: number;
  notes?: string;
  batch_number?: string;
  manufacturing_date?: string;
  expiration_date?: string;
  product_name?: string;
  sku?: string;
  product_description?: string;
}

export interface CreatePurchaseOrderRequest {
  supplier_id: number;
  location_id: number;
  status?: PopOrderStatus;
  order_date?: string;
  expected_date?: string;
  payment_terms?: string;
  shipping_method?: ShippingMethod;
  shipping_cost?: number;
  notes?: string;
  items: PurchaseOrderItemRequest[];
}

export function generateItemId(): string {
  return `POP_ITEM_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}
