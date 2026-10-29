import {
  IsArray,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { OmitType, PartialType } from '@nestjs/swagger';
import { CreateRecipeDto, RecipeItemInputDto } from '../../recipes/dto';

export const FORMULA_STATUSES = ['draft', 'active', 'archived'] as const;
export type FormulaStatus = (typeof FORMULA_STATUSES)[number];

/**
 * Fórmula = receta + `code`, `version`, `status`. `is_active` se deriva de
 * `status` (solo `active` es utilizable), por eso no se acepta en el body.
 */
export class CreateFormulaDto extends OmitType(CreateRecipeDto, [
  'is_active',
] as const) {
  @IsOptional()
  @IsString()
  @MaxLength(50)
  code?: string;

  @IsOptional()
  @IsInt()
  @Type(() => Number)
  @Min(1)
  version?: number;

  @IsOptional()
  @IsIn(FORMULA_STATUSES as unknown as string[])
  status?: FormulaStatus;

  /** Componentes opcionales: se aplican con `RecipesService.replaceItems`. */
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RecipeItemInputDto)
  items?: RecipeItemInputDto[];
}

export class UpdateFormulaDto extends PartialType(
  OmitType(CreateFormulaDto, ['product_id', 'product_variant_id'] as const),
) {}

export class ReplaceFormulaItemsDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RecipeItemInputDto)
  items!: RecipeItemInputDto[];
}

export class FormulaQueryDto {
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
  @MaxLength(255)
  search?: string;

  @IsOptional()
  @IsIn(FORMULA_STATUSES as unknown as string[])
  status?: FormulaStatus;
}

export class FormulaExplosionQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0.0001)
  quantity?: number = 1;
}
