import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsNumber,
  IsOptional,
  ValidateNested,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { ApiProperty, PartialType } from '@nestjs/swagger';
import {
  PURCHASE_ORDER_ITEMS_MAX,
  PurchaseOrderItemDto,
  toOptionalBoolean,
} from './create-purchase-order.dto';

/**
 * Una línea a resolver: los MISMOS campos que `create` acepta para una línea
 * nueva (`product_id = 0` + sku, barcode, product_name, marca, categorías,
 * precios, impuestos, unidad, insumo...). Todo es opcional a nivel de DTO
 * (`PartialType`) para poder reenviar tal cual el objeto de línea del
 * formulario; el servicio exige `product_name` o un `product_id` ya resuelto.
 */
export class ResolveLineDto extends PartialType(PurchaseOrderItemDto) {}

/**
 * `POST store/orders/purchase-orders/resolve-lines` — resuelve (encuentra o
 * crea) producto, variante, marca y categorías de hasta 100 líneas NUEVAS,
 * FUERA de la transacción de la orden. Idempotente por SKU / código de barras /
 * variante: reenviar el mismo lote no duplica nada.
 *
 * Los campos de cabecera son opcionales y solo afectan a la resolución:
 * `location_id` (de ahí sale la tienda donde nace el producto), `order_type`
 * (un pedido `ingredient` hereda la marca de insumo) y `prices_include_tax`
 * (ancla el costo del producto nuevo al neto, igual que `create`).
 */
export class ResolvePurchaseOrderLinesDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsNumber()
  location_id?: number;

  @ApiProperty({ required: false, enum: ['retail', 'ingredient'] })
  @IsOptional()
  @IsIn(['retail', 'ingredient'])
  order_type?: string;

  @ApiProperty({ required: false })
  @Transform(toOptionalBoolean)
  @IsBoolean()
  @IsOptional()
  prices_include_tax?: boolean;

  @ApiProperty({ type: [ResolveLineDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(PURCHASE_ORDER_ITEMS_MAX)
  @ValidateNested({ each: true })
  @Type(() => ResolveLineDto)
  items: ResolveLineDto[];
}

/** Resultado por fila de `resolve-lines` (HTTP 200 con detalle por fila). */
export interface ResolveLineResult {
  index: number;
  product_id: number | null;
  product_variant_id: number | null;
  created: boolean;
  error?: { code: string; message: string };
}
