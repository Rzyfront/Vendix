import {
  IsBoolean,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';

/**
 * DTO to create a store-scoped price tier (multi-tarifa).
 *
 * - `discount_percentage` is the percent (0-100) applied over base_price when
 *   the product does not have an explicit `product_price_tier_overrides` row.
 * - `units_per_package` is the packaging quantity owned by the tier (e.g. 6
 *   for "Caja x6"). Optional; minimum 2 when present. The service derives
 *   `is_package_unit = (units_per_package ?? 0) >= 2` so the flag stays
 *   consistent. A product can override this quantity per tier via
 *   `product_price_tier_overrides.override_units_per_package`.
 */
export class CreatePriceTierDto {
  @IsString()
  @MaxLength(255)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  code?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  discount_percentage?: number;

  @IsOptional()
  @IsBoolean()
  @Transform(({ value }) =>
    typeof value === 'string' ? value === 'true' : value,
  )
  is_active?: boolean;

  @IsOptional()
  @IsBoolean()
  @Transform(({ value }) =>
    typeof value === 'string' ? value === 'true' : value,
  )
  is_default?: boolean;

  @IsOptional()
  @IsBoolean()
  @Transform(({ value }) =>
    typeof value === 'string' ? value === 'true' : value,
  )
  is_package_unit?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(2)
  units_per_package?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  sort_order?: number;
}
