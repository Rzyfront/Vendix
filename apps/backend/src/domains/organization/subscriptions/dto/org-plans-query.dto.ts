import { IsOptional, IsNumber } from 'class-validator';
import { Type } from 'class-transformer';

/**
 * Optional `storeId` query for the org-level plan list. When present, the
 * `is_current` flag in each plan is computed against that store's
 * subscription. Without it, every plan's `is_current=false`.
 *
 * The store_id MUST belong to the organization in context.
 */
export class OrgPlansQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  store_id?: number;
}
