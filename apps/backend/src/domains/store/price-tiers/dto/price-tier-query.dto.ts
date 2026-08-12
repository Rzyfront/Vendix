import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';

export class PriceTierQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number = 50;

  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsBoolean()
  @Transform(({ value }) =>
    typeof value === 'string' ? value === 'true' : value,
  )
  is_active?: boolean;

  /**
   * Filtra por eje. Los selectores lo usan para no mezclar tarifas de cliente
   * con presentaciones de venta: el selector de tarifa del POS pide
   * `customer_tier` y el editor de presentaciones pide `sale_unit`.
   */
  @IsOptional()
  @IsIn(['customer_tier', 'sale_unit'])
  kind?: 'customer_tier' | 'sale_unit';

  @IsOptional()
  @IsString()
  sort_by?: string = 'sort_order';

  @IsOptional()
  @IsString()
  sort_order?: 'asc' | 'desc' = 'asc';
}
