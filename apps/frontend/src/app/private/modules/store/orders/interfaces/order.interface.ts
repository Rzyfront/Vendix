// Order channel types
export type OrderChannel = 'pos' | 'ecommerce' | 'agent' | 'whatsapp' | 'marketplace';

// Delivery type - aligned with Prisma enum
export type DeliveryType = 'pickup' | 'home_delivery' | 'direct_delivery' | 'other';

// Shipping entities - Aligned with backend shipping models
export interface ShippingMethod {
  id: number;
  name: string;
  type: string;
  provider_name?: string;
  min_days?: number;
  max_days?: number;
  logo_url?: string;
}

export interface ShippingZone {
  id: number;
  name: string;
  display_name?: string;
}

export interface ShippingRate {
  id: number;
  name?: string;
  type: string;
  base_cost: number;
  shipping_zone?: ShippingZone;
}

// Core entities - Aligned with backend models
export interface Order {
  id: number;
  customer_id: number;
  // Carril B - B1: alias de venta para consumidor final. Persiste en
  // orders.customer_alias (schema.prisma:1445, XOR con customer_id).
  // El operador lo ve en lugar del nombre del cliente y conserva la
  // marca "CF" al lado para no perder que sigue siendo consumidor final.
  customer_alias?: string | null;
  store_id: number;
  order_number: string;
  state: OrderState;
  channel?: OrderChannel;
  delivery_type?: DeliveryType;
  shipping_method_id?: number;
  shipping_rate_id?: number;
  shipping_method?: ShippingMethod;
  shipping_rate?: ShippingRate;
  subtotal_amount: number;
  tax_amount: number;
  shipping_cost: number;
  discount_amount: number;
  grand_total: number;
  currency: string;
  payment_form?: string;
  credit_type?: 'free' | 'installments' | null;
  interest_rate?: number;
  interest_type?: 'simple' | 'compound' | null;
  total_paid?: number;
  remaining_balance?: number;
  total_with_interest?: number;
  order_installments?: OrderInstallment[];
  billing_address_id?: number;
  shipping_address_id?: number;
  internal_notes?: string;
  /**
   * Staff-only note (optional, set at creation only).
   * Never exposed to the customer.
   */
  notes?: string;
  // CP-POS-SVC-PERF-001 / C.5 — service bookings attached to this order.
  bookings?: OrderBooking[];
  created_at: string;
  updated_at: string;
  completed_at?: string;
  stores?: {
    id: number;
    name: string;
    store_code: string;
  };
  order_items?: OrderItem[];
  addresses_orders_billing_address_idToaddresses?: Address;
  addresses_orders_shipping_address_idToaddresses?: Address;
  payments?: Payment[];
  users?: {
    id: number;
    first_name: string;
    last_name: string;
    email: string;
    phone?: string;
    avatar_url?: string;
  };
  // Persisted discount snapshots — read-only from backend, never recalculated.
  order_promotions?: OrderPromotionSnapshot[];
  coupon_uses?: CouponUseSnapshot[];
  /**
   * La última factura de la orden, EN CUALQUIER ESTADO — newest first, `take:
   * 1`. Optional: sólo los endpoints que devuelven el detalle la incluyen.
   *
   * Antes venía pre-filtrada por el backend a `dian_status: 'accepted'`, así
   * que la sola presencia de una fila significaba «aceptada». Dejó de ser así
   * (`orders.service.ts`, método `findOne`): la orden es dueña de la relación
   * con su factura y tiene que poder identificarla también rechazada,
   * pendiente o en contingencia — que es justo cuando el operador más
   * necesita entrar a verla. `OrderTicketService.toTicketData` y el detalle de
   * orden derivan «aceptada» ellos mismos leyendo `dian_status`, cada uno para
   * su propia pregunta (el tiquete: ¿puedo decir «validada por la DIAN»?; el
   * detalle: ¿qué chips de estado fiscal pinto?).
   */
  invoices?: OrderInvoiceSnapshot[];
  /** Table session if order was placed at a restaurant table */
  table_sessions?: OrderTableSession[];
}

/**
 * Espejo de `fiscal_transmission_status_enum` (schema.prisma, modelo
 * `invoices`).
 */
