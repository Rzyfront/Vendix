import { IsOptional, IsString, IsInt, Min, IsIn, Matches } from 'class-validator';
import { Type } from 'class-transformer';

export class QueryStoreUsersDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number = 10;

  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsString()
  role?: string;

  /**
   * Exclude store users that carry this role (relation `none` filter). Used by
   * staff-only pickers (e.g. the "Meseros asignados" table selector) to hide
   * ecommerce customers, who are also `store_users` rows. Composes with `role`.
   */
  @IsOptional()
  @IsString()
  exclude_role?: string;

  @IsOptional()
  @IsString()
  state?: string;

  @IsOptional()
  @IsString()
  sort_by?: string;

  @IsOptional()
  @IsIn(['asc', 'desc'])
  sort_order?: 'asc' | 'desc' = 'desc';
}

/**
 * Query for `GET /store/users` (the selector lookup). Adds `ids` on top of the
 * shared listing filters; the management listing keeps rejecting it.
 */
export class QueryStoreUsersLookupDto extends QueryStoreUsersDto {
  /**
   * Comma-separated `users.id` list (max 50) to resolve specific users by id,
   * e.g. the name of an already-assigned user in `app-store-user-select`.
   * Bypasses the default active-only filter so a deactivated assignee still
   * shows by name; ignores `page`.
   */
  @IsOptional()
  @Matches(/^[1-9]\d{0,8}(,[1-9]\d{0,8}){0,49}$/, { message: 'ids debe ser una lista de ids separados por coma (máx. 50)' })
  ids?: string;
}
