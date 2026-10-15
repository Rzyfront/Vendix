import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';
import { AdjustmentType } from '../interfaces/inventory-adjustment.interface';

const ADJUSTMENT_TYPES: AdjustmentType[] = [
  'damage',
  'loss',
  'theft',
  'expiration',
  'count_variance',
  'manual_correction',
  'initial_load',
];

/**
 * Creación de un ajuste de inventario.
 *
 * Antes era una `interface`, así que el `ValidationPipe` global la saltaba
 * ENTERA (`design:paramtypes` queda en `Object`): sin whitelist, sin coerción y
 * sin cotas. `{"quantity_after": -100}` persistía −100 en la fila mientras
 * `stock_levels` se aplastaba a 0, y `"abc"` viajaba como NaN hasta Prisma.
 *
 * `organization_id`, `created_by_user_id` y `approved_by_user_id` NO se aceptan
 * del cliente: los dos primeros se resuelven del contexto de la petición y el
 * aprobador sólo se sella por el endpoint de aprobación.
 */
export class CreateAdjustmentDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  product_id: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  product_variant_id?: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  location_id: number;

  /** Ajuste dirigido a un lote concreto en vez de al saldo de la bodega. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  batch_id?: number;

  @IsIn(ADJUSTMENT_TYPES)
  type: AdjustmentType;

  /**
   * Conteo FINAL, no el delta. El inventario se lleva en enteros de la unidad
   * mínima y no existe saldo negativo, así que `@Min(0)` es el piso real.
   */
  @Type(() => Number)
  @IsInt()
  @Min(0)
  quantity_after: number;

  /**
   * Costo unitario de entrada (sólo relevante para `initial_load` con
   * cantidad positiva). Si falta, se resuelve del costo del producto.
   */
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  unit_cost?: number;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  reason_code?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;
}
