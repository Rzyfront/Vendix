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
  // Weight product fields (camino LEGADO: `quantity` queda en 1 y el peso es el
  // multiplicador). Se conserva para que las líneas de peso ya existentes no
  // cambien de lectura; los productos que declaran unidad de stock ya NO pasan
  // por acá — ver `sale_unit_code` abajo.
  weight?: number;
  weight_unit?: 'kg' | 'g' | 'lb';
  is_weight_product?: boolean;
  // ===== QUI-648 · captura por unidad de venta =====
  // `quantity` vive SIEMPRE en la unidad mínima del producto (mm, g, ml,
  // unidad), igual que `order_items.quantity`. Estos tres campos son los que
  // permiten mostrar la misma escala que el cajero capturó sin tocar la
  // cantidad que viaja al backend.
  /** Unidad en la que el cajero capturó la línea ("m", "kg"). */
  sale_unit_code?: string | null;
  /** Unidades mínimas que consume UNA unidad de venta (1000 mm por metro). */
  stock_units_per_sale_unit?: number | null;
  /** Escala del precio publicado (`products.price_unit_quantity`). */
  price_unit_quantity?: number | null;
  /**
   * La línea se capturó pesando en la balanza. La balanza dejó de ser un modo
   * del producto y es un método de captura de la línea: por eso el flag vive
   * acá y no en el producto. Una línea así no ofrece selector de presentación
   * —lo pesado ya define la cantidad— y se reedita volviendo a pesar.
   */
  captured_by_scale?: boolean;
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
  // QUI-653 — la línea se empaca y el cliente se la lleva. A diferencia de
  // `skipKds`, este flag SÍ se persiste: viaja a `order_items.is_takeaway` vía
  // `TableSessionAddItem`, porque el ticket de cocina y el tiquete impreso lo
  // necesitan después del cobro.
  //
  // Solo tiene sentido en el camino POS -> mesa. En una venta directa del POS
  // (sin sesión de mesa) "para llevar" no significa nada.
  //
  // ATENCIÓN: participa en la identidad de la línea igual que `skipKds` (ver la
  // clave de fusión en pos-cart.service.ts). Dos líneas del mismo plato, una
  // para llevar y otra para la mesa, son líneas DISTINTAS; fusionarlas perdería
  // una de las dos decisiones en silencio.
  isTakeaway?: boolean;
  // QUI-431 — Serial numbers chosen by the cashier for a serialized
  // product (`requires_serial_numbers=true`). `serial_ids` are existing
  // pool rows picked from the selector; `serial_numbers` are free-text
  // entries the backend resolves-or-creates as real pool rows at payment.
  // Both are threaded onto the POS order line and sent to the backend on
  // checkout. Ignored for non-serialized products.
  serial_ids?: number[];
  serial_numbers?: string[];
  // CP-POS-SVC-BOOKING-001 — Scheduled appointment details for service lines.
  booking?: CartItemBooking;
}

