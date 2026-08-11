import {
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsArray,
  ValidateNested,
  IsIn,
  Min,
  ArrayMinSize,
  ArrayMaxSize,
  IsInt,
} from 'class-validator';
import { Type } from 'class-transformer';

const VALID_ADJUSTMENT_TYPES = [
  'damage',
  'loss',
  'theft',
  'expiration',
  'count_variance',
  'manual_correction',
] as const;

export class AdjustmentItemDto {
  @IsNumber()
  @IsNotEmpty()
  @Type(() => Number)
  product_id: number;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  product_variant_id?: number;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  batch_id?: number;

  @IsString()
  @IsNotEmpty()
  @IsIn(VALID_ADJUSTMENT_TYPES)
  type: string;

  // Entero: el inventario se lleva en `Int` de la unidad mínima, así que un
  // decimal se truncaba silenciosamente al llegar a Prisma.
  @IsInt()
  @Min(0)
  @Type(() => Number)
  quantity_after: number;

  @IsOptional()
  @IsString()
  reason_code?: string;

  @IsOptional()
  @IsString()
  description?: string;
}

export class BatchCreateAdjustmentsDto {
  @IsNumber()
  @IsNotEmpty()
  @Type(() => Number)
  location_id: number;

  // Sin tope, un lote de 5.000 líneas abría 5.000 transacciones seguidas y
  // dejaba el pool en el suelo. El mismo límite que el resto de las operaciones
  // masivas del repo (@ArrayMaxSize(100)); para archivos grandes existe la carga
  // por Excel, que sí procesa por partes.
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => AdjustmentItemDto)
  items: AdjustmentItemDto[];
}
