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
import { gym_membership_status_enum } from '@prisma/client';

/**
 * DTO to create/assign a gym membership to a customer.
 *
 * `period_start` is optional; when omitted the service anchors it to the
 * current moment (store timezone). `period_end` is derived server-side from the
 * plan's `duration_days` — never provided by the client. Initial status
 * defaults to `pending_payment` unless explicitly overridden.
 */
export class CreateGymMembershipDto {
  @IsInt()
  @Type(() => Number)
  customer_id!: number;

  @IsInt()
  @Type(() => Number)
  gym_plan_id!: number;

  @IsOptional()
  @IsISO8601()
  period_start?: string;

  @IsOptional()
  @IsEnum(gym_membership_status_enum)
  status?: gym_membership_status_enum;

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