export type OrderInvoiceTransmissionStatus =
  | 'draft'
  | 'queued'
  | 'signing'
  | 'signed'
  | 'submitted'
  | 'accepted'
  | 'rejected'
  | 'error'
  | 'retrying'
  | 'cancelled'
  | 'contingency';

/** Espejo de `dian_document_status_enum` (schema.prisma, modelo `invoices`). */
export type OrderInvoiceDianStatus =
  | 'pending'
  | 'accepted'
  | 'rejected'
  | 'error'
  | 'not_applicable';

/**
 * Espejo de `document_send_status_enum` (schema.prisma, modelo `invoices`).
 */
export type OrderInvoiceSendStatus =
  | 'pending'
  | 'sending'
  | 'sent_ok'
  | 'sent_error'
  | 'not_applicable';

/** Espejo de `invoice_status_enum` (schema.prisma, modelo `invoices`). */
export type OrderInvoiceStatus =
  | 'draft'
  | 'validated'
  | 'sent'
  | 'accepted'
  | 'rejected'
  | 'cancelled'
  | 'voided';

/**
 * Espejo de `invoice_type_enum` (schema.prisma, modelo `invoices`). Nueve
 * valores, no cinco: el módulo de facturación declara su propio `InvoiceType`
 * con sólo cinco porque hoy ningún flujo suyo emite documento equivalente ni
 * nota de ajuste de documento equivalente. Una orden sí puede tener cualquiera
 * de los nueve, así que este alias no se importa de allá.
 */
export type OrderInvoiceType =
  | 'sales_invoice'
  | 'purchase_invoice'
  | 'credit_note'
  | 'debit_note'
  | 'export_invoice'
  | 'support_document'
  | 'support_adjustment_note'
  | 'pos_equivalent_document'
  | 'equivalent_adjustment_note';

/**
 * Proyección de factura que trae el detalle de la orden.
 *
 * DOS consultas la llenan, y no proyectan lo mismo:
 * `OrdersService.findOne` manda las nueve columnas sin `where` — QUI-604 la
 * filtraba a `dian_status: 'accepted'`; dejó de hacerlo (ver comentario de
 * `invoices?` arriba)—, y `OrdersBulkService.bulkPrint` manda tres
 * (`invoice_number`, `cufe`, `dian_status`) y conserva su `where`. De ahí que
 * abajo sólo dos campos sean requeridos.
 *
 * Antes esta interfaz sólo declaraba `invoice_number` + `cufe`: sin `id` la
 * orden no podía abrir el modal de detalle de factura, y sin `invoice_type` /
 * `dian_status` / `transmission_status` / `send_status` la tarjeta no podía
 * reutilizar `fiscalStatusCells()` del módulo de facturación — esa función
 * pinta un chip por columna presente y omite las que faltan, así que con la
 * proyección vieja pintaba una tarjeta desnuda y, peor, sobre una factura
 * electrónica real le decía al operador «no es electrónica»
 * (`fiscalStatusCells` cae a esa lectura cuando `invoice_type` no viaja).
 */
export interface OrderInvoiceSnapshot {
  /**
   * REQUERIDOS: los dos campos que proyectan LAS DOS consultas que llenan
   * `invoices` — `OrdersService.findOne` y `OrdersBulkService.bulkPrint`.
   *
   * `dian_status` viaja también en la de bulk, donde es redundante (su `where`
   * ya lo fija a `accepted`), precisamente para poder declararlo requerido:
   * mientras faltaba, el tiquete tenía que tratar su ausencia como «aceptada»
   * y afirmaba validación DIAN por omisión.
   */
  invoice_number: string;
  dian_status: OrderInvoiceDianStatus;
  /** Opcional en el tipo porque lo es en el dato: `bulkPrint` no lo proyecta. */
  cufe?: string | null;
  /**
   * OPCIONALES: sólo los proyecta `findOne` (el detalle de una orden). El
   * `bulkPrint` no los manda porque su tiquete no los usa y multiplicarlos por
   * 300 órdenes es payload muerto. Declararlos requeridos sería mentirle al
   * tipo: quien los lea desde el camino de impresión masiva tiene que aceptar
   * `undefined`.
   */
  id?: number;
  invoice_type?: OrderInvoiceType;
  status?: OrderInvoiceStatus;
  transmission_status?: OrderInvoiceTransmissionStatus;
  send_status?: OrderInvoiceSendStatus;
  issue_date?: string;
}

