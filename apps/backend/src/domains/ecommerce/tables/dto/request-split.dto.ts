import { IsIn, IsInt, Min } from 'class-validator';
import { Type } from 'class-transformer';

/**
 * QR-por-mesa — GAP-8 (conservative).
 *
 * Payload for the "split the bill" request from the diner storefront.
 * This is a NOTIFICATION ONLY — it never calls `SplitOrderService`. The
 * mesero performs the real split from the staff panel using the existing
 * table-session split controller. We only capture the diner's intent so
 * staff know how many ways to divide and in which mode.
 *
 *   - `n_splits` how many ways to divide (>= 2).
 *   - `mode`     `equal` (even), `custom` (custom amounts), or
 *                `by_items` (per-item assignment).
 */
export class RequestSplitDto {
  @IsInt()
  @Type(() => Number)
  @Min(2)
  n_splits!: number;

  @IsIn(['equal', 'custom', 'by_items'])
  mode!: 'equal' | 'custom' | 'by_items';
}
