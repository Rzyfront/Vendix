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
import { membership_kind_enum, membership_status_enum } from '@prisma/client';

/**
 * DTO to create/assign a membership to a customer.
 *
 * `period_start` is optional; when omitted the service anchors it to the
 * current moment (store timezone). `period_end` is NOT set on creation — a
 * membership is born `pending_payment` and only gets a live period once the
 * first charge confirms (see `MembershipsService.renew`). The client CANNOT
 * choose the initial status: every membership starts `pending_payment` so a
 * free membership without a payment is impossible (fix H3).
 *
 * `kind` classifies the membership (`generic` | `gym` | `service`); defaults to
 * `generic` and may be overridden. The service upgrades the default to `gym`
 * for gym-industry stores.
 */
export class CreateMembershipDto {
  @IsInt()
  @Type(() => Number)
  customer_id!: number;

  @IsInt()
  @Type(() => Number)
  plan_id!: number;

  @IsOptional()
  @IsISO8601()
  period_start?: string;

  @IsOptional()
  @IsEnum(membership_kind_enum)
  kind?: membership_kind_enum;

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

/**
 * Bulk-import sibling of {@link CreateMembershipDto}, used by the member
 * roster scanner (`MemberBulkScannerService.commitRoster`).
 *
 * Differs from `CreateMembershipDto` in two ways:
 *  - `status` is REQUIRED and validated against the full `membership_status_enum`
 *    (the default `create()` forces `pending_payment`; imports of historical
 *    data must seed `active` / `expired` rows without an initial charge).
 *  - `period_end` is allowed and persisted as-is. Imported `active` rows
 *    intentionally skip `source_order_id` because there is no real charge to
 *    back them — they represent data migrated from paper / spreadsheets.
 *
 * Validation shape mirrors the canonical CreateMembershipDto for the
 * unchanged fields (customer/plan/kind/auto_renew/notes).
 */
export class CreateMembershipFromImportDto {
  @IsInt()
  @Type(() => Number)
  customer_id!: number;

  @IsInt()
  @Type(() => Number)
  plan_id!: number;

  @IsEnum(membership_status_enum)
  status!: membership_status_enum;

  @IsOptional()
  @IsISO8601()
  period_start?: string;

  @IsOptional()
  @IsISO8601()
  period_end?: string;

  @IsOptional()
  @IsEnum(membership_kind_enum)
  kind?: membership_kind_enum;

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
