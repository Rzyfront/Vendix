import { IsBoolean, IsInt, IsOptional, IsString, Min } from 'class-validator';
import { Transform, Type } from 'class-transformer';

/**
 * Query DTO for the recipe list endpoint.
 *
 * Mirrors the standard pagination/filter shape used across store domains
 * (see e.g. SupplierQueryDto, PriceTierQueryDto).
 */
export class RecipeQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number = 10;

  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsBoolean()
  @Transform(({ value }) =>
    typeof value === 'string' ? value === 'true' : value,
  )
  is_active?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  product_id?: number;
}