export interface OrderTableSession {
  id: number;
  table_id: number;
  guest_count?: number | null;
  opened_at?: string;
  closed_at?: string | null;
  table?: {
    id: number;
    name: string;
    zone?: string | null;
    capacity?: number | null;
    status?: string;
  };
  opener?: {
    id: number;
    first_name?: string | null;
    last_name?: string | null;
  } | null;
}

export interface OrderPromotionSnapshot {
  id: number;
  promotion_id: number;
  customer_id?: number | null;
  discount_amount: number | string;
  created_at?: string | null;
  promotions?: {
    id: number;
    name: string;
    code?: string | null;
    type?: 'percentage' | 'fixed_amount' | string | null;
    scope?: 'order' | 'product' | 'category' | string | null;
    value?: number | string | null;
  } | null;
}

export interface CouponUseSnapshot {
  id: number;
  coupon_id: number;
  customer_id?: number | null;
  discount_applied: number | string;
  used_at?: string | null;
  coupon?: {
    id: number;
    code: string;
    name?: string | null;
    discount_type?: string | null;
    discount_value?: number | string | null;
  } | null;
}

export interface OrderItem {
  id: number;
  order_id: number;
  product_id: number;
  product_variant_id?: number;
  product_name: string;
  variant_sku?: string;
  variant_attributes?: string;
  variant_image_url?: string | null;
  quantity: number;
  unit_price: number;
  total_price: number;
  tax_rate?: number;
  tax_amount_item?: number;
  applied_price_tier_id?: number | null;
  applied_price_tier_name_snapshot?: string | null;
  stock_units_consumed?: number | null;
  item_type?: string;
  created_at: string;
  updated_at: string;
  products?: Product;
  product_variants?: ProductVariant;
  /**
   * Plan KDS fire-flows: persisted on the backend at order creation.
   * - `inventory_consumed_at_fire`: `true` once the item has been
   *   fired to the kitchen (kitchen_ticket row exists) OR is
   *   recipe-less and still routed through the fire core. False on
   *   creation. The detail page uses this to know if a line is
   *   eligible for the manual selective fire.
   * - `skip_kds`: cashier's "usar stock" intent. `true` means the
   *   line will never be fired (stock consumed at payment). Hidden
   *   from the manual fire button.
   */
  inventory_consumed_at_fire?: boolean;
  skip_kds?: boolean;
  /**
   * Restaurant Suite — Fase K Gap 2: KDS state for this order_item.
   * Populated by GET /store/orders/:id when the item has been fired
   * to the kitchen. Empty array for retail-only items. The detail
   * page picks the most recent non-terminal (or newest terminal)
   * ticket-item to render the "Cocina: <estado>" badge.
   */
  kitchen_ticket_items?: Array<{
    id: number;
    status: 'pending' | 'in_preparation' | 'ready' | 'delivered' | 'cancelled';
    kitchen_ticket_id: number;
    kitchen_ticket?: {
      id: number;
      status: 'pending' | 'in_preparation' | 'ready' | 'delivered' | 'cancelled';
      daily_number?: number | null;
      fired_at?: string | Date | null;
    };
  }>;
  /**
   * QUI-T9p6 — entrega a nivel de ítem (NO del KDS: ese vive en
   * `kitchen_ticket_items[].status='delivered'`). Diferente y ortogonal:
   * la entrega es un hecho de SERVICIO (la comida llegó al cliente), no
   * de cocina. Se estampa al ejecutar
   * PATCH /api/store/orders/:orderId/flow/items/:itemId/deliver.
   *
   * `null` (o ausente) = no entregado. Una fecha = entregado.
   * `orders.service.ts:710 findOne` usa `include` sin `select`, así que
   * Prisma devuelve todas las columnas escalares de `order_items`
   * (`schema.prisma:1427-1428`) — el campo YA viaja por el cable.
   * Esta declaración es declarar lo que ya llega.
   */
  delivered_at?: string | null;
  delivered_by_user_id?: number | null;
}

