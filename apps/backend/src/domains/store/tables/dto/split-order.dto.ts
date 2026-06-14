import {
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

/**
 * DTO for split-by-items.
 *
 * `itemGroups` is a list of arrays, one per split (sub-order). Each
 * inner array contains the `order_item_id`s that should land in the
 * corresponding sub-order. Rules (enforced in service):
 *  - All ids MUST belong to the source order.
 *  - The union of all groups MUST cover every non-zero-qty order_item
 *    of the source order exactly once (no overlaps, no omissions).
 */
export class SplitByItemsDto {
  @IsArray()
  @ArrayMinSize(2)
  @ValidateNested({ each: true })
  @Type(() => SplitItemGroupDto)
  item_groups!: SplitItemGroupDto[];
}

export class SplitItemGroupDto {
  @IsArray()
  @ArrayMinSize(1)
  @IsInt({ each: true })
  @Type(() => Number)
  order_item_ids!: number[];
}

export const SPLIT_MODES = ['equal', 'custom'] as const;
export type SplitMode = (typeof SPLIT_MODES)[number];

/**
 * DTO for split-by-amount.
 *
 * For 'equal' mode, server distributes the order total into `n_splits`
 * equal parts (rounded to 2 decimals; last part absorbs the rounding
 * diff so totals match exactly).
 *
 * For 'custom' mode, caller passes `amounts` (one per split, all > 0,
 * and their sum must equal the order's grand_total).
 */
export class SplitByAmountDto {
  @IsOptional()
  @IsEnum(SPLIT_MODES)
  mode?: SplitMode = 'equal';

  @IsInt()
  @Type(() => Number)
  @Min(2)
  n_splits!: number;

  /**
   * Required for 'custom' mode. The list of amounts (one per sub-order)
   * whose sum must equal the order's grand_total.
   */
  @IsOptional()
  @IsArray()
  @ArrayMinSize(2)
  @IsNumber({ maxDecimalPlaces: 2 }, { each: true })
  @Type(() => Number)
  amounts?: number[];
}
