import { IsOptional, IsNumber, IsString } from 'class-validator';
import { Type } from 'class-transformer';

/**
 * Org-level subscription/invoice query DTO. Mirrors the store-side
 * `SubscriptionQueryDto` but adds `store_id` so the ORG_ADMIN can request a
 * breakdown by store while the default behavior remains consolidated across
 * every store of the organization.
 */
export class OrgSubscriptionQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  limit?: number = 20;

  @IsOptional()
  @IsString()
  sort_by?: string = 'created_at';

  @IsOptional()
  @IsString()
  sort_order?: 'asc' | 'desc' = 'desc';

  /**
   * Optional breakdown filter — when provided, only invoices/subscriptions
   * for the given store are returned. The store MUST belong to the
   * organization in context (validated by `OrganizationPrismaService`).
   */
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  store_id?: number;
}
