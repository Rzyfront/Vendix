import {
  IsInt,
  IsOptional,
  IsArray,
  ValidateNested,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Documentación compartida del `price_tier_id` público (QUI-648, fase 3).
 *
 * Es una ELECCIÓN del comprador, no un dato de confianza: el servicio la
 * autoriza contra `product_price_tier_assignments` filtrando por tienda, por
 * `kind='sale_unit'` y por el flag `ecommerce.catalog.enable_sale_unit_selector`
 * antes de dejarla fijar un precio (`public-sale-unit.util.ts`).
 */
const PRICE_TIER_ID_DOC = {
  description:
    'Presentación de venta elegida por el comprador (`price_tiers.id` con ' +
    '`kind = sale_unit`). Omitirlo compra en la presentación por defecto del ' +
    'producto, que es el comportamiento histórico. Requiere que la tienda ' +
    'tenga activo `ecommerce.catalog.enable_sale_unit_selector`.',
  example: 72,
} as const;

export class AddToCartDto {
  @IsInt()
  @Min(1)
  product_id: number;

  @IsOptional()
  @IsInt()
  product_variant_id?: number;

  @IsInt()
  @Min(1)
  quantity: number;

  @ApiPropertyOptional(PRICE_TIER_ID_DOC)
  @IsOptional()
  @IsInt()
  @Min(1)
  price_tier_id?: number;
}

/**
 * Actualiza SOLO la cantidad.
 *
 * NO lleva `price_tier_id` a propósito: cambiar de presentación es *quitar y
 * agregar*, no un update. Si este DTO pudiera mover la tarifa, el servicio
 * tendría que resolver la colisión con la línea que ya exista en la
 * presentación destino — justo lo que el índice único
 * `(cart_id, product_id, product_variant_id, applied_price_tier_id)` acaba de
 * prohibir, y el fallo saldría como un P2002 crudo en la cara del comprador.
 */
export class UpdateCartItemDto {
  @IsInt()
  @Min(0)
  quantity: number;
}

export class SyncCartItemDto {
  @IsInt()
  @Min(1)
  product_id: number;

  @IsOptional()
  @IsInt()
  product_variant_id?: number;

  @IsInt()
  @Min(1)
  quantity: number;

  @ApiPropertyOptional(PRICE_TIER_ID_DOC)
  @IsOptional()
  @IsInt()
  @Min(1)
  price_tier_id?: number;
}

export class SyncCartDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SyncCartItemDto)
  items: SyncCartItemDto[];
}

export class CartSummaryItemDto {
  @IsInt()
  @Min(1)
  product_id: number;

  @IsOptional()
  @IsInt()
  product_variant_id?: number | null;

  @IsInt()
  @Min(1)
  quantity: number;

  @ApiPropertyOptional(PRICE_TIER_ID_DOC)
  @IsOptional()
  @IsInt()
  @Min(1)
  price_tier_id?: number;
}

export class CartSummaryDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CartSummaryItemDto)
  items: CartSummaryItemDto[];
}
