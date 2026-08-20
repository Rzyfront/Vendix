import {
  IsArray,
  ArrayMinSize,
  IsOptional,
  IsInt,
  Min,
  IsString,
  MaxLength,
  IsIn,
  IsNumber,
  IsBoolean,
  ValidateNested,
  Max,
} from 'class-validator';
import { Type, Transform } from 'class-transformer';
import { order_delivery_type_enum } from '@prisma/client';

/**
 * CP-POS-CREAR-EDITAR-COBRAR-001 — C.1 · UpdateOrderEditorItemDto
 *
 * Subset estricto del editor. El backend rechaza CUALQUIER campo que no esté
 * declarado acá — por construcción, no por validación genérica. La diferencia
 * con `CreateOrderItemDto` es que ESTE DTO no expone:
 *
 *   - state, payment_status, payment_form, credit_type, installment_terms
 *   - requires_payment, is_draft
 *   - table_session_id, table_id
 *   - cash_register_session_id, store_id
 *   - allow_oversell
 *   - skip_kds, inventory_committed_at_fire
 *   - serial_numbers, serial_ids
 *
 * Todas esas columnas pertenecen al flujo canónico `flow/pay` y a la máquina
 * de estados. El editor solo muta lo seguro de forma atómica (ver C.1 del plan
 * para el contrato completo).
 *
 * Por qué un DTO dedicado y no un `OmitType`: el `whitelist` del
 * ValidationPipe filtra los campos no declarados, pero la presencia de un
 * campo prohibido en el body sigue siendo 400 silencioso. Declarar el contrato
 * en código es la única forma de que el editor nunca pueda escribir
 * `orders.state` ni `order_items.skip_kds`, aunque el operador lo envíe.
 */
export class UpdateOrderEditorItemDto {
  @IsOptional()
  @IsString()
  @IsIn(['product', 'custom', 'physical', 'service'])
  item_type?: 'product' | 'custom' | 'physical' | 'service';

  @IsOptional()
  @IsInt()
  @Min(1)
  product_id?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
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

  /**
   * Atributos serializados de la variante. El frontend suele mandar JSON; el
   * backend lo acepta como string y lo persiste tal cual para no introducir
   * una segunda fuente de verdad del shape de la variante.
   */
  @IsOptional()
  @IsString()
  variant_attributes?: string;

  @IsInt()
  @Min(1)
  quantity: number;

  @Transform(({ value }) => parseFloat(value))
  @IsNumber({ maxDecimalPlaces: 2 })
  unit_price: number;

  @Transform(({ value }) => parseFloat(value))
  @IsNumber({ maxDecimalPlaces: 2 })
  total_price: number;

  @IsOptional()
  @Transform(({ value }) => parseFloat(value))
  @IsNumber({ maxDecimalPlaces: 2 })
  final_unit_price?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  tax_category_id?: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  price_override_reason?: string;

  /**
   * Tasa del impuesto de la línea como FRACCIÓN: `0.19` es 19%. La columna es
   * `Decimal(6,5)`, así que mandar `19` desbordaba el numérico de Postgres y
   * salía un `500 SYS_INTERNAL_001` en lugar de un 400 accionable.
   */
  @IsOptional()
  @Transform(({ value }) => parseFloat(value))
  @IsNumber({ maxDecimalPlaces: 5 })
  @Min(0)
  @Max(1, {
    message:
      'tax_rate se expresa como fracción: usa 0.19 para 19% (máximo 1 = 100%)',
  })
  tax_rate?: number;

  @IsOptional()
  @Transform(({ value }) => parseFloat(value))
  @IsNumber({ maxDecimalPlaces: 2 })
  tax_amount_item?: number;

  @IsOptional()
  @Transform(({ value }) => parseFloat(value))
  @IsNumber({ maxDecimalPlaces: 2 })
  cost?: number;

  /**
   * Peso de la línea (no del producto base). Backend no usa para costeo ni
   * inventario: queda como snapshot para reportes y ticket.
   */
  @IsOptional()
  @Transform(({ value }) => parseFloat(value))
  @IsNumber({ maxDecimalPlaces: 3 })
  weight?: number;

  @IsOptional()
  @IsString()
  @MaxLength(10)
  weight_unit?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  applied_price_tier_id?: number;

  /**
   * Flag opcional persistido en la línea. El editor NO acepta reescribir el
   * `is_price_overridden` ya guardado: si el operador manda el mismo DTO sin
   * este campo, conservamos el valor previo (ver merge en el servicio).
   */
  @IsOptional()
  @IsBoolean()
  is_price_overridden?: boolean;
}

