export type PopOrderStatus = 'draft' | 'submitted' | 'approved';
export type PopOrderAction = 'draft' | 'create' | 'create-receive';
export type PricingType = 'unit' | 'weight';
export type ShippingMethod = 'supplier_transport' | 'freight' | 'pickup' | 'other';

/**
 * CP-PURCHASE-TRANSPARENCY C.5 — cómo se imputa el flete de la factura.
 *
 * - `prorate`: se reparte entre los productos según su participación en la
 *   compra y se CAPITALIZA al costo. Cada producto queda valorado con lo que
 *   realmente costó ponerlo en bodega, así que sube su costo unitario y con él
 *   el margen que calcula el sistema.
 * - `expense`: no toca el costo de los productos; se registra como un costo de
 *   la orden y el costo unitario no se mueve.
 *
 * En los DOS casos el flete se suma al total de la orden.
 *
 * Espejo de `SHIPPING_COST_ALLOCATIONS` (backend,
 * `dto/create-purchase-order.dto.ts`). El mismo juego de valores gobierna la
 * creación y la vista previa: si divergieran, el operador aprobaría una
 * simulación que la orden no puede reproducir.
 */
export type PopShippingAllocation = 'prorate' | 'expense';

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
  /** Espejo de `supplier_state_enum`; el picker solo carga `active`. */
  state?: 'active' | 'inactive' | 'archived';
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
  /* ============================================================
   * QUI-648 — Unidad de venta configurada desde la compra
   * ============================================================
   * Compro bultos de 50 kg y acá defino que se venden por bulto y por kilo,
   * sin salir del flujo de compra. El backend
   * (`purchase-orders.service.ts::persistSaleUnitConfigToProduct`) persiste las
   * TRES filas de forma coordinada o ninguna: `price_tiers` (kind='sale_unit'),
   * `product_price_tier_assignments` (el allowlist que consulta la venta) y
   * `product_price_tier_overrides` (factor + precio).
   *
   * Todo el bloque es opcional: sin `sale_unit_name` el backend ni siquiera
   * entra a la rama, y la orden de compra se comporta exactamente como hoy.
   */
  /** Nombre libre de la presentación (Bulto 50 kg, Kilo, Rollo, Metro). */
  sale_unit_name?: string;
  /** Unidades de stock que consume UNA unidad de esa presentación. Entero >= 2. */
  sale_unit_units_per_package?: number;
  /** Precio de la presentación completa. Gana sobre el margen (cost-anchor). */
  sale_unit_price?: number;
  /** Margen (markup sobre el costo del paquete). Se ignora si llega precio. */
  sale_unit_profit_margin?: number;
  /** La presentación rige por defecto en TODA superficie de venta. */
  sale_unit_is_default?: boolean;
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
  /**
   * C.5 — qué hacer con el flete. `undefined` mientras no haya flete: el
   * backend RECHAZA (HTTP 400) un `shipping_cost > 0` sin modo y también un
   * `prorate` sin monto, así que el modo sólo existe acompañado del monto.
   */
  shippingCostAllocation?: PopShippingAllocation;
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
  /**
   * `true` si la factura del proveedor grava IVA — paridad con web
   * `includes_vat` (QUI-525). El backend puede omitirlo y el cart lo
   * propaga al payload final.
   */
  includes_vat?: boolean;
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
  /* ===== Insumo (UoM) — solo para productos NUEVOS creados desde la línea ===== */
  is_ingredient?: boolean;
  is_sellable?: boolean;
  purchase_uom_id?: number | null;
  stock_uom_id?: number | null;
  /**
   * "Contenido por envase": factor manual compra→stock cuando las dimensiones
   * no son convertibles por catálogo (una bolsita → 250 g).
   */
  purchase_to_stock_factor?: number;
  /* ===== Unidad de venta (QUI-648) ===== */
  sale_unit_name?: string;
  sale_unit_units_per_package?: number;
  sale_unit_price?: number;
  sale_unit_profit_margin?: number;
  sale_unit_is_default?: boolean;
}

/**
 * Cuerpo del POST a `STORE.PURCHASE_ORDERS.CREATE`.
 *
 * CP-PURCHASE-TRANSPARENCY A.10 — **NO lleva `status`**. La orden nace en
 * `draft` (default de columna) y llega a `approved` por
 * `PATCH /store/orders/purchase-orders/:id/approve`, que es donde se consulta
 * el permiso `store:orders:purchase_orders:approve`, se estampa
 * `approved_by_user_id` y se escribe la auditoría. Mandarlo era, en el mejor
 * caso, un campo que el servidor ignora (y la orden quedaba en borrador sin que
 * la pantalla se enterara); cuando el backend lo retire del DTO —sigue
 * declarado sólo por compatibilidad— con `forbidNonWhitelisted` sería un 400 en
 * cada creación.
 */
export interface CreatePurchaseOrderRequest {
  supplier_id: number;
  location_id: number;
  order_date?: string;
  expected_date?: string;
  payment_terms?: string;
  shipping_method?: ShippingMethod;
  shipping_cost?: number;
  /** Obligatorio en cuanto `shipping_cost > 0`; prohibido con flete en cero. */
  shipping_cost_allocation?: PopShippingAllocation;
  subtotal_amount?: number;
  tax_amount?: number;
  total_amount?: number;
  notes?: string;
  internal_notes?: string;
  items: PurchaseOrderItemRequest[];
}

