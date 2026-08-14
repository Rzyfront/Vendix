import {
  IsInt,
  IsString,
  IsOptional,
  IsNumber,
  IsArray,
  ArrayMinSize,
  IsBoolean,
  IsIn,
  ValidateNested,
  IsEnum,
  Max,
  Min,
  MaxLength,
  IsDateString,
} from 'class-validator';
import { Type, Transform } from 'class-transformer';
import { order_state_enum, payments_state_enum } from '@prisma/client';

export class CreateOrderItemDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  product_id?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  product_variant_id?: number;

  @IsOptional()
  @IsString()
  @IsIn(['product', 'custom', 'physical', 'service'])
  item_type?: 'product' | 'custom' | 'physical' | 'service';

  @IsString()
  @MaxLength(255)
  product_name: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @IsOptional()
  @IsString()
  variant_sku?: string;

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
  catalog_unit_price?: number;

  @IsOptional()
  @Transform(({ value }) => parseFloat(value))
  @IsNumber({ maxDecimalPlaces: 2 })
  catalog_final_price?: number;

  @IsOptional()
  @Transform(({ value }) => parseFloat(value))
  @IsNumber({ maxDecimalPlaces: 2 })
  final_unit_price?: number;

  @IsOptional()
  @IsBoolean()
  is_price_overridden?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  price_override_reason?: string;

  @IsOptional()
  @Transform(({ value }) => parseFloat(value))
  @IsNumber({ maxDecimalPlaces: 3 })
  weight?: number;

  @IsOptional()
  @IsString()
  @MaxLength(10)
  weight_unit?: string;

  // Bug 12: UoM de venta snapshot. Frontend envía 'kg'/'und'/'L' + factor
  // (ej. 250g por bolsa). Backend persiste en order_items para que el
  // ticket y los reportes históricos no dependan de products.
  @IsOptional()
  @IsString()
  @MaxLength(20)
  sale_unit_code?: string;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 6 })
  @Transform(({ value }) => (value == null ? undefined : parseFloat(value)))
  sale_quantity?: number;

  /**
   * Multi-tarifa: id de la tarifa de precios aplicada a esta línea (opcional).
   * Si está presente y la tarifa no es la default, el caller debe tener
   * el permission `store:products:apply_pricing_tier`.
   */
  @IsOptional()
  @IsInt()
  @Min(1)
  applied_price_tier_id?: number;
}

export class CreateOrderDto {
  /**
   * Optional customer bound to the order. POS counter (consumidor final)
   * and table-less flows may omit it; the resulting order is persisted as
   * anonymous and `orders.customer_id` is `null`. When a valid id is
   * provided, the row is linked to the corresponding `users` row.
   */
  @IsOptional()
  @IsInt()
  @Min(1)
  customer_id?: number;

  /**
   * Optional. If provided, must match the store_id derived from RequestContext.
   * If omitted, the value is taken from the authenticated context.
   * Kept optional for backward compatibility with clients that still send it in the body.
   */
  @IsOptional()
  @IsInt()
  @Min(1)
  store_id?: number;

  @IsOptional()
  @IsString()
  order_number?: string;

  @IsOptional()
  @IsEnum(order_state_enum)
  state?: order_state_enum;

  @IsOptional()
  @IsEnum(payments_state_enum)
  payment_status?: payments_state_enum;

  @Transform(({ value }) => parseFloat(value))
  @IsNumber({ maxDecimalPlaces: 2 })
  subtotal: number;

  @IsOptional()
  @Transform(({ value }) => parseFloat(value))
  @IsNumber({ maxDecimalPlaces: 2 })
  tax_amount?: number;

  @IsOptional()
  @Transform(({ value }) => parseFloat(value))
  @IsNumber({ maxDecimalPlaces: 2 })
  shipping_cost?: number;

  @IsOptional()
  @Transform(({ value }) => parseFloat(value))
  @IsNumber({ maxDecimalPlaces: 2 })
  discount_amount?: number;

  @Transform(({ value }) => parseFloat(value))
  @IsNumber({ maxDecimalPlaces: 2 })
  total_amount: number;

  @IsOptional()
  @IsString()
  currency?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  billing_address_id?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  shipping_address_id?: number;

  @IsOptional()
  @IsString()
  internal_notes?: string;

  /**
   * Staff-only note (optional, max 500 chars).
   * Set at creation only, never exposed to the customer.
   * Not editable after the order is created.
   */
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;

  @IsOptional()
  @IsDateString()
  estimated_delivery_date?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreateOrderItemDto)
  items: CreateOrderItemDto[];

  @IsOptional()
  skip_schedule_validation?: boolean;
}
