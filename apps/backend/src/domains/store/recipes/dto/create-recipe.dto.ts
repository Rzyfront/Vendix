import {
  IsBoolean,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';

/**
 * DTO to create a store-scoped recipe (BOM).
 *
 * A recipe is the bill-of-materials for ONE (product, variant) pair (the
 * "yield"). It lists the component products (raw ingredients, sub-preps,
 * stock items) needed to produce the yield, optionally with a per-line waste
 * percent and a recipe-level waste percent and yield.
 *
 * Uniqueness is per pair — one base recipe per product
 * (`product_variant_id` NULL) plus one recipe per variant — enforced by the
 * two partial indexes; the service surfaces `RECIPE_DUP_PRODUCT` instead of
 * a raw P2002. The variant rule itself lives in `RecipesService.create`:
 * a variantized product REQUIRES `product_variant_id`, a simple product
 * FORBIDS it.
 */
export class CreateRecipeDto {
  @IsInt()
  @Type(() => Number)
  product_id!: number;

  @IsOptional()
  @IsInt()
  @Type(() => Number)
  @Min(1)
  product_variant_id?: number;

  @IsNumber({ maxDecimalPlaces: 4 })
  @Type(() => Number)
  @Min(0)
  yield_quantity!: number;

  @IsString()
  @MaxLength(20)
  @Matches(/^[\p{L}0-9_\-/().\s]+$/u, {
    message: 'Unidad de rendimiento inválida',
  })
  yield_unit!: string;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Type(() => Number)
  @Min(0)
  @Max(100)
  waste_percent?: number;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  preparation_notes?: string;

  @IsOptional()
  @IsBoolean()
  @Transform(({ value }) =>
    typeof value === 'string' ? value === 'true' : value,
  )
  is_active?: boolean;
}