export interface Address {
  id: number;
  address_line1: string;
  address_line2?: string;
  city: string;
  state_province: string;
  postal_code: string;
  country_code: string;
  /**
   * Código DANE del municipio (5 dígitos). Se persiste en
   * `addresses.municipality_code` y el emisor de factura electrónica lo lee
   * para llenar `cac:Address/cac:CountrySubentity/cbc:CityName` con el nombre
   * canónico del catálogo Divipola — sin él, el documento afirma geografía
   * falsa y la DIAN rechaza por incoherencia (FAJ32 / FAK32).
   */
  municipality_code?: string | null;
  phone_number?: string;
}

export interface Product {
  id: number;
  name: string;
  description?: string;
  sku: string;
  price: number;
  product_type?: 'physical' | 'prepared' | 'service' | string;
  final_price: number;
  image_url?: string;
  /**
   * Ref 2026-06-25, plan wizard remisión order-first.
   * Si true, el item requiere asignación de seriales antes de confirmar
   * la remisión (gate backend SERIAL_REQUIRED_001). El frontend lo lee
   * del GET /store/orders/:id (findOne incluye products).
   */
  requires_serial_numbers?: boolean;
}

export interface ProductVariant {
  id: number;
  sku: string;
  price: number;
  attributes?: string;
}

export interface Payment {
  id: number;
  order_id: number;
  customer_id?: number;
  amount: number;
  currency: string;
  state: PaymentStatus;
  receipt_s3_key?: string | null;
  receipt_uploaded_at?: string | null;
  transaction_id?: string;
  gateway_response?: {
    change?: number;
    payment_reference?: string;
    metadata?: {
      register_id?: string;
      is_pos_payment?: boolean;
      seller_user_id?: string;
      payment_method?: string;
      amount_received?: number;
      reference?: string;
      is_credit_payment?: boolean;
    };
  };
  created_at: string;
  updated_at: string;
  store_payment_method_id?: number;
  /**
   * Payment-method relation. This — not `gateway_response.metadata` — is where
   * the printed method name comes from: nothing writes
   * `metadata.payment_method`, so `OrderTicketService.toTicketData` reads this
   * cascade (`display_name` → `system_payment_method.display_name`) instead.
   *
   * Included by the order detail endpoint and by `POST /store/orders/bulk/print`.
   */
  store_payment_method?: {
    id: number;
    /**
     * The store's own alias for the method (`store_payment_methods.display_name`
     * is a nullable VarChar(100)). Absent/blank means "use the catalogue name".
     */
    display_name?: string | null;
    system_payment_method?: {
      type: string;
      /** Catalogue slug (`system_payment_methods.name`, unique, NOT NULL). */
      name?: string;
      /** Catalogue label ("Efectivo", "Tarjeta"…), NOT NULL in the DB. */
      display_name: string;
      /**
       * Structural discriminator of how the money is captured, mirrored from
       * `system_payment_methods.processing_mode` (backend findOne includes the
       * full system_payment_method). Drives whether a pending payment is a real
       * ONLINE capture awaiting confirmation (ecommerce) or a contra-entrega
       * (ON_DELIVERY) that collects at delivery — the latter must NOT show the
       * "dispatch without confirming payment" warning.
       */
      processing_mode?: 'DIRECT' | 'ONLINE' | 'ON_DELIVERY';
    };
  };
  /** QUI-728 (E.1) — id de `bank_accounts` al que entró la transferencia. */
  bank_account_id?: number | null;
  /**
   * QUI-728 (E.2) — cuenta de destino ya resuelta por el detalle de orden.
   *
   * Proyección MÍNIMA a propósito (`orders.service.ts` findOne): id, nombre,
   * banco y número. NUNCA saldos ni cuenta contable — esta pantalla solo
   * identifica la cuenta, no la concilia. Es `undefined` en todo pago que no
   * sea transferencia, y también en las transferencias anteriores al fix del
   * `bank_account_id` que se perdía en el POS: esas quedan en "Pagos sin
   * asignar" hasta que alguien las asigne a mano.
   */
  bank_account?: {
    id: number;
    name: string;
    bank_name: string;
    account_number: string;
  } | null;
  users?: {
    id: number;
    first_name: string;
    last_name: string;
    email: string;
    phone?: string;
    avatar_url?: string;
  };
}

export interface OrderInstallment {
  id: number;
  order_id: number;
  installment_number: number;
  amount: number;
  capital_amount: number;
  interest_amount: number;
  due_date: string;
  state: 'pending' | 'paid' | 'partial' | 'overdue' | 'forgiven';
  amount_paid: number;
  remaining_balance: number;
  paid_at?: string;
  notes?: string;
  created_at: string;
  updated_at: string;
}

