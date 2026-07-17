import {
  IsBoolean,
  IsIn,
  IsNumber,
  IsOptional,
  Max,
  Min,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';

/**
 * DTO to partially update a recipe_items row.
 *
 * `component_product_id` is intentionally NOT editable here. If the operator
 * needs to swap a component, they should remove the line and add a new one.
 */
export class UpdateRecipeItemDto {
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 4 })
  @Type(() => Number)
  @Min(0.0001, { message: 'La cantidad del sub-componente debe ser mayor a 0' })
  quantity?: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Type(() => Number)
  @Min(0)
  @Max(100)
  waste_percent?: number;

  @IsOptional()
  @IsIn(['percent', 'absolute'])
  waste_mode?: 'percent' | 'absolute';

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
