import {
  IsNotEmpty,
  IsOptional,
  IsArray,
  ValidateNested,
  ArrayMinSize,
  IsInt,
  Min,
  IsIn,
} from 'class-validator';
import { Type } from 'class-transformer';

/**
 * Línea de una devolución.
 *
 * `return_order_items` tiene exactamente cinco columnas escribibles:
 * `return_order_id`, `product_id`, `product_variant_id`, `quantity` y
 * `condition`. Este DTO declaraba `quantity_returned`, `return_reason`,
 * `condition_on_return`, `refund_amount`, `restock`, `notes` y
 * `order_item_id` — ninguna existe. La creación jamás llegó a insertar una
 * línea: el `create` del padre ni siquiera enviaba la relación.
 */
export class CreateReturnOrderItemDto {
  @IsInt()
  @IsNotEmpty()
  product_id: number;

  @IsOptional()
  @IsInt()
  product_variant_id?: number;

  @IsInt()
  @Min(1)
  quantity: number;

  /** `item_condition_enum`. Por defecto `good`. */
  @IsOptional()
  @IsIn(['good', 'damaged'])
  condition?: 'good' | 'damaged';
}

/**
 * Creación de una devolución.
 *
 * El DTO anterior describía una tabla que no existe: pedía `customer_id`
 * obligatorio, un `reason` de seis valores de texto, `total_refund_amount`,
 * `return_date`, `notes`, `internal_notes` y `refund_method`. Ninguna de esas
 * claves es columna de `return_orders`, y `type` prometía
 * `refund|replacement|credit` donde `return_order_type_enum` sólo acepta
 * `purchase_return|sales_return`. Con `forbidNonWhitelisted:true` el cuerpo
 * pasaba la validación —el DTO las declaraba— y reventaba después contra
 * Prisma como «Error interno del servidor».
 *
 * Ahora cada campo corresponde a una columna real. `organization_id` no se
 * declara aquí a propósito: lo resuelve el servidor desde el contexto de la
 * petición, porque el cliente no debe poder elegir de qué organización cuelga
 * la devolución.
 */
export class CreateReturnOrderDto {
  /** `return_order_type_enum`. Obligatorio: la columna no tiene default. */
  @IsIn(['purchase_return', 'sales_return'])
  @IsNotEmpty()
  type: 'purchase_return' | 'sales_return';

  /**
   * Referencia suelta —sin FK— a `orders.id` (venta) o a la orden de compra,
   * según `related_order_type`.
   */
  @IsOptional()
  @IsInt()
  related_order_id?: number;

  @IsOptional()
  @IsIn(['purchase_order', 'sales_order'])
  related_order_type?: 'purchase_order' | 'sales_order';

  @IsOptional()
  @IsInt()
  related_dispatch_id?: number;

  /** Cliente o proveedor, según `partner_type`. */
  @IsOptional()
  @IsInt()
  partner_id?: number;

  @IsOptional()
  @IsIn(['customer', 'supplier'])
  partner_type?: 'customer' | 'supplier';

  /**
   * `return_orders.reason_id` es un `Int?` sin FK ni tabla de motivos en el
   * esquema. Se acepta tal cual, sin inventar un catálogo que no existe.
   */
  @IsOptional()
  @IsInt()
  reason_id?: number;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreateReturnOrderItemDto)
  items: CreateReturnOrderItemDto[];
}