// Types and enums - Aligned with backend enums
export type OrderState =
  | 'draft'
  | 'created'
  | 'pending_payment'
  | 'processing'
  | 'shipped'
  | 'delivered'
  | 'cancelled'
  | 'refunded'
  | 'finished'
  // Bug 7: estado intermedio para órdenes con envío a domicilio + platos.
  | 'pending_delivery';

export type PaymentStatus =
  | 'pending'
  | 'succeeded'
  | 'failed'
  | 'authorized'
  | 'captured'
  | 'refunded'
  | 'partially_refunded'
  | 'cancelled';

// Query and response interfaces
export interface OrderQuery {
  // Búsqueda
  search?: string;

  // Filtros principales
  status?: OrderState;
  channel?: OrderChannel;
  customer_id?: number;
  // Carril B - B2: filtra órdenes con table_session apuntando a esta mesa
  // (incluye sesiones cerradas porque la orden pudo migrar entre mesas).
  // Coincide con OrderQueryDto.table_id en backend (orders.service.ts).
  table_id?: number;
  store_id?: number;
  payment_status?: PaymentStatus;
  date_range?: string;

  // Filtros de fecha
  date_from?: string;
  date_to?: string;

  // Paginación
  page?: number;
  limit?: number;

  missing_shipping_method?: boolean;

  /**
   * "Despachable" / "Por enviar" — ref 2026-06-25.
   * Filtra órdenes pendientes de despacho: state=processing +
   * delivery_type ≠ direct_delivery (incluye home_delivery, pickup, other).
   * Single source of truth compartido con orders.service.ts findAll()
   * y stores.service.ts dispatchWhere. Usado por el botón "Por enviar"
   * de la lista y por el contador del dashboard.
   */
  dispatchable?: boolean;

  // Ordenamiento
  sort?: string; // Format: 'field:direction' e.g., 'created_at:desc'
  sort_by?: string;
  sort_order?: 'asc' | 'desc';
}

export interface PaginatedOrdersResponse {
  data: Order[];
  pagination: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
}

export interface OrderStats {
  total_orders: number;
  total_revenue: number;
  pending_orders: number;
  completed_orders: number;
  average_order_value: number;
}

// DTOs
export interface CreateOrderDto {
  customerId: string;
  items: CreateOrderItemDto[];
  notes?: string;
  paymentMethod?: string;
}

export interface CreateOrderItemDto {
  productId: string;
  quantity: number;
  unitPrice?: number; // Opcional, usa precio del producto si no se especifica
}

export interface UpdateOrderStatusDto {
  status: OrderState;
  notes?: string;
  notifyCustomer?: boolean;
}

export interface UpdatePaymentStatusDto {
  paymentStatus: PaymentStatus;
  transactionId?: string;
  notes?: string;
}

// UI interfaces
export interface OrderAction {
  id: string;
  label: string;
  icon?: string;
  action: () => void;
  disabled?: boolean;
  variant?: 'primary' | 'secondary' | 'danger';
}

export interface OrderFilters {
  search: string;
  status: OrderState[];
  paymentStatus: PaymentStatus[];
  dateRange: string;
  customerId?: string;
  minAmount?: number;
  maxAmount?: number;
}

export interface FilterOption {
  value: string;
  label: string;
  disabled?: boolean;
  icon?: string;
}

export interface FilterConfig {
  status: FilterOption[];
  paymentStatus: FilterOption[];
  dateRange: FilterOption[];
}

export interface OrderTableColumn {
  key: keyof Order | 'actions';
  label: string;
  sortable?: boolean;
  width?: string;
  align?: 'left' | 'center' | 'right';
  transform?: (value: any, order: Order) => string;
  badge?: {
    type?: 'status' | 'custom';
    colorKey?: string;
    colorMap?: Record<string, string>;
    size?: 'sm' | 'md' | 'lg';
  };
}

