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
  /**
   * Ingredient mode (Fase 5 parity con web prebulk modal). Cuando es un
   * insumo, el producto se mide por unidades de compra y stock distintas
   * (ej: 1 caja = 12 unidades) y se persiste con `purchase_uom_id` +
   * `stock_uom_id` en backend.
   */
  is_ingredient?: boolean;
  /** FK a `units_of_measure` (modo ingrediente). */
  purchase_uom_id?: number | null;
  /** FK a `units_of_measure` (modo ingrediente). */
  stock_uom_id?: number | null;
  is_sellable?: boolean;
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
  /**
   * Variantes recién creadas en backend durante la sesión del modal
   * (variant creation mode). Cada una se agrega al cart como una línea
   * separada con su `quantity=1` y `unit_cost=variant.cost_price`.
   */
  newVariants?: PopProductVariant[];
  lot_info?: LotInfo;
  quantity: number;
  unit_cost: number;
  pricing_type?: PricingType;
}

/**
 * Atributo en edición durante variant creation mode (parity web).
 * `values` es la lista de valores que el usuario tipea como chips
 * (ej: Color → ["Rojo", "Verde", "Azul"]).
 */
export interface VariantAttributeDraft {
  name: string;
  values: string[];
}

/**
 * Variante generada (preview) antes de persistir en backend.
 * Parity con `generatedVariants` en web. `attributes` es el map
 * atributo→valor para esta combinación (ej: {Color:"Rojo", Talla:"M"}).
 */
export interface GeneratedVariantDraft {
  name: string;
  sku: string;
  cost_price: number;
  attributes: Record<string, string>;
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

/**
 * Genera un `PopProduct.id` numérico negativo para productos temporales
 * añadidos al carrito sin un id real del backend (prebulk, bulk import,
 * invoice scanner). Los ids negativos nunca colisionan con ids reales del
 * backend (siempre positivos) y el random de 48 bits evita colisiones
 * entre dos llamadas en el mismo `Date.now()`.
 *
 * Por qué NO mezclar `Date.now()` + `Math.random()` como antes
 * (`-Date.now() - Math.floor(Math.random() * 1000)`):
 *   El importador bulk llama esta función en un loop tight y un scanner
 *   puede correr en paralelo. `Math.random() * 1000` solo da 1000 valores
 *   distintos, suficientes en teoría, pero bajo presión (bulk de 1000+
 *   items en <1s) dos items pueden compartir `product.id` y el cart service
 *   (`pop-cart-service.ts:50`) puede tratarlos como el mismo item.
 *
 * Birthday paradox: 48 bits → colisión al 50% solo después de ~95M muestras.
 * Mucho más espacio que cualquier carrito real.
 */
export function generateTempProductId(): number {
  return -Math.floor(Math.random() * Number.MAX_SAFE_INTEGER);
}
