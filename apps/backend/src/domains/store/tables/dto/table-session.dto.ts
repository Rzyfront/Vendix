import {
  ArrayMinSize,
  IsArray,
  IsInt,
  IsOptional,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

/**
 * DTO to open a new table session.
 *
 * Restaurant Suite — Fase E. The server creates a draft order via the
 * existing `OrdersService.create` (state='draft') and links it to a new
 * `table_sessions` row. The `opened_by` is taken from the request context.
 */
export class OpenTableSessionDto {
  @IsInt()
  @Type(() => Number)
  @Min(1)
  table_id!: number;

  @IsOptional()
  @IsInt()
  @Type(() => Number)
  @Min(1)
  guest_count?: number;

  /**
   * Optional customer to bind to the draft order. The retail OrderFlow
   * can hold a draft order for an anonymous table; in that case omit it.
   * If you do not pass it, server falls back to a configurable default
   * customer or to the user who opened the session.
   */
  @IsOptional()
  @IsInt()
  @Type(() => Number)
  @Min(1)
  customer_id?: number;
}

/**
 * DTO for a single line to add to a draft order. The shape is a strict
 * subset of `CreateOrderItemDto` to keep the open-table flow simple.
 */
export class TableSessionAddItemDto {
  @IsInt()
  @Type(() => Number)
  @Min(1)
  product_id!: number;

  @IsOptional()
  @IsInt()
  @Type(() => Number)
  @Min(1)
  product_variant_id?: number;

  @IsInt()
  @Type(() => Number)
  @Min(1)
  quantity!: number;

  @IsOptional()
  @IsInt()
  @Type(() => Number)
  @Min(1)
  price_tier_id?: number;
}

/**
 * DTO to add a batch of items to an existing open table session.
 *
 * The server appends the items to the draft order and updates the
 * `subtotal_amount`/`grand_total` accordingly. Stock reservation is
 * intentionally NOT performed here for `prepared` items — the consume
 * happens at fire-to-kitchen (Fase D).
 */
export class AddItemsToTableSessionDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => TableSessionAddItemDto)
  items!: TableSessionAddItemDto[];
}
