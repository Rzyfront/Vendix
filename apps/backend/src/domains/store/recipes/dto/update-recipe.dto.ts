import {
  IsBoolean,
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
 * DTO to partially update a recipe.
 *
 * All fields are optional. `product_id` is intentionally NOT updatable: a recipe
 * is bound to its finished product at creation time, the service ignores it, and
 * the whitelist (forbidNonWhitelisted) rejects it with 400 if sent.
 */
export class UpdateRecipeDto {
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 4 })
  @Type(() => Number)
  @Min(0)
  yield_quantity?: number;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  @Matches(/^[\p{L}0-9_\-/().\s]+$/u, {
    message: 'Unidad de rendimiento inválida',
  })
  yield_unit?: string;

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
