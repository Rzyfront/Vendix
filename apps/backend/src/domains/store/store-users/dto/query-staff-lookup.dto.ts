import { IsOptional, IsString, IsInt, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';

/**
 * Query for `GET /store/users/staff-lookup` (B9).
 *
 * Lightweight, name-only staff search used by `app-store-user-select` in
 * staff-lookup contexts (e.g. the POS payment-collector waiter-tip picker).
 * Deliberately separate from `QueryStoreUsersDto`: that endpoint requires
 * `store:users:read` ("solo owner/admin" per the permission seed), which
 * cashier/waiter roles do not have. This endpoint is gated by
 * `store:pos:access` instead — already granted to both roles — and never
 * returns email/phone/roles, only what the picker renders.
 */
export class QueryStaffLookupDto {
  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(20)
  limit?: number;
}
