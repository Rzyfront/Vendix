import type { Product, ProductVariant } from './product.types';

export interface PosCustomer {
  id: number;
  first_name: string;
  last_name: string;
  email: string;
  phone?: string | null;
  document_number?: string | null;
}

export interface CartItem {
  id: string;
  product: Product;
  variant?: ProductVariant | null;
  /**
   * Cantidad de la línea. **Sin presentación** cuenta unidades de STOCK (la
   * unidad mínima: mm, g, ml, unidad). **Con presentación aplicada** cuenta
   * PAQUETES, y el inventario descuenta `stockUnitsConsumed`.
   */
  quantity: number;
  /**
   * Precio publicado. Sin presentación es el precio de `priceUnitQuantity`
   * unidades de stock ("$5.000 por metro" ⇒ `unitPrice = 5000` con
   * `priceUnitQuantity = 1000`). Con presentación es el precio del PAQUETE
   * COMPLETO. Es el valor que viaja como `unit_price` en la línea de venta.
   */
  unitPrice: number;
  /** `unitPrice` con impuesto incluido, en la misma escala que `unitPrice`. */
  finalPrice: number;
  /**
   * Total de la línea CON impuesto. Se calcula con `resolveLineTotal`
   * (`unitPrice × quantity / priceUnitQuantity`, redondeando al final) y NUNCA
   * como `finalPrice × quantity`: esa multiplicación es la que cobraba de más.
   */
  totalPrice: number;
  taxAmount: number;
  notes?: string;
  variant_display_name?: string;
  itemType?: 'product' | 'custom';
  /* ============================================================
   * QUI-648 — escala de precio y presentación de venta
   * ============================================================ */
  /**
   * Snapshot de `products.price_unit_quantity` al momento de agregar la línea.
   * Ausente o `1` ⇒ aritmética histórica. **Se ignora cuando la línea lleva
   * presentación**: ahí `unitPrice` ya es el precio del paquete entero
   * (misma exclusión que `hasTierAtIndex` en el backend).
   */
  priceUnitQuantity?: number | null;
  /** Presentación aplicada. Viaja como `applied_price_tier_id` en el payload. */
  appliedPriceTierId?: number | null;
  appliedPriceTierName?: string | null;
  /** `true` cuando la presentación resolvió un packSize > 1. */
  isPackageUnit?: boolean;
  /** packSize efectivo: `override_units_per_package ?? tier ?? 1`. */
  unitsPerPackage?: number | null;
  /**
   * Unidades de stock que consume la línea (`quantity × packSize`). `null`
   * cuando no hay empaque — el consumo es `quantity` y el backend no persiste
   * snapshot. Informativo en el cliente: el backend re-resuelve el valor
   * canónico desde `applied_price_tier_id`.
   */
  stockUnitsConsumed?: number | null;
  /**
   * Unidad en la que el CAJERO capturó la línea ("m", "kg"). `null` = se
   * capturó en la unidad mínima, que es el caso de todo el catálogo por pieza.
   *
   * No cambia el significado de `quantity` —que sigue en unidades mínimas—:
   * solo dice en qué escala volver a leerla para mostrarla. Equivale a
   * `sale_unit_code` del modelo web.
   */
  saleUnitCode?: string | null;
  /**
   * Unidades mínimas que consume UNA unidad de captura (1000 mm por metro).
   * `null` o 1 ⇒ la línea se muestra tal cual, sin conversión. Equivale a
   * `stock_units_per_sale_unit` del modelo web.
   */
  stockUnitsPerSaleUnit?: number | null;
}

export interface CartDiscount {
  id: string;
  type: 'percentage' | 'fixed';
  value: number;
  description: string;
  amount: number;
}

export interface CartSummary {
  subtotal: number;
  taxAmount: number;
  discountAmount: number;
  total: number;
  itemCount: number;
  totalItems: number;
}

export interface CartState {
  items: CartItem[];
  customer: PosCustomer | null;
  notes: string;
  discounts: CartDiscount[];
  summary: CartSummary;
  /** Modo de operación del POS (paridad web `isQuotationMode / isLayawayMode`). */
  mode?: PosMode;
  /**
   * `draftId` cuando el carrito ya fue persistido como orden en draft
   * (paridad con web `pos-cart-modal.component.ts:737`).
   */
  draftId?: string | null;
}

export interface PaymentMethod {
  id: number;
  display_name?: string;
  name?: string;
  type: string;
  icon?: string;
  state?: string;
  system_payment_method?: {
    id?: number;
    name?: string;
    display_name?: string;
    type?: string;
    dian_code?: string;
  };
}

export interface CreatePosPaymentItemDto {
  // product_id is optional in the payload: pre-bulk/draft lines (e.g.
  // products the cashier is composing on the fly) don't have a backend
  // id yet. The backend treats undefined as "create on the fly".
  product_id?: number;
  product_variant_id?: number;
  product_name: string;
  product_sku?: string;
  variant_sku?: string;
  variant_attributes?: Record<string, unknown>;
  quantity: number;
  unit_price: number;
  total_price: number;
  tax_amount_item?: number;
  cost?: number;
  /**
   * Presentación aplicada a la línea. El backend valida el permiso
   * `store:products:apply_pricing_tier`, verifica el allowlist
   * `product_price_tier_assignments` y persiste el snapshot
   * (`applied_price_tier_id`, `applied_price_tier_name`,
   * `stock_units_consumed`). El cliente NO manda `stock_units_consumed`: el
   * consumo real lo re-resuelve el servidor con la cascada
   * `override ?? tier ?? 1`.
   */
  applied_price_tier_id?: number;
}

