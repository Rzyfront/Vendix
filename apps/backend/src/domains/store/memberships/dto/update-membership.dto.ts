import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { membership_status_enum } from '@prisma/client';

/**
 * DTO to partially update a membership's editable metadata.
 *
 * Admin edits are limited to the fields below:
 *  - `auto_renew` / `notes`           → free metadata.
 *  - `plan_id`                        → swap to another plan in this store.
 *  - `period_start` / `period_end`    → edit the billing window.
 *  - `status`                         → manual status override (use sparingly;
 *                                       prefer the explicit transition endpoints
 *                                       `/suspend`, `/freeze`, `/cancel`,
 *                                       `/reactivate` so each transition is
 *                                       validated against the current status).
 *
 * Date semantics: `period_start` 00:00:00.000 UTC, `period_end` 23:59:59.999 UTC
 * — see `vendix-date-timezone`. A `YYYY-MM-DD` string is widened to a full UTC
 * day so the range stays inclusive on both ends regardless of the caller's tz.
 *
 * Coherence: `period_start <= period_end` is enforced in the service when
 * either (or both) are sent — the DTO cannot validate across two optional
 * fields.
 */
export class UpdateMembershipDto {
  @IsOptional()
  @IsInt()
  @Type(() => Number)
  plan_id?: number;

  @IsOptional()
  @IsISO8601()
  @Transform(({ value }) =>
    typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
      ? `${value}T00:00:00.000Z`
      : value,
  )
  period_start?: string;

  @IsOptional()
  @IsISO8601()
  @Transform(({ value }) =>
    typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
      ? `${value}T23:59:59.999Z`
      : value,
  )
  period_end?: string;

  @IsOptional()
  @IsEnum(membership_status_enum)
  status?: membership_status_enum;

  @IsOptional()
  @IsBoolean()
  @Transform(({ value }) =>
    typeof value === 'string' ? value === 'true' : value,
  )
  auto_renew?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}