/* ============================================================================
 * CP-PURCHASE-TRANSPARENCY B.5 — vista previa de costeo y explicación fiscal
 * ==========================================================================*/

/**
 * De dónde salió la responsabilidad de IVA. Espejo de
 * `VatResponsibilitySource` (backend, `common/helpers/vat-responsibility.helper.ts`).
 */
export type PopFiscalSource =
  | 'tax_responsibilities'
  | 'tax_regime'
  | 'absent'
  | 'read_error';

/** Motivo estable. Espejo de `VatResponsibilityReason`. */
export type PopFiscalReason =
  | 'declared_responsible'
  | 'declared_not_responsible'
  | 'regime_responsible'
  | 'regime_not_responsible'
  | 'no_fiscal_signal'
  | 'fiscal_read_failed';

/** Qué hace el motor de costeo con el IVA pagado en la compra. */
export type PopFiscalTreatment = 'deductible' | 'capitalized';

/**
 * Explicación fiscal estructurada que el backend emite con la vista previa.
 *
 * La pantalla **no vuelve a derivar el predicado**: pinta lo que llega. Si la
 * app dedujera por su cuenta, móvil y web podrían afirmar cosas opuestas sobre
 * la misma compra — que es exactamente el defecto que este contrato cierra.
 */
export interface PopFiscalExplanation {
  /** Proyección fail-closed: `false` también cuando el estado es indeterminado. */
  vat_responsible: boolean;
  /** `true` ⇒ el comercio no declaró nada o no se pudo leer su ficha fiscal. */
  indeterminate: boolean;
  reason: PopFiscalReason;
  source: PopFiscalSource;
  treatment: PopFiscalTreatment;
  /** Español llano, redactado por el backend y listo para pintar. */
  message: string;
  legal_basis: string[];
  /**
   * Sólo cuando el estado es indeterminado. La RUTA la manda el backend; la
   * pantalla no la inventa.
   */
  cta?: { label: string; route: string };
}

/**
 * Línea de la vista previa. Todos los campos del desglose son OPCIONALES: una
 * respuesta anterior a C.x no los trae y la pantalla tiene que degradar limpio.
 */
export interface PopCostPreviewItem {
  product_id: number;
  product_variant_id?: number | null;
  product_name?: string;
  variant_name?: string;
  current_stock?: number;
  current_cost_per_unit?: number;
  new_stock?: number;
  new_cost_per_unit?: number;
  incoming_quantity?: number;
  incoming_cost?: number;
  /** IVA de la línea que se recupera vía declaración (0 si se capitaliza). */
  deductible_tax_amount?: number;
  /** IVA de la línea que engorda el costo (0 si es descontable). */
  capitalized_tax_amount?: number;
  /** Descuento comercial total ya aplicado a la línea. */
  discount_amount?: number;
  /** Parte del descuento GENERAL de la factura que le tocó a esta línea. */
  header_discount_share?: number;
  /** Flete asignado a la línea. 0 cuando el flete se lleva a gasto. */
  allocated_shipping_amount?: number;
  /** El mismo flete, por unidad — lo que sube el costo unitario. */
  shipping_per_unit?: number;
}

/** Respuesta de `POST /store/orders/purchase-orders/cost-preview`. */
export interface PopCostPreviewResponse {
  costing_method?: 'cpp' | 'fifo' | null;
  vat_responsible?: boolean;
  items?: PopCostPreviewItem[];
  /** B.5 — la explicación fiscal estructurada. Ausente en respuestas viejas. */
  fiscal_explanation?: PopFiscalExplanation;
  /** Flete de la cabecera tal como el backend lo interpretó. */
  shipping_cost?: number;
  /** Lo que el cliente PIDIÓ hacer con el flete. */
  shipping_cost_allocation_requested?: PopShippingAllocation;
  /**
   * Lo que el backend PUDO hacer. Difiere del solicitado cuando `prorate`
   * degrada a `expense` por no haber base sobre la que repartir — y el
   * operador tiene que verlo, porque su elección no se honró.
   */
  shipping_cost_allocation_applied?: PopShippingAllocation;
}

/** Línea de la petición de vista previa (espejo de `CostPreviewItemDto`). */
export interface PopCostPreviewRequestItem {
  product_id: number;
  product_variant_id?: number;
  quantity: number;
  unit_cost: number;
  discount_percentage?: number;
  discount_amount?: number;
  tax_rate?: number;
  tax_type?: string;
  prices_include_tax?: boolean;
}

/**
 * Petición de vista previa. Recibe las MISMAS entradas de cabecera que la
 * creación: mandar menos hace que la simulación y la orden partan de bases
 * distintas y el operador apruebe una cifra irreproducible.
 */
export interface PopCostPreviewRequest {
  location_id: number;
  prices_include_tax?: boolean;
  discount_amount?: number;
  shipping_cost?: number;
  shipping_cost_allocation?: PopShippingAllocation;
  items: PopCostPreviewRequestItem[];
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
