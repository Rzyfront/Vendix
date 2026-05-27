import { IsInt, IsNumber, IsOptional, Min } from 'class-validator';
import { Type } from 'class-transformer';

/**
 * DTO for upserting a product (or variant) override price for a specific
 * price tier. When `variant_id` is omitted the override applies to the base
 * product; otherwise it applies to that specific variant.
 */
export class UpsertProductPriceTierOverrideDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  variant_id?: number;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  override_price!: number;
}
