import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  Max,
  Min,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';

/**
 * DTO to add a component line (recipe_items row) to a recipe.
 *
 * The component must be a product that exists in the same store as the recipe
 * and that is NOT the recipe's own yield product (self-reference is forbidden).
 * Sub-recipe components (products that themselves have an active recipe in the
 * same store) are allowed as long as they don't form a cycle.
 */
export class CreateRecipeItemDto {
  @IsInt()
  @Type(() => Number)
  component_product_id!: number;

  @IsNumber({ maxDecimalPlaces: 4 })
  @Type(() => Number)
  @Min(0)
  quantity!: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Type(() => Number)
  @Min(0)
  @Max(100)
  waste_percent?: number;

  /**
   * Waste mode for the line. `percent` (default) uses `waste_percent` as a
   * multiplier; `absolute` uses `waste_absolute` in the component's minimum
   * stock unit. The legacy default of `percent` keeps existing flows
   * behaving exactly as before.
   */
  @IsOptional()
  @IsIn(['percent', 'absolute'])
  waste_mode?: 'percent' | 'absolute';

  /**
   * Absolute waste expressed in the component's minimum stock unit
   * (e.g. ml, g, unit). Only honoured when `waste_mode='absolute'`.
   */
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 4 })
  @Type(() => Number)
  @Min(0)
  waste_absolute?: number;

  @IsOptional()
  @IsBoolean()
  @Transform(({ value }) =>
    typeof value === 'string' ? value === 'true' : value,
  )
  is_optional?: boolean;
}
