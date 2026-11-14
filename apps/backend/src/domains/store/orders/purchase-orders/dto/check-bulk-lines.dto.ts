import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';

/** Tope por petición: el cliente valida el archivo en lotes de 100. */
export const MAX_BULK_CHECK_LINES = 100;

export class CheckBulkPurchaseLineDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  sku?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  barcode?: string;
}

/**
 * `POST store/orders/purchase-orders/bulk/check-lines` (QUI-1004) — dice, sin
 * escribir nada, a qué producto EXISTENTE de la tienda corresponde cada fila
 * de la carga masiva de compras. Una fila sin coincidencia vuelve con
 * `will_create: true`: al crear la OC se crea el producto. Solo la fila sin
 * SKU ni código de barras vuelve con error.
 */
export class CheckBulkPurchaseLinesDto {
  @ApiProperty({ type: [CheckBulkPurchaseLineDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_BULK_CHECK_LINES)
  @ValidateNested({ each: true })
  @Type(() => CheckBulkPurchaseLineDto)
  items: CheckBulkPurchaseLineDto[];
}

export interface CheckBulkLineResult {
  index: number;
  product_id: number | null;
  product_variant_id: number | null;
  product_name: string | null;
  sku: string | null;
  /** Ningún producto de la tienda tiene ese código: se creará con la OC. */
  will_create: boolean;
  error?: { code: string; message: string };
}
