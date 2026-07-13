import {
  IsString,
  IsOptional,
  IsNumber,
  IsBoolean,
  IsInt,
  IsEnum,
  IsArray,
  IsDateString,
  Min,
  MaxLength,
  ValidateIf,
  ArrayNotEmpty,
  ArrayUnique,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import {
  IsValidQuantityTiers,
  QuantityTierDto,
} from './quantity-tier.dto';

export class CreatePromotionDto {
  @IsString()
  @MaxLength(255)
  name: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  code?: string;

  @IsEnum(['percentage', 'fixed_amount'])
  type: 'percentage' | 'fixed_amount';

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Type(() => Number)
  value: number;

  /**
   * Pricing rule shape:
   *   - 'flat' (default): single discount driven by `type` + `value`.
   *   - 'quantity_tiered': volume breaks defined in `quantity_tiers`;
   *     the parent `value` is still required (engine fallback / reporting)
   *     but the actual discount comes from the matched tier.
   *
   * Omitted -> treated as 'flat' for backwards compatibility with existing
   * clients that predate this field.
   */
  @IsOptional()
  @IsEnum(['flat', 'quantity_tiered'])
  rule_type?: 'flat' | 'quantity_tiered';

  @IsOptional()
  @IsEnum(['order', 'product', 'category'])
  scope?: 'order' | 'product' | 'category';

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Type(() => Number)
  min_purchase_amount?: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Type(() => Number)
  max_discount_amount?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  usage_limit?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  per_customer_limit?: number;

  @IsDateString()
  start_date: string;

  @IsOptional()
  @IsDateString()
  end_date?: string;

  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  is_auto_apply?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Type(() => Number)
  priority?: number;

  @ValidateIf((o) => o.scope === 'product')
  @IsArray({ message: 'Debes proporcionar la lista de productos' })
  @ArrayNotEmpty({
    message: 'Selecciona al menos un producto para esta promocion',
  })
  @ArrayUnique({ message: 'No se permiten productos duplicados' })
  @IsInt({ each: true, message: 'Cada producto debe ser un id valido' })
  @Type(() => Number)
  product_ids?: number[];

  @ValidateIf((o) => o.scope === 'category')
  @IsArray({ message: 'Debes proporcionar la lista de categorias' })
  @ArrayNotEmpty({
    message: 'Selecciona al menos una categoria para esta promocion',
  })
  @ArrayUnique({ message: 'No se permiten categorias duplicadas' })
  @IsInt({ each: true, message: 'Cada categoria debe ser un id valido' })
  @Type(() => Number)
  category_ids?: number[];

  /**
   * Volume-break tiers. Required (>= 1 item) when rule_type === 'quantity_tiered';
   * must be empty/absent when rule_type is 'flat' (or omitted).
   *
   * See QuantityTierDto for per-element rules and IsValidQuantityTiers for
   * the cross-field adjacency / contiguity / open-ended-last rules.
   */
  @IsOptional()
  @IsArray({ message: 'quantity_tiers debe ser un arreglo' })
  @ValidateNested({ each: true })
  @Type(() => QuantityTierDto)
  @IsValidQuantityTiers()
  quantity_tiers?: QuantityTierDto[];
}