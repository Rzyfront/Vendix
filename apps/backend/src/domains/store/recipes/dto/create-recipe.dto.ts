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
 * A recipe is the bill-of-materials for ONE product (the "yield" product). It
 * lists the component products (raw ingredients, sub-preps, stock items) needed
 * to produce the yield, optionally with a per-line waste percent and a
 * recipe-level waste percent and yield.
 *
 * The yield product_id is unique per store, so two recipes for the same
 * product in the same store are not allowed.
 */
export class CreateRecipeDto {
  @IsInt()
  @Type(() => Number)
  product_id!: number;

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
