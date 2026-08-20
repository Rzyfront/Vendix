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
  ValidateNested,
} from 'class-validator';
import { Type, Transform } from 'class-transformer';
import { CreateOrderItemDto } from './create-order.dto';
import { order_delivery_type_enum } from '@prisma/client';

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
  @Type(() => CreateOrderItemDto)
  items: CreateOrderItemDto[];

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
   * los valida contra el store en la fase de shipping validation.
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
}