export interface CreatePosPaymentDto {
  /**
   * Cliente obligatorio cuando el backend aplica
   * `settings.checkout.require_customer_data=true` (canónico).
   * El endpoint `POST /store/payments/pos` rechaza el payload con
   * `POS_CUSTOMER_REQUIRED_001` (HTTP 422) si falta o no pertenece al store.
   */
  customer_id: number;
  customer_name?: string;
  customer_email?: string;
  customer_phone?: string;
  store_id?: number;
  items: CreatePosPaymentItemDto[];
  subtotal: number;
  tax_amount?: number;
  discount_amount?: number;
  total_amount: number;
  currency?: string;
  store_payment_method_id?: number;
  amount_received?: number;
  payment_reference?: string;
  /**
   * `false` = cobrar ahora, `true` = guardar borrador (no cobra).
   * CP-POS-CREAR-EDITAR-COBRAR-001 fase B.2: combinar `is_draft=true` con
   * `requires_payment=true` es contradictorio y devuelve
   * `POS_DRAFT_REQUIRES_PAYMENT_001` (HTTP 409).
   */
  requires_payment: boolean;
  /**
   * `true` indica al backend que persista la orden como `state='draft'`
   * sin emitir `payments`/`order_installments`/COGS ni incrementar
   * `coupons.current_uses`. El cobro va por `flow/pay`.
   */
  is_draft?: boolean;
  delivery_type?: string;
  internal_notes?: string;
  update_inventory?: boolean;
  /**
   * `allow_oversell` se conserva en el payload porque el DTO backend
   * lo exige (`forbidNonWhitelisted: true`) y eliminarlo provocaría 400.
   * **NO se usa como autorización para vender sin stock**: el editor
   * sigue dependiendo del rechazo `POS_STOCK_INSUFFICIENT_001` cuando
   * aplica. Esta flag queda ignorada por el server para órdenes en
   * estado `draft` y se respeta sólo en el camino de cobro.
   */
  allow_oversell?: boolean;
  print_receipt?: boolean;
  payment_form?: string;
  credit_type?: 'free' | 'installments';
}

export interface PosPaymentResponse {
  success: boolean;
  message: string;
  errors?: string[];
  order?: {
    id: number;
    order_number: string;
    status: string;
    payment_status: string;
    total_amount: number;
    invoice_data_token?: string;
  };
  payment?: {
    id?: number;
    amount?: number;
    payment_method?: string;
    status?: string;
    transaction_id?: string;
    change?: number;
  };
}

/**
 * CP-POS-CREAR-EDITAR-COBRAR-001 fase C.1 — payload del nuevo editor
 * atómico backend `PUT /api/store/orders/:id/editor`. Sólo muta campos de
 * negocio (items, cliente, notas, envío, promoción/cupón). El estado, los
 * pagos, el crédito y los flags KDS/fiscales NO se aceptan — pertenecen al
 * flujo canónico `flow/pay` y a la máquina de estados de órdenes.
 *
 * El backend responde con la `Order` completa y autoritativa (totales
 * recalculados, cupón validado, stock verificado). El cliente NO manda
 * totales: el servidor es la fuente de verdad.
 */
export interface UpdateOrderEditorPayload {
  /** Líneas del pedido. Requerido y no-vacío: el editor reemplaza TODAS las líneas. */
  items: CreatePosPaymentItemDto[];
  /** Cliente obligatorio; pertenece al store del contexto o devuelve 403. */
  customer_id: number;
  notes?: string;
  internal_notes?: string;
  /** Enum Prisma `order_delivery_type_enum`. */
  delivery_type?: 'pickup' | 'home_delivery' | 'direct_delivery' | 'other' | 'dine_in';
  billing_address_id?: number;
  shipping_address_id?: number;
  shipping_method_id?: number;
  shipping_rate_id?: number;
  shipping_cost?: number;
  /** Promociones manuales a forzar; las auto-apply las resuelve el motor. */
  promotion_ids?: number[];
  coupon_code?: string | null;
}

export interface PaymentResult {
  order_id: number;
  order_number: string;
  transaction_id?: string;
  change?: number;
}

/**
 * Modo de operación del POS — paridad con `pos.component.ts` web
 * (`isQuotationMode`, `isLayawayMode`, `isEditMode`).
 *
 * - `sale`     → Punto de venta (default). Cobrar normal.
 * - `quotation`→ Crear cotización. No descuenta inventario.
 * - `layaway`  → Crear plan separé. Requiere cliente.
 */
export type PosMode = 'sale' | 'quotation' | 'layaway';

/**
 * Type-only stub de `CashRegisterSession` — declarado aquí (en lugar del
 * servicio de cash-register) para que `pos-screen-header.tsx` compile
 * standalone sin acoplar la pantalla POS al módulo de caja. Cuando el
 * servicio de cash-register se integre, su shape debe coincidir
 * exactamente con este; la fuente de verdad canónica será el service.
 */
export type CashSessionStatus = 'open' | 'closed' | 'suspended';

export interface CashRegister {
  id: number;
  name: string;
  code: string;
  description?: string;
  is_active: boolean;
  default_opening_amount?: number;
  location_id?: number | null;
  location?: { id: number; name: string } | null;
}

export interface CashRegisterSession {
  id: number;
  cash_register_id: number;
  store_id: number;
  opened_by: number;
  closed_by?: number;
  status: CashSessionStatus;
  opened_at: string;
  closed_at?: string;
  opening_amount: number;
  expected_closing_amount?: number;
  actual_closing_amount?: number;
  difference?: number;
  closing_notes?: string;
  summary?: unknown;
  ai_summary?: string;
  register?: CashRegister;
  opened_by_user?: { id: number; first_name: string; last_name: string };
  closed_by_user?: { id: number; first_name: string; last_name: string };
}
