import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
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
];

/**
 * Consulta de la lista de ajustes.
 *
 * Antes era una `interface`: con `design:paramtypes` en `Object`, el
 * ValidationPipe global se saltaba entero el objeto (ni whitelist ni
 * transformación), y encima los nombres eran camelCase mientras el frontend
 * manda snake_case — o sea, TODOS los filtros se descartaban en silencio y la
 * lista contestaba 200 con la primera página sin filtrar.
 *
 * Los alias camelCase se conservan como opcionales porque hay clientes viejos
 * (y el flujo de organización) que los mandan así; el servicio resuelve
 * snake_case primero.
 */
export class AdjustmentQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  organization_id?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  product_id?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  variant_id?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  location_id?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  batch_id?: number;

  @IsOptional()
  @IsIn(ADJUSTMENT_TYPES)
  type?: AdjustmentType;

  @IsOptional()
  @IsIn(['pending', 'approved'])
  status?: 'pending' | 'approved';

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  created_by_user_id?: number;

  @IsOptional()
  @IsString()
  start_date?: string;

  @IsOptional()
  @IsString()
  end_date?: string;

  /** Busca por nombre/SKU del producto y por la descripción del ajuste. */
  @IsOptional()
  @IsString()
  @MaxLength(120)
  search?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;

  // ---- Alias camelCase (compatibilidad hacia atrás) ----

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  organizationId?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  productId?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  variantId?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  locationId?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  batchId?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  createdByUserId?: number;

  @IsOptional()
  @IsString()
  startDate?: string;

  @IsOptional()
  @IsString()
  endDate?: string;
}