export interface TableConfig {
  columns: OrderTableColumn[];
  loading: boolean;
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export interface TableActions {
  refresh: () => void;
  newOrder: () => void;
  export: () => void;
}

// Order Types
export interface PurchaseOrder extends Order {
  orderType: 'purchase';
  supplier: {
    id: string;
    name: string;
    email?: string;
    phone?: string;
    address?: {
      street: string;
      city: string;
      state: string;
      zipCode: string;
      country: string;
    };
  };
  expectedDeliveryDate?: string;
  purchaseRep?: {
    id: string;
    name: string;
  };
}

export interface StockTransfer extends Order {
  orderType: 'transfer';
  fromLocation: {
    id: string;
    name: string;
    type: 'warehouse' | 'store';
  };
  toLocation: {
    id: string;
    name: string;
    type: 'warehouse' | 'store';
  };
  transferReason?: string;
  approvedBy?: {
    id: string;
    name: string;
  };
  receivedBy?: {
    id: string;
    name: string;
  };
}

// Create Request DTOs
export interface CreatePurchaseOrderRequest {
  supplierId: string;
  items: CreateOrderItemDto[];
  expectedDeliveryDate?: string;
  notes?: string;
  purchaseRepId?: string;
}

export interface CreateStockTransferRequest {
  fromLocationId: string;
  toLocationId: string;
  items: CreateOrderItemDto[];
  transferReason?: string;
  notes?: string;
}

// Extended OrderStats with growth rates
// Note: These properties are calculated on the frontend
// and not part of the backend response

export interface ExtendedOrderStats extends OrderStats {
  ordersGrowthRate?: number;
  pendingGrowthRate?: number;
  completedGrowthRate?: number;
  revenueGrowthRate?: number;
}

// ── Order Flow DTOs ──────────────────────────────────────────────

export type PaymentType = 'direct' | 'online';

export interface PayOrderDto {
  store_payment_method_id: number;
  payment_type: PaymentType;
  amount_received?: number;
  amount?: number;
  installment_id?: number;
  payment_reference?: string;
  // Propina (T3). Mismos nombres que `CreatePosPaymentDto` y que el
  // `PayOrderDto` del backend: el collector es uno solo para POS, mesa y
  // detalle de orden, asi que el contrato tiene que ser identico en los tres
  // destinos. Un nombre distinto aqui no se ignora: `forbidNonWhitelisted`
  // lo convierte en un 400.
  tip_amount?: number;
  tip_type?: 'percentage' | 'fixed';
  tip_value?: number;
  tip_waiter_id?: number;
}

export interface ShipOrderDto {
  tracking_number?: string;
  carrier?: string;
  notes?: string;
}

export interface DeliverOrderDto {
  delivery_notes?: string;
  delivered_to?: string;
}

export interface CancelOrderDto {
  reason: string;
}

export interface ReactivateOrderDto {
  reason?: string;
}

export interface RefundOrderDto {
  amount?: number;
  reason: string;
}

export interface PayOrderResponse {
  order: Order;
  payment: {
    transaction_id: string;
    change?: number;
  };
}

/**
 * Body for `POST /store/orders/:id/flow/fast-track`.
 * Drives the backend OrderFlowService.fastTrackOrder to execute
 * pay (optional if already paid) -> ship -> deliver -> finish in one call.
 */
export interface FastTrackOrderDto {
  payment?: PayOrderDto;
  ship?: ShipOrderDto;
  deliver?: DeliverOrderDto;
}

export interface AssignShippingMethodDto {
  shipping_method_id: number;
  shipping_rate_id?: number | null;
  shipping_cost?: number | null;
  auto_calculate?: boolean;
}

export interface OrderFlowMetadata {
  tracking_number?: string;
  carrier?: string;
  shipping_notes?: string;
  delivery_notes?: string;
  delivered_to?: string;
  cancellation_reason?: string;
  refund_reason?: string;
  refund_amount?: number;
  /**
   * Optional structured representation of the staff-only internal note.
   * When present, the order-details page suppresses the plain-text
   * `internal_notes` block to avoid duplication. Stored as JSON
   * (e.g. an array of `{ key, value }` pairs).
   */
  internal_notes_as_json?: unknown;
}

// ── Order Detail UI Types ──────────────────────────────────────

export interface OrderActionConfig {
  id: string;
  label: string;
  icon: string;
  variant?: 'primary' | 'secondary' | 'success' | 'danger' | 'warning' | 'info' | 'ghost';
  type?: 'button' | 'alert';
  color?: string;
  manualStateTarget?: OrderState;
  requiresConfirmation?: boolean;
}

export interface OrderPaymentMethod {
  id: number;
  display_name: string;
  type: string; // 'cash' | 'card' | 'bank_transfer' | 'digital_wallet'
  icon: string;
  requiresReference: boolean;
  referenceLabel?: string;
}

// ── Refund Flow Types ──────────────────────────────────────

export type InventoryAction = 'restock' | 'write_off' | 'no_return';
export type RefundMethod = 'original_payment' | 'cash' | 'bank_transfer' | 'store_credit';

export interface RefundItemRequest {
  order_item_id: number;
  quantity: number;
  inventory_action: InventoryAction;
  location_id?: number;
  reason?: string;
  /**
   * Hotfix post-PR-576: la columna `refund_items.bank_account_id` ya
   * existe en DB con FK + ON DELETE SET NULL, pero ni el modal ni el
   * DTO la enviaban. Para `refund_method === 'bank_transfer'` el
   * operador debe seleccionar la cuenta destino (auditable). Si llega
   * `null` para `bank_transfer`, el backend devuelve 400.
   */
  bank_account_id?: number;
}

export interface CreateRefundRequest {
  items: RefundItemRequest[];
  include_shipping: boolean;
  refund_method: RefundMethod;
  reason: string;
  notes?: string;
  bank_account_id?: number;
}

export interface RefundItemCalculation {
  order_item_id: number;
  product_name: string;
  variant_sku?: string;
  variant_attributes?: string;
  image_url?: string;
  quantity: number;
  unit_price: number;
  gross_amount: number;
  discount_amount: number;
  net_amount: number;
  tax_amount: number;
  refund_amount: number;
  inventory_action: string;
  location_id?: number;
  reason?: string;
}

export interface RefundCalculationResult {
  items: RefundItemCalculation[];
  subtotal_refund: number;
  tax_refund: number;
  shipping_refund: number;
  total_refund: number;
  is_full_refund: boolean;
  already_refunded: number;
  max_refundable: number;
}

export interface RefundRecord {
  id: number;
  order_id: number;
  amount: number;
  subtotal_refund?: number;
  tax_refund?: number;
  shipping_refund?: number;
  reason?: string;
  notes?: string;
  state: string;
  refund_method?: string;
  processed_at?: string;
  created_at: string;
  refund_items: RefundItemRecord[];
  users?: {
    id: number;
    first_name: string;
    last_name: string;
    email: string;
  };
}

export interface RefundItemRecord {
  id: number;
  order_item_id: number;
  quantity: number;
  refund_amount: number;
  tax_amount?: number;
  discount_amount?: number;
  inventory_action?: string;
  reason?: string;
  order_items?: OrderItem;
  inventory_locations?: {
    id: number;
    name: string;
    code: string;
  };
}

/**
 * Body for `PATCH /store/orders/:orderId/flow/refunds/:refundId/resolve`.
 * Mirrors the backend `ResolveRefundDto` exactly (FB-03 contract):
 *  - `target_state` is restricted server-side to `completed` | `failed`
 *    (other refund states are terminal and not resettable).
 *  - `resolution_notes` is non-empty after trim — kept as required here so
 *    the form's `Validators.required` matches the DTO without needing a
 *    second source of truth.
 */
export interface ResolveRefundPayload {
  target_state: 'completed' | 'failed';
  resolution_notes: string;
}

/**
 * * CP-POS-SVC-PERF-001 / C.5 — booking row surfaced via `findOne`. The
 * `provider.employee` chain is the canonical way Vendix resolves the
 * assigned staff member (vendix-restaurant-ops equivalent is `staff`).
 */
export interface OrderBooking {
  id: number;
  booking_number?: string;
  product_id: number;
  product_variant_id?: number;
  customer_id: number;
  /** Calendar date (YYYY-MM-DD) of the appointment. */
  date: string;
  /** "HH:mm" wall-clock time, store-local. */
  start_time: string;
  end_time: string;
  status: string;
  provider_id?: number | null;
  channel?: string;
  notes?: string;
  product?: { id: number; name: string };
  product_variants?: { id: number; name: string };
  provider?: {
    id: number;
    display_name?: string;
    avatar_url?: string;
    employee?: {
      id: number;
      first_name: string;
      last_name: string;
      avatar_url?: string;
    } | null;
  } | null;
}
