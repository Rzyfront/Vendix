import {
  IsNumber,
  IsString,
  IsOptional,
  IsBoolean,
  IsArray,
  ArrayMinSize,
  IsDateString,
  IsEnum,
  IsIn,
  Min,
  Max,
  MaxLength,
  ValidateNested,
  IsInt,
  Matches,
} from 'class-validator';
import { Type } from 'class-transformer';

export class PosOrderItemDto {
  @IsOptional()
  @IsString()
  @IsIn(['product', 'custom'])
  item_type?: 'product' | 'custom';

  @IsOptional()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  product_id?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  category_id?: number;

  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  @Type(() => Number)
  category_ids?: number[];

  @IsOptional()
  @IsInt()
  @Type(() => Number)
  product_variant_id?: number;

  @IsString()
  @MaxLength(255)
  product_name: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  product_sku?: string;

  @IsOptional()
  @IsString()
  variant_sku?: string;

  @IsOptional()
  variant_attributes?: Record<string, any>;

  @IsInt()
  @Min(1)
  @Type(() => Number)
  quantity: number;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Type(() => Number)
  unit_price: number;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Type(() => Number)
  total_price: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Type(() => Number)
  final_unit_price?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  tax_category_id?: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  price_override_reason?: string;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 5 })
  @Min(0)
  @Type(() => Number)
  tax_rate?: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Type(() => Number)
  tax_amount_item?: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Type(() => Number)
  cost?: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  @Type(() => Number)
  weight?: number;

  @IsOptional()
  @IsString()
  @MaxLength(10)
  weight_unit?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;

  // Multi-tarifa (Fase 5.5): id de la tarifa aplicada a esta línea. Si está
  // presente, el backend valida server-side el permission
  // `store:products:apply_pricing_tier` (super_admin / owner bypass) y
  // persiste el snapshot (id + name + stock_units_consumed) en order_items.
  @IsOptional()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  applied_price_tier_id?: number;

  // Plan KDS fire-flows: marca de la intención del cajero en el POS
  // ("usar stock" en el modal de prepared-choice). Si true, el item NO
  // se enviará a cocina y su stock se descontará en el pago (sales
  // movement). Solo aplica a líneas `product_type='prepared'`; para
  // cualquier otro tipo el campo se ignora silenciosamente. Persistido
  // en `order_items.skip_kds` para que el backend lo recuerde hasta
  // el momento del pago.
  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  skip_kds?: boolean;

  // QUI-431 — Seriales seleccionados por el cajero para esta línea.
  // Solo aplica a productos serializados (`requires_serial_numbers=true`);
  // para el resto se ignora silenciosamente (compatibilidad total).
  //
  // `serial_ids`: ids de filas existentes en `inventory_serial_numbers`
  // (selección desde el modal POS). El backend valida que sean del producto
  // y estén `in_stock`/`reserved` (SERIAL_REQUIRED_001) antes de marcarlos
  // `sold` y vincularlos al `order_item`.
  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  @Type(() => Number)
  serial_ids?: number[];

  // `serial_numbers`: seriales como texto libre. El backend los resuelve o
  // crea como filas reales del pool (`resolveOrCreateFromFreeText`) y luego
  // los trata igual que `serial_ids`. Mantiene la paridad pool↔stock.
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  serial_numbers?: string[];
}

export class PosInstallmentTermsDto {
  @IsInt()
  @Min(1)
  @Max(60)
  num_installments: number;

  @IsString()
  @IsEnum(['weekly', 'biweekly', 'monthly'])
  frequency: string;

  @IsDateString()
  first_installment_date: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  interest_rate?: number;

  @IsOptional()
  @IsString()
  @IsIn(['simple', 'compound'])
  interest_type?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  initial_payment?: number;

  @IsOptional()
  @IsInt()
  initial_payment_method_id?: number;
}

export class CreatePosPaymentDto {
  // Datos del cliente (opcionales para ventas anónimas)
  @IsOptional()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  customer_id?: number;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  customer_name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  customer_email?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  @Matches(/^[\d+#*\s()-]*$/, {
    message:
      'El teléfono solo puede contener números y los símbolos + # * ( ) -',
  })
  customer_phone?: string;

  // Datos de la venta
  /**
   * Optional. If provided, must match the store_id derived from RequestContext.
   * If omitted, the value is taken from the authenticated context.
   * Kept optional for backward compatibility with clients that still send it in the body.
   */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  store_id?: number;

  /**
   * ID de la sesión de caja abierta bajo la cual se procesa esta venta POS.
   * Si se proporciona, `StockLevelManager.resolveSaleLocation` usa la location
   * de la caja para descontar stock. Si se omite, se usa `store.default_location_id`.
   * Controlado por el setting `pos.cash_register.require_session_for_sales`.
   */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  cash_register_session_id?: number;

