import { IsOptional, IsString, IsInt, Min, Max, Matches } from 'class-validator';
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

  /**
   * Comma-separated `users.id` list (max 50) to resolve staff names by id, so
   * a preset selection renders the person's name instead of `Usuario #id`.
   * Still staff-only (non-customer role) but not limited to active users.
   */
  @IsOptional()
  @Matches(/^\d+(,\d+){0,49}$/, { message: 'ids debe ser una lista de ids separados por coma (máx. 50)' })
  ids?: string;
}
