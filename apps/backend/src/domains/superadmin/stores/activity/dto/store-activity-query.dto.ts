import {
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { store_type_enum } from '@prisma/client';

export const STORE_ACTIVITY_SORTS = [
  'score',
  'orders_count',
  'audit_events',
  'active_users',
  'revenue_operating',
  'last_activity_at',
] as const;

export type StoreActivitySort = (typeof STORE_ACTIVITY_SORTS)[number];

const DATE_ONLY_REGEX = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Query params for `GET /superadmin/stores/activity/ranking` (and `.../stats`).
 *
 * Dates travel as `YYYY-MM-DD` and are interpreted in UTC: the activity board
 * is cross-store (stores may live in different timezones), so no single store
 * tz applies — UTC is the neutral reference, same exception as the superadmin
 * dashboard (`dashboard.service.ts` TIMEZONE POLICY).
 */
export class StoreActivityQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 10;

  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  organization_id?: number;

  @IsOptional()
  @Transform(({ value }) =>
    value === undefined || value === null
      ? undefined
      : value === 'true' || value === true,
  )
  @IsBoolean()
  is_active?: boolean;

  @IsOptional()
  @IsEnum(store_type_enum)
  store_type?: store_type_enum;

  @IsOptional()
  @Matches(DATE_ONLY_REGEX, {
    message: 'from must be a YYYY-MM-DD date string',
  })
  from?: string;

  @IsOptional()
  @Matches(DATE_ONLY_REGEX, {
    message: 'to must be a YYYY-MM-DD date string',
  })
  to?: string;

  @IsOptional()
  @IsIn([...STORE_ACTIVITY_SORTS])
  sort?: StoreActivitySort = 'score';

  @IsOptional()
  @IsIn(['asc', 'desc'])
  order?: 'asc' | 'desc' = 'desc';
}
