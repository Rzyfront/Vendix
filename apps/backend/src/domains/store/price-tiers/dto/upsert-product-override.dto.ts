import { IsInt, IsNumber, IsOptional, Min } from 'class-validator';
import { Type } from 'class-transformer';

/**
 * DTO for upserting a product (or variant) override for a specific price tier.
 * When `variant_id` is omitted the override applies to the base product;
 * otherwise it applies to that specific variant.
 *
 * An override row may carry a price-only, a quantity-only, or both:
 * - `override_price` is the price of the WHOLE PACKAGE (wins over the tier rule).
 * - `override_units_per_package` overrides the tier packaging quantity.
 * Both are optional, so an empty override is meaningless but harmless.
 */
export class UpsertProductPriceTierOverrideDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  variant_id?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  override_price?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(2)
  override_units_per_package?: number;
}
