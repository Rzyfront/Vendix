import {
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  Matches,
  Max,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import { order_channel_enum, order_state_enum } from '@prisma/client';

const DATE_ONLY_REGEX = /^\d{4}-\d{2}-\d{2}$/;

export const STORE_ACTIVITY_EVENT_TYPES = ['order', 'audit', 'login'] as const;

export type StoreActivityEventType =
  (typeof STORE_ACTIVITY_EVENT_TYPES)[number];

/**
 * Advanced filters for `GET /superadmin/stores/activity/:storeId`.
 *
 * `event_type` selects which timeline kinds are included (`order` = orders,
 * `audit` = audit_logs rows, `login` = successful login_attempts). `channel`
 * and `order_state` only apply to the `order` items. Dates are `YYYY-MM-DD`
 * in UTC (cross-store board exception, see the ranking DTO).
 */
export class StoreActivityDetailQueryDto {
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
  @IsIn([...STORE_ACTIVITY_EVENT_TYPES])
  event_type?: StoreActivityEventType;

  @IsOptional()
  @IsEnum(order_channel_enum)
  channel?: order_channel_enum;

  @IsOptional()
  @IsEnum(order_state_enum)
  order_state?: order_state_enum;

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
  limit?: number = 20;
}
