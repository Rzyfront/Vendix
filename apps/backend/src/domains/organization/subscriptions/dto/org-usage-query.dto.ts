import { IsNumber } from 'class-validator';
import { Type } from 'class-transformer';

/**
 * Required `store_id` query for the org-level usage tracker. ORG_ADMIN must
 * choose which store of the organization to inspect; the controller validates
 * the store belongs to the org in context via
 * `OrgSubscriptionsService.assertStoreInOrg`.
 */
export class OrgUsageQueryDto {
  @Type(() => Number)
  @IsNumber()
  store_id!: number;
}