  /**
   * Order items. Required for normal sales. When `table_session_id` is
   * provided the cashier is closing out an open table, so the items are
   * already on the draft order; in that case the body may omit them
   * (the backend re-derives totals from the table's existing order).
   * Either way, items sent are appended to the table's order so a
   * "final adjustments before pay" use case still works.
   */
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PosOrderItemDto)
  items?: PosOrderItemDto[];

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Type(() => Number)
  subtotal: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Type(() => Number)
  tax_amount?: number = 0;

  /**
   * @deprecated for final-total purposes. Backend ignores this value when
   * computing `orders.discount_amount` and `orders.grand_total` — those are
   * recalculated server-side from `promotion_ids` (manual promotions) +
   * auto-applied promotions resolved by `PromotionEngineService.quoteDiscounts`
   * and the coupon (resolved via `CouponsService.validate` using `coupon_code`).
   *
   * Frontend may still send this field as a local estimate for UX purposes,
   * but the backend will overwrite the final values with its own
   * recalculation. See `PaymentsService.calculatePosPromotionQuote` and
   * `calculatePosCouponDiscount`.
   */
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Type(() => Number)
  discount_amount?: number = 0;

  /**
   * IDs of manual promotions (non auto-applied) the cashier selected.
   * Backend uses these together with auto-applied promotions in
   * `PromotionEngineService.quoteDiscounts` to recalculate the final
   * promotional discount. The frontend MUST send IDs only — never a
   * precomputed `discount_amount` for these promotions.
   */
  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  @Type(() => Number)
  promotion_ids?: number[];

  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  @Type(() => Number)
  booking_ids?: number[];

  /**
   * @deprecated for resolution. Backend resolves the coupon via
   * `coupon_code` against `CouponsService.validate`. Any `coupon_id` sent
   * by the client is ignored; the resolved server-side id is what gets
   * persisted on `orders.coupon_id` and `coupon_uses.coupon_id`.
   */
  @IsOptional()
  @IsInt()
  @Type(() => Number)
  coupon_id?: number;

  /**
   * Coupon code applied by the cashier. Backend recalculates the coupon
   * discount via `CouponsService.validate` using this code; any
   * frontend-sent `discount_amount` is ignored. If the code is missing,
   * invalid, or fails business rules, the sale proceeds with zero coupon
   * discount.
   */
  @IsOptional()
  @IsString()
  @MaxLength(50)
  coupon_code?: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Type(() => Number)
  total_amount: number;

  @IsOptional()
  @IsString()
  @MaxLength(3)
  currency?: string;

  // Datos del pago (opcionales para ventas a crédito)
  @IsOptional()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  store_payment_method_id?: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Type(() => Number)
  amount_received?: number;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  payment_reference?: string;

  // Control de flujo de pago
  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  requires_payment?: boolean = true;

  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  is_draft?: boolean = false;

  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  is_partial_payment?: boolean = false;

  // Términos de crédito (plan de cuotas para ventas a crédito)
  @IsOptional()
  @ValidateNested()
  @Type(() => PosInstallmentTermsDto)
  installment_terms?: PosInstallmentTermsDto;

  // Direcciones (opcionales)
  @IsOptional()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  billing_address_id?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  shipping_address_id?: number;

  // Datos de envío (para órdenes con delivery)
  @IsOptional()
  @IsString()
  @MaxLength(50)
  delivery_type?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  shipping_method_id?: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Type(() => Number)
  shipping_cost?: number;

  /**
   * GAP-6 (QR mesa dine-in) — Propina opcional. Aditiva al grand_total igual
   * que shipping_cost, PERO sin IVA: NO entra a subtotal_amount ni tax_amount.
   * Se contabiliza como pasivo custodio (propinas por pagar), no como ingreso.
   */
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Type(() => Number)
  tip_amount?: number;

  @IsOptional()
  shipping_address_snapshot?: Record<string, any>;

  // Metadatos POS
  @IsOptional()
  @IsString()
  @MaxLength(100)
  register_id?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  seller_user_id?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  internal_notes?: string;

  /**
   * Staff-only note (optional, max 500 chars).
   * Set at creation only, never exposed to the customer.
   */
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;

  @IsOptional()
  metadata?: Record<string, any>;

  // Opciones de procesamiento
  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  update_inventory?: boolean = true;

  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  allow_oversell?: boolean = false;

  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  send_email_confirmation?: boolean = false;

  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  print_receipt?: boolean = false;

  @IsOptional()
  @IsString()
  @IsIn(['free', 'installments'])
  credit_type?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2)
  payment_form?: string; // '1' = contado, '2' = crédito (DIAN)

  // Digital payment gateway fields
  @IsOptional()
  wompi_payment_method?: any;

  @IsOptional()
  @IsNumber()
  wallet_id?: number;

  @IsOptional()
  @IsString()
  return_url?: string;

  /**
   * Optional table session id. When provided, the POS payment must be
   * applied to the existing draft order of the table (table_sessions
   * binds the order via `order_id`). This is the bridge between
   * `pos-payment-interface` (which can open/select a table inline
   * before charging) and the table-backed "cuenta abierta" flow:
   * without it, the cashier would end up with a brand-new order for
   * the same table. Validated against the current store context.
   */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  table_session_id?: number;
}

// DTO para actualizar una orden existente con pago
export class UpdateOrderWithPaymentDto {
  @IsInt()
  @Min(1)
  @Type(() => Number)
  order_id: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  store_payment_method_id?: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Type(() => Number)
  amount_received?: number;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  payment_reference?: string;

  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  requires_payment?: boolean = true;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  internal_notes?: string;

  /**
   * Staff-only note (optional, max 500 chars).
   * Set at creation only, never exposed to the customer.
   */
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}

// DTO de respuesta para procesamiento POS
export class PosPaymentResponseDto {
  success: boolean;
  message: string;
  order?: {
    id: number;
    order_number: string;
    status: string;
    payment_status: string;
    total_amount: number;
  };
  payment?: {
    id: number;
    amount: number;
    payment_method: string;
    status: string;
    transaction_id?: string;
    change?: number;
    nextAction?: {
      type: 'redirect' | '3ds' | 'await' | 'none';
      url?: string;
      data?: any;
    };
  };
  nextAction?: {
    type: 'redirect' | '3ds' | 'await' | 'none';
    url?: string;
    data?: any;
  };
  errors?: string[];
  warnings?: string[];
  // Flag to indicate the response came from a draft save (no payment flow).
  _isDraft?: boolean;
}
