import { IsInt, IsOptional, Min } from 'class-validator';
import { Type } from 'class-transformer';

/**
 * Query parameters for the sourcing-suggestion endpoint.
 *
 * Drives the "where do I get this stock from?" decision used by POS and
 * inventory flows. Returns the main location's availability plus a list of
 * other locations that hold the SKU so the UI can suggest one of:
 *   - `available`: main location has enough stock
 *   - `transfer`:  main is short, but other locations cover the gap
 *   - `purchase`:  neither main nor other locations can cover the request
 */
export class SourcingSuggestionQueryDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  product_id!: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  product_variant_id?: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  quantity: number = 1;
}
