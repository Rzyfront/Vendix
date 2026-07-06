import {
  IsArray,
  IsBoolean,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Length,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { AccessScheduleWindowDto } from './access-schedule-window.dto';

/**
 * DTO to create a store-scoped membership plan (membership tariff).
 *
 * `price` persists the BASE value only (no tax computed into it) — see
 * `vendix-currency-formatting`. Any tax-inclusive value is derived on reads,
 * never stored here.
 *
 * `code` is unique per store (`@@unique([store_id, code])`), so two plans with
 * the same code in the same store are rejected with a friendly conflict error.
 *
 * `access_limit_per_period` / `class_limit_per_period` are NOT dedicated
 * columns anymore — the service folds them into the `features` Json blob
 * (`features.access_limit_per_period`, `features.class_limit_per_period`).
 */
export class CreateMembershipPlanDto {
  @IsString()
  @Length(1, 60)
  code!: string;

  @IsString()
  @Length(1, 160)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  /** Base price of the plan (without tax). Persisted as Decimal(12,2). */
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Type(() => Number)
  @Min(0)
  price?: number;

  @IsOptional()
  @IsString()
  @Length(3, 3)
  currency?: string;

  @IsOptional()
  @IsInt()
  @Type(() => Number)
  @Min(1)
  duration_days?: number;

  /** Optional cap of accesses per period (month). Null/undefined = unlimited. */
  @IsOptional()
  @IsInt()
  @Type(() => Number)
  @Min(0)
  access_limit_per_period?: number;

  /** Optional cap of classes per period. Null/undefined = unlimited. */
  @IsOptional()
  @IsInt()
  @Type(() => Number)
  @Min(0)
  class_limit_per_period?: number;

  /**
   * Optional per-plan access schedule (opening hours). Folded into
   * `features.access_schedule` by the service (no dedicated column). Empty or
   * absent = no schedule restriction. Each window mirrors
   * `menu_availability_windows`.
   */
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AccessScheduleWindowDto)
  access_schedule?: AccessScheduleWindowDto[];

  /** Free-form feature flags / metadata (Json). */
  @IsOptional()
  @IsObject()
  features?: Record<string, any>;

  /** Optional catalog product that backs this plan (used at renewal/checkout). */
  @IsOptional()
  @IsInt()
  @Type(() => Number)
  product_id?: number;

  @IsOptional()
  @IsBoolean()
  @Transform(({ value }) =>
    typeof value === 'string' ? value === 'true' : value,
  )
  is_active?: boolean;

  @IsOptional()
  @IsInt()
  @Type(() => Number)
  @Min(0)
  sort_order?: number;
}