export interface CartItemBooking {
  booking_id?: number;
  provider_id?: number | null;
  provider_name?: string;
  date: string;
  start_time: string;
  end_time: string;
  notes?: string;
  service_location_type?: 'shop' | 'home';
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
  /**
   * Names of the cart products the discount was actually applied to. Empty
   * for `scope: 'order'` (whole order) — the POS UI hides the suffix in
   * that case. Used by the cart sidebar to show "(Guanabana, Mango)" so
   * the operator knows which line the discount is hitting. Mirrors the
   * ecommerce `AppliedPromotion.applicable_descriptions` so operators and
   * shoppers see the same UX.
   */
  affected_products?: string[];
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

/**
 * Fulfillment context carried by the cart. Mirrors the editor payload shape
 * (`UpdateOrderEditorDto` accepts `delivery_type`, `shipping_address_id`,
 * `billing_address_id`, `shipping_method_id`, `shipping_rate_id`,
 * `shipping_cost`). Nulls are intentional: an order with no shipping
 * (pickup) keeps every key null and the editor endpoint treats them as
 * "no change".
 *
 * F-FLETE — quién lo escribe y quién lo lee (antes esta nota MENTÍA: decía
 * "populated by `loadFromOrder`" cuando no existía un solo escritor en todo
 * el POS, y el carril vivo de edición reconstruía el envío desde cero):
 *
 *  - ESCRITOR: `PosCartService.loadFromOrder` (`pos-cart.service.ts`), en sus
 *    DOS ramas (orden con líneas y orden vacía).
 *  - LECTORES: `PosCheckoutShellComponent.buildEditorShippingPayload` (carril
 *    VIVO, el que arma el PUT /editor) y `PosComponent.buildEditorRequest`
 *    (carril legado). Ambos deciden con `hasShipmentContext()`.
 *  - MAPEO INVERSO al wizard: `deliveryTypeToEntregaChoice()` — único sitio
 *    donde `order_delivery_type_enum` (5 valores) se colapsa a los 3 de
 *    `EntregaChoice`.
 */
export interface ShippingContext {
  deliveryType: string | null;
  shippingAddressId: number | null;
  billingAddressId: number | null;
  shippingMethodId: number | null;
  shippingRateId: number | null;
  shippingCost: number | null;
}

/**
 * ¿El snapshot describe una orden CON flete? Es el predicado que separa
 * "preservar el envío de la orden" de "no hay nada que preservar".
 *
 * Evidencia de flete = método de envío asignado O costo > 0. Un
 * `delivery_type` por sí solo NO alcanza: `order_delivery_type_enum` tiene
 * `direct_delivery` como DEFAULT de columna (`schema.prisma:1522`), así que
 * una venta de mostrador creada sin especificar nada ya nace
 * `direct_delivery` sin un peso de flete.
 */
export function hasShipmentContext(
  context: Pick<ShippingContext, 'shippingMethodId' | 'shippingCost'> | null | undefined,
): boolean {
  if (!context) return false;
  if (context.shippingMethodId != null) return true;
  const cost = Number(context.shippingCost ?? 0);
  return Number.isFinite(cost) && cost > 0;
}

/**
 * Mapeo inverso `order_delivery_type_enum` → carril del wizard de checkout.
 *
 * ÚNICA definición. Antes vivía duplicada y coja en dos sitios de
 * `pos.component.ts` como `delivery_type === 'home_delivery' ? 'enviar' :
 * 'llevar'`: no reconocía `dine_in` (mesa QR se veía como "llevar") y
 * colapsaba `direct_delivery` y `other` a "llevar", que es justo lo que
 * llevaba al shell a forzar `delivery_type: 'pickup'` sobre un borrador que
 * era `direct_delivery` — cambiarle la naturaleza a la orden por el solo
 * hecho de reabrirla.
 *
 * `direct_delivery` / `other` son ambiguos por sí mismos (ver
 * {@link hasShipmentContext}): se resuelven por la EVIDENCIA de flete, no por
 * la etiqueta.
 */
export function deliveryTypeToEntregaChoice(
  context: ShippingContext | null | undefined,
): 'mesa' | 'llevar' | 'enviar' {
  switch (context?.deliveryType ?? null) {
    case 'home_delivery':
      return 'enviar';
    case 'dine_in':
      return 'mesa';
    case 'pickup':
      return 'llevar';
    case 'direct_delivery':
    case 'other':
    default:
      return hasShipmentContext(context) ? 'enviar' : 'llevar';
  }
}

export interface CartState {
  items: CartItem[];
  customer: PosCustomer | null;
  notes: string;
  /**
   * Staff-only notes restored from the order on edit (e.g. "Cliente pidió
   * factura con Nit X"). Persisted into `orders.internal_notes` by the
   * editor endpoint. Empty string = no notes.
   */
  internalNotes: string;
  appliedDiscounts: CartDiscount[];
  appliedCoupon?: { id: number; code: string; discount_type: string; discount_value: number };
  pendingBookings: PendingBooking[];
  summary: CartSummary;
  createdAt: Date;
  updatedAt: Date;
  // QUI-649 — cuando la reserva retorna booking.order, el POS adopta esa
  // orden como la orden en curso. `linkedOrderId` no-null indica que el
  // carrito es un espejo del servidor; null = carrito local clásico.
  linkedOrderId: number | null;
  linkedOrderNumber: string | null;
  /**
   * Fulfillment snapshot de la orden en edición. Lo escribe
   * `PosCartService.loadFromOrder`; lo consumen el shell (PUT /editor) y
   * `buildEditorRequest`. Undefined = carrito libre (no venimos de una
   * orden), que NO es lo mismo que "orden sin envío" — esa llega con el
   * objeto poblado y sus ids en `null`.
   */
  shippingContext?: ShippingContext;
}

export interface AddToCartRequest {
  product: Product;
  quantity: number;
  notes?: string;
  variant?: PosProductVariant;
  // Weight product fields (camino legado; ver `CartItem.weight`).
  weight?: number;
  weight_unit?: 'kg' | 'g' | 'lb';
  /**
   * QUI-648 — la línea se capturó pesando. `quantity` ya viene convertido a la
   * unidad mínima (2,35 kg de un producto en gramos ⇒ 2350), así que la línea
   * NO necesita `weight`.
   */
  capturedByScale?: boolean;
  /**
   * QUI-648 — presentación pistoleada. El código de barras pertenece a una
   * tarifa `sale_unit` del producto: la línea entra con esa presentación ya
   * aplicada, sin que el cajero la elija.
   */
  scannedPriceTierId?: number | null;
  /**
   * Restaurant Suite — Fase K Gap 1: when true the item is added to
   * the cart with `skipKds=true`, meaning the POS will NOT fire it
   * to the kitchen. The product's own stock is deducted at payment
   * time. The cashier UI surfaces this choice via the
   * `pos-prepared-choice-modal` for `prepared` products that track
   * inventory and have stock > 0.
   */
  skipKds?: boolean;
  /**
   * QUI-653 — la línea se agrega marcada "para llevar". Participa en la
   * identidad de la línea, así que un mismo plato pedido para llevar y para la
   * mesa produce DOS líneas y no una fusionada.
   */
  isTakeaway?: boolean;
  // QUI-431 — Pre-selected serials for serialized products. The POS opens a
  // selector modal before calling addToCart and passes the cashier's choice
  // here. `serial_ids` are pool rows; `serial_numbers` are free-text entries.
  serial_ids?: number[];
  serial_numbers?: string[];
  // CP-POS-SVC-BOOKING-001 — Booking parameters when adding a service line.
  booking?: CartItemBooking;
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