/**
 * CP-POS-CREAR-EDITAR-COBRAR-001 — C.1 · UpdateOrderEditorDto
 *
 * Contrato del editor de negocio: items, cliente, notas, dirección/método/rate
 * de envío, promoción y cupón. NO acepta: state, payment_status, payment_form,
 * credit_type, installment_terms, inventory_committed_at_fire, skip_kds,
 * serial_numbers, requires_payment, is_draft, table_session_id, table_id,
 * cash_register_session_id, store_id, allow_oversell.
 *
 * El estado y los pagos pasan por `OrderFlowService` (flow/pay) y la máquina
 * canónica existente. El editor sólo muta lo que es seguro mutar de forma
 * atómica; nada más puede escribir `orders.state` (QUI-557).
 *
 * El DTO NO extiende `CreateOrderDto` ni `UpdateOrderDto` a propósito: ambos
 * reexponen `state` y `payment_status` vía `PartialType`, y el `whitelist`
 * del ValidationPipe no puede filtrar un campo que el DTO declara. Construir
 * un DTO dedicado es la única forma de garantizar que esos campos no entren.
 */
export class UpdateOrderEditorDto {
  /**
   * Líneas del pedido. Requerido y no-vacío: el editor reemplaza TODAS las
   * líneas existentes, así que un payload sin líneas sería un borrado por la
   * puerta de atrás.
   */
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => UpdateOrderEditorItemDto)
  items: UpdateOrderEditorItemDto[];

  /**
   * Cliente obligatorio. Se valida pertenencia al store (store_users) ANTES
   * del claim atómico del estado — un customer_id que no pertenezca al store
   * devuelve 403 `ORD_EDIT_CUSTOMER_STORE_MISMATCH_001` y no toca la fila.
   */
  @IsInt()
  @Min(1)
  customer_id: number;

  /**
   * Nota visible para el cliente (max 500 chars, igual que `notes` en
   * CreateOrderDto). Se persiste en `orders.notes`.
   */
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;

  /**
   * Nota interna del operador. Se persiste en `orders.internal_notes`.
   */
  @IsOptional()
  @IsString()
  @MaxLength(500)
  internal_notes?: string;

  /**
   * Tipo de entrega. Restringido al enum canónico de Prisma. El DTO acepta
   * sólo strings literales para evitar `BadRequestException` por enums
   * mal formados.
   */
  @IsOptional()
  @IsIn([
    'pickup',
    'home_delivery',
    'direct_delivery',
    'other',
    'dine_in',
  ] as order_delivery_type_enum[])
  delivery_type?: order_delivery_type_enum;

  /**
   * IDs de dirección de facturación/envío y método/rate de envío. El backend
   * los valida contra el store en la fase de shipping validation y verifica
   * que la dirección pertenezca al `customer_id` enviado — si no, devuelve
   * `ORD_EDIT_INVALID_SHIPPING_001` (no exponer FK de otro cliente).
   */
  @IsOptional()
  @IsInt()
  @Min(1)
  billing_address_id?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  shipping_address_id?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  shipping_method_id?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  shipping_rate_id?: number;

  /**
   * Costo de envío enviado por el cliente. Se contrasta contra el costo
   * calculado por el servidor dentro de tolerancia 0.01; si difiere, el
   * editor rechaza con `ORD_EDIT_INVALID_SHIPPING_001`.
   */
  @IsOptional()
  @Transform(({ value }) => parseFloat(value))
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  shipping_cost?: number;

  /**
   * Promociones manuales que el operador quiere forzar (las auto-apply las
   * resuelve el motor). Vacío = sólo auto-apply; con ids = el motor suma el
   * descuento manual al cálculo.
   */
  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  @Min(1, { each: true })
  promotion_ids?: number[];

  /**
   * Código de cupón opcional. Validación y consumo pertenecen a `flow/pay`;
   * el editor sólo persiste la snapshot pendiente sin incrementar
   * `coupons.current_uses` cuando la orden es draft.
   */
  @IsOptional()
  @IsString()
  @MaxLength(50)
  coupon_code?: string | null;

  /**
   * CP-POS-CREAR-EDITAR-COBRAR-001 — Round 3.5 · idempotency key for the
   * editor endpoint.
   *
   * Callers (mobile POS, web POS, batch jobs) SHOULD pass a stable, unique
   * key per user-initiated edit attempt. If a recent `audit_logs` row with
   * the same `action='order.editor.updated'` and
   * `metadata->>'idempotency_key' = <key>` already exists, the service
   * short-circuits and returns the cached full Order, avoiding duplicate
   * claims / double stock reservations / double coupon counters.
   *
   * The key is opaque to the backend (any string ≤ 64 chars is accepted);
   * uniqueness and stability are the caller's responsibility (typically a
   * UUID v4 generated when the operator taps "Actualizar").
   *
   * Without this key the editor still works, but a double-click or a
   * network retry can produce two consecutive successful PUTs. With the
   * key, the second call hits the audit cache and returns the same order
   * the first call already produced.
   */
  @IsOptional()
  @IsString()
  @MaxLength(64)
  idempotency_key?: string;
}
